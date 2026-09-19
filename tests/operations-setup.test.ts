import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, afterEach, test, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { defaultGeofencePolicy } from '../shared/attendance-location';
import { defaultInductionSettings, inductionContent } from '../shared/induction';
const ctx = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: {} }));
import setupRouter from '../server/routes/operations-setup';
import { authService } from '../server/services/auth';

let pg: PGlite, server: Server, base: string;
const password = 'OperationsSetup8!';
async function account(name: string, role: s.UserRole) {
  const [row] = await ctx.db.insert(s.users).values({ username: name, email: `${name}@example.test`, password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...row, token: (await authService.login(name, password)).accessToken };
}
async function employee(n: number, userId: number | null = null) {
  const [row] = await ctx.db.insert(s.employees).values({ employeeId: `SETUP-${n}`, firstName: 'Synthetic', lastName: `Worker ${n}`, gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: `PRIVATE-QID-${n}`, primaryMobile: 'PRIVATE-PHONE', residentialAddress: 'PRIVATE-ADDRESS', emergencyContactName: 'PRIVATE-CONTACT', emergencyContactNumber: 'PRIVATE-EMERGENCY', department: 'Operations', position: 'Host', location: 'Test venue', type: 'permanent', joiningDate: '2025-01-01', workSchedule: 'management_office', userId }).returning();
  return row;
}
async function read(token?: string, query = '?asOf=2026-09-19') {
  const response = await fetch(base + '/setup' + query, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
}
const section = (result: Awaited<ReturnType<typeof read>>, id: string) => result.body.sections.find((item: any) => item.id === id);
beforeAll(async () => {
  process.env.JWT_SECRET = 'setup-access-secret-at-least-thirtytwo'; process.env.JWT_REFRESH_SECRET = 'setup-refresh-secret-at-least-thirtytwo'; process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite(); for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  ctx.db = drizzle(pg); const app = express(); app.use(express.json()); app.use('/setup', setupRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-19T12:00:00Z')); await pg.exec('TRUNCATE users,employees,workforce_sites,app_settings RESTART IDENTITY CASCADE'); await ctx.db.insert(s.attendanceGeofencePolicy).values({ id: 1, config: defaultGeofencePolicy }).onConflictDoUpdate({ target: s.attendanceGeofencePolicy.id, set: { config: defaultGeofencePolicy } }); });
afterEach(() => vi.useRealTimers());
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (pg) await pg.close(); });

test('setup requires an authenticated administrator and never marks an empty company ready', async () => {
  const admin = await account('admin', 'super_admin'), hr = await account('hr', 'hr'), worker = await account('worker', 'permanent_employee');
  expect((await read()).status).toBe(401); expect((await read(hr.token)).status).toBe(403); expect((await read(worker.token)).status).toBe(403);
  const result = await read(admin.token); expect(result.status, result.body.message).toBe(200); expect(result.cache).toContain('no-store');
  expect(result.body.counts).toEqual({ activeEmployees: 0, linkedEmployees: 0, readyEmployees: 0, setupPendingEmployees: 0, teams: 0, sites: 0 });
  expect(section(result, 'people').status).toBe('not_started'); expect(section(result, 'leave').status).not.toBe('ready');
  expect(result.body.sections.every((item: any) => item.status === 'ready')).toBe(false);
});

test('readiness detects inactive employee accounts without exposing private employee fields or writing configuration', async () => {
  const admin = await account('admin', 'super_admin'), worker = await account('worker', 'permanent_employee'); await employee(1, worker.id);
  const first = await read(admin.token); expect(first.body.counts.activeEmployees).toBe(1); expect(first.body.counts.linkedEmployees).toBe(1); expect(section(first, 'people').status).toBe('ready');
  await ctx.db.update(s.users).set({ passwordSetupRequired: true }).where(eq(s.users.id, worker.id));
  const pending = await read(admin.token); expect(pending.body.counts.linkedEmployees).toBe(1); expect(pending.body.counts.readyEmployees).toBe(0); expect(pending.body.counts.setupPendingEmployees).toBe(1); expect(section(pending, 'people').issues[0].message).toContain('has a linked account'); expect(section(pending, 'people').status).toBe('action_required');
  await ctx.db.update(s.users).set({ isActive: false, passwordSetupRequired: false }).where(eq(s.users.id, worker.id));
  const countBefore = (await ctx.db.select().from(s.activityLogs)).length, second = await read(admin.token);
  expect(second.body.counts.linkedEmployees).toBe(1); expect(second.body.counts.readyEmployees).toBe(0); expect(second.body.counts.setupPendingEmployees).toBe(0); expect(section(second, 'people').status).toBe('action_required');
  const serialized = JSON.stringify(second.body); expect(serialized).not.toContain('PRIVATE-'); expect(serialized).not.toContain('password');
  expect((await ctx.db.select().from(s.activityLogs)).length).toBe(countBefore);
  expect(await ctx.db.select().from(s.hrRules)).toHaveLength(0);
});

test('locations reflect coverage dates and enforcement instead of assuming a saved boundary is active', async () => {
  const admin = await account('admin', 'super_admin'); await employee(1);
  expect(section(await read(admin.token), 'locations').status).toBe('not_started');
  const config = { name: 'Synthetic office boundary', latitude: 25.3, longitude: 51.5, radiusMeters: 100, enabled: true, siteId: null, employeeIds: [], startsOn: '2026-09-01', endsOn: '2026-09-19' };
  await ctx.db.insert(s.attendanceGeofenceLocations).values({ config, createdBy: admin.id, updatedBy: admin.id });
  await ctx.db.update(s.attendanceGeofencePolicy).set({ config: { ...defaultGeofencePolicy, required: true } }).where(eq(s.attendanceGeofencePolicy.id, 1));
  expect(section(await read(admin.token), 'locations').status).toBe('ready');
  expect(section(await read(admin.token, '?asOf=2026-09-20'), 'locations').status).toBe('action_required');
});

test('leave readiness rejects self approval and accepts an active independent approver or eligible open stage', async () => {
  const admin = await account('admin', 'super_admin'), owner = await account('owner', 'super_admin'), person = await employee(1, owner.id);
  const config = { paid: true, balanceRequired: false, accrualMode: 'none', annualDays: 0, monthlyDays: 0, carryoverLimit: 0, minServiceDays: 0, maxConsecutiveDays: 30, approverId: owner.id };
  await ctx.db.insert(s.hrRules).values({ kind: 'leave', name: 'Annual', employeeId: person.id, effectiveFrom: '2026-01-01', config, reason: 'Synthetic leave routing', createdBy: admin.id });
  expect(section(await read(admin.token), 'leave').status).toBe('action_required');
  await ctx.db.insert(s.hrRules).values({ kind: 'leave', name: 'Annual', employeeId: person.id, effectiveFrom: '2026-01-01', config: { ...config, approverId: admin.id }, reason: 'Synthetic independent routing', createdBy: admin.id });
  expect(section(await read(admin.token), 'leave').status).toBe('ready');
  await ctx.db.insert(s.hrRules).values({ kind: 'leave', name: 'Annual', employeeId: person.id, effectiveFrom: '2026-01-01', config: { ...config, approverId: null }, reason: 'Synthetic open independent stage', createdBy: admin.id });
  expect(section(await read(admin.token), 'leave').status).toBe('ready');
});

test('mandatory training readiness uses the published audience and ignores draft-only requirements', async () => {
  const admin = await account('admin', 'super_admin'); await employee(1);
  const definition = { title: 'Synthetic induction', description: 'Synthetic published course for readiness', provider: 'Internal', format: 'self_paced', url: '', durationMinutes: 10, capacity: null, passScore: 80, requiresEvidence: false, validMonths: null, approverId: admin.id, status: 'published', delivery: 'internal' };
  const [course] = await ctx.db.insert(s.learningCourses).values({ definition, createdBy: admin.id }).returning();
  const correctOption = randomUUID();
  const content = inductionContent.parse({ settings: { ...defaultInductionSettings, mandatoryForOnboarding: false },
    lessons: [{ id: randomUUID(), title: 'Synthetic lesson', kind: 'text', body: 'Synthetic training material.', assetId: null, required: true, estimatedMinutes: 5 }],
    questions: [{ id: randomUUID(), prompt: 'Synthetic readiness question?', kind: 'single', options: [{ id: correctOption, text: 'Correct' }, { id: randomUUID(), text: 'Incorrect' }], correctOptionIds: [correctOption], points: 1, explanation: '' }] });
  const release = await ctx.db.execute(sql`INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES (${course.id},1,1,${JSON.stringify(definition)}::jsonb,${JSON.stringify(content)}::jsonb,${admin.id}) RETURNING id`);
  await ctx.db.execute(sql`INSERT INTO learning_induction_courses(course_id,published_release_id) VALUES (${course.id},${release.rows[0].id})`);
  await ctx.db.execute(sql`INSERT INTO learning_induction_drafts(course_id,definition,content,updated_by) VALUES (${course.id},${JSON.stringify(definition)}::jsonb,${JSON.stringify({ ...content, settings: { ...content.settings, mandatoryForOnboarding: true } })}::jsonb,${admin.id})`);
  expect(section(await read(admin.token), 'induction').status).not.toBe('ready');
  const released = await ctx.db.execute(sql`INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES (${course.id},2,2,${JSON.stringify(definition)}::jsonb,${JSON.stringify({ ...content, settings: { ...content.settings, mandatoryForOnboarding: true, employeeTypes: ['temporary'] } })}::jsonb,${admin.id}) RETURNING id`);
  await ctx.db.execute(sql`UPDATE learning_induction_courses SET published_release_id=${released.rows[0].id} WHERE course_id=${course.id}`);
  expect(section(await read(admin.token), 'induction').status).toBe('action_required');
});

test('readiness date and query validation reject invalid or unrecognised input', async () => {
  const admin = await account('admin', 'super_admin');
  expect((await read(admin.token, '?asOf=2026-02-30')).status).toBe(400);
  expect((await read(admin.token, '?asOf=2026-09-19&employeeId=1')).status).toBe(400);
});
