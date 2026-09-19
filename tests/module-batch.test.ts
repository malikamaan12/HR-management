import { readFileSync, readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { defaultHelpdeskAutomation } from '../shared/helpdesk-automation';
import { defaultOperationalReminders } from '../shared/reminders';
import { defaultGeofencePolicy } from '../shared/attendance-location';
const context = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return context.db; }, pool: {} }));
import equipment from '../server/routes/equipment';
import handbook from '../server/routes/handbook';
import employment from '../server/routes/employment';
import retention from '../server/routes/retention';
import reminders from '../server/routes/reminder-rules';
import attendance from '../server/routes/attendance';
import rules from '../server/routes/hr-rules';
import leave from '../server/routes/leaveRequests';
import { authService } from '../server/services/auth';
import { businessDeadline, runHelpdeskAutomation } from '../server/services/helpdesk-automation';
import { runOperationalReminders } from '../server/services/operational-reminders';

let pg: PGlite, server: Server, base: string;
const now = new Date('2026-09-20T09:00:00Z'), today = '2026-09-20', reason = 'Synthetic combined workflow validation';
async function call(user: any, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { ...(user ? { Authorization: 'Bearer ' + user.token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function ok(user: any, path: string, body?: unknown, method?: string) {
  const result = await call(user, path, body, method); expect(result.status, JSON.stringify(result.body)).toBeLessThan(300); return result.body;
}
async function account(name: string, role: s.UserRole) {
  const password = 'SyntheticBatch8!';
  const [user] = await context.db.insert(s.users).values({ username: name, email: name + '@example.test', password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...user, token: (await authService.login(name, password)).accessToken };
}
async function fixture() {
  const admin = await account('admin', 'super_admin'), hr = await account('hr', 'hr'), alice = await account('alice', 'permanent_employee'), bob = await account('bob', 'permanent_employee');
  const people = [];
  for (const user of [alice, bob]) {
    const [employee] = await context.db.insert(s.employees).values({ userId: user.id, employeeId: 'QA-' + user.id, firstName: user.firstName, lastName: 'Synthetic', gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: 'PRIVATE-' + user.id, primaryMobile: '00000000', residentialAddress: 'Synthetic', emergencyContactName: 'Synthetic', emergencyContactNumber: '00000000', type: 'permanent', department: 'Operations', position: 'Host', location: 'Synthetic venue', joiningDate: '2025-01-01', workSchedule: 'management_office' }).returning();
    people.push(employee);
  }
  return { admin, hr, alice, bob, employee: people[0], other: people[1] };
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'module-batch-access-secret-long-enough'; process.env.JWT_REFRESH_SECRET = 'module-batch-refresh-secret-long-enough'; process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite(); for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  context.db = drizzle(pg); const app = express(); app.use(express.json());
  app.use('/equipment', equipment); app.use('/handbook', handbook); app.use('/employment', employment); app.use('/retention', retention); app.use('/reminders', reminders);
  app.use('/attendance', attendance); app.use('/rules', rules); app.use('/leave', leave);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = 'http://127.0.0.1:' + (server.address() as any).port;
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  await pg.exec('TRUNCATE users,employees,workforce_sites,app_settings,attendance_geofence_locations RESTART IDENTITY CASCADE');
  await context.db.insert(s.attendanceGeofencePolicy).values({ id: 1, config: defaultGeofencePolicy, version: 1 }).onConflictDoUpdate({ target: s.attendanceGeofencePolicy.id, set: { config: defaultGeofencePolicy, version: 1, updatedBy: null } });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { if (server) await new Promise<void>(r => server.close(() => r())); await pg?.close(); });

test('geofencing enforces saved coverage and fresh accurate GPS, while temporary attendance requires independent review', async () => {
  const f = await fixture();
  await context.db.update(s.employees).set({ type: 'temporary' }).where(eq(s.employees.id, f.employee.id));
  const enforcement = { version: 1, config: { ...defaultGeofencePolicy, required: true }, reason };
  expect((await call(f.hr, '/attendance/location/policy', enforcement)).status).toBe(403);
  expect((await call(f.admin, '/attendance/location/policy', enforcement)).status).toBe(409);
  const config = { name: 'Synthetic test boundary', latitude: 25.3, longitude: 51.5, radiusMeters: 100, enabled: true, siteId: null, employeeIds: [], startsOn: null, endsOn: null };
  expect((await call(f.alice, '/attendance/location/locations', { version: 0, config, reason })).status).toBe(403);
  const fence = await ok(f.hr, '/attendance/location/locations', { version: 0, config, reason });
  const policy = await ok(f.admin, '/attendance/location/policy', enforcement);
  expect(policy.version).toBe(2);
  const position = { latitude: 25.3, longitude: 51.5, accuracy: 10, capturedAt: now.toISOString() };
  for (const [body, message] of [
    [{}, /location access/i],
    [{ position: { ...position, latitude: 25.31 } }, /outside/i],
    [{ position: { ...position, capturedAt: new Date(+now - 100000).toISOString() } }, /stale/i],
    [{ position: { ...position, capturedAt: new Date(+now + 60000).toISOString() } }, /future/i],
    [{ position: { ...position, accuracy: 101 } }, /accuracy/i],
  ] as const) {
    const denied = await call(f.alice, '/attendance/clock-in', body);
    expect(denied.status).toBe(400); expect(denied.body.message).toMatch(message);
  }
  expect((await context.db.select().from(s.attendance))).toHaveLength(0);
  const entered = await ok(f.alice, '/attendance/clock-in', { position });
  expect(entered).toMatchObject({ approvalStatus: 'pending', locationIn: { status: 'verified', policyVersion: 2, fence: { id: fence.id, version: 1 } } });
  expect((await call(f.hr, `/attendance/location/approvals/${entered.id}/review`, { version: entered.version, decision: 'approved', reason })).status).toBe(409);
  const changed = await ok(f.hr, '/attendance/location/locations/' + fence.id, { version: 1, config: { ...config, radiusMeters: 200 }, reason }, 'PUT');
  expect(changed.version).toBe(2);
  expect((await call(f.hr, '/attendance/location/locations/' + fence.id, { version: 1, config, reason }, 'PUT')).status).toBe(409);
  vi.setSystemTime(new Date(+now + 3600000));
  for (const user of [f.alice, f.hr]) user.token = (await authService.login(user.username, 'SyntheticBatch8!')).accessToken;
  const closed = await ok(f.alice, '/attendance/clock-out', { position: { ...position, capturedAt: new Date().toISOString() } });
  expect(closed.locationIn.fence.radiusMeters).toBe(100); expect(closed.locationOut.fence.radiusMeters).toBe(200);
  expect((await call(f.alice, `/attendance/location/approvals/${closed.id}/review`, { version: closed.version, decision: 'approved', reason })).status).toBeGreaterThanOrEqual(400);
  const approved = await ok(f.hr, `/attendance/location/approvals/${closed.id}/review`, { version: closed.version, decision: 'approved', reason });
  expect(approved.approvalStatus).toBe('approved'); expect(approved.supervisorUserId).toBe(f.hr.id);
  expect((await call(f.hr, `/attendance/location/approvals/${closed.id}/review`, { version: closed.version, decision: 'rejected', reason })).status).toBe(409);
});

test('half-day leave reserves exact units across independent stages and permits the complementary half only', async () => {
  const f = await fixture(), common = { employeeId: null, effectiveFrom: '2026-01-01', reason };
  await ok(f.admin, '/rules', { ...common, kind: 'attendance', name: 'Work calendar', config: { timezone: 'Asia/Qatar', workingDays: [0, 1, 2, 3, 4], startTime: '09:00', endTime: '17:00', breakMinutes: 0, graceMinutes: 0, holidays: [] } });
  await ok(f.admin, '/rules', { ...common, kind: 'leave', name: 'Annual', config: { paid: true, balanceRequired: true, accrualMode: 'annual', annualDays: 2, monthlyDays: 0, carryoverLimit: 0, minServiceDays: 0, maxConsecutiveDays: 30, approverId: f.admin.id, allowHalfDays: true, additionalApproverIds: [f.hr.id] } });
  const payload = { employeeId: f.employee.id, leaveType: 'Annual', startDate: today, endDate: today, dayPortion: 'first_half', reason };
  expect((await call(f.alice, '/leave', { ...payload, endDate: '2026-09-21' })).status).toBe(400);
  const first = await ok(f.alice, '/leave', payload);
  expect(Number(first.totalDays)).toBe(0.5);
  const balances = async () => (await ok(f.alice, `/leave/balances/${f.employee.id}/2026`)).balances[0];
  expect(await balances()).toMatchObject({ balance: 2, reserved: 0.5, available: 1.5 });
  expect((await call(f.alice, '/leave', payload)).status).toBe(409);
  expect((await call(f.hr, `/leave/${first.id}/status`, { status: 'approved', version: first.reviewVersion, reason }, 'PATCH')).status).toBe(403);
  const stage = await ok(f.admin, `/leave/${first.id}/status`, { status: 'approved', version: first.reviewVersion, reason }, 'PATCH');
  expect(stage.status).toBe('pending'); expect(stage.approvalStage).toBe(1);
  expect(await balances()).toMatchObject({ balance: 2, reserved: 0.5 });
  const approved = await ok(f.hr, `/leave/${first.id}/status`, { status: 'approved', version: stage.reviewVersion, reason }, 'PATCH');
  expect(approved.status).toBe('approved'); expect(await balances()).toMatchObject({ balance: 1.5, reserved: 0 });
  const afternoon = await ok(f.alice, '/leave', { ...payload, dayPortion: 'second_half' });
  expect(Number(afternoon.totalDays)).toBe(0.5);
  expect((await call(f.alice, '/leave', { ...payload, dayPortion: 'full' })).status).toBe(409);
  expect((await call(f.alice, '/attendance/clock-in', {})).body.message).toMatch(/approved leave covers/i);
  vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
  f.alice.token = (await authService.login(f.alice.username, 'SyntheticBatch8!')).accessToken;
  const clocked = await ok(f.alice, '/attendance/clock-in', {});
  expect(clocked.status).toBe('present');
  await ok(f.alice, `/leave/${afternoon.id}/status`, { status: 'cancelled', version: afternoon.reviewVersion, reason }, 'PATCH');
  expect(await balances()).toMatchObject({ balance: 1.5, reserved: 0 });
});

test('equipment custody requires employee acknowledgement and independent receipt, with private records and version guards', async () => {
  const f = await fixture(), asset = await ok(f.hr, '/equipment/assets', { assetTag: 'QA-LAPTOP', name: 'Synthetic laptop', category: 'Computer' });
  expect((await call(f.alice, '/equipment/assets')).status).toBe(403);
  const assignment = await ok(f.hr, '/equipment/assignments', { assetId: asset.id, assetVersion: asset.version, employeeId: f.employee.id, issuedOn: today, dueOn: '2026-09-25', condition: 'good', note: reason });
  expect((await call(f.bob, '/equipment/assignments/' + assignment.id)).status).toBe(404);
  expect((await call(f.hr, `/equipment/assignments/${assignment.id}/acknowledge`, { version: 1, decision: 'accepted', note: reason })).status).toBe(403);
  const receipt = await ok(f.alice, `/equipment/assignments/${assignment.id}/acknowledge`, { version: 1, decision: 'accepted', note: reason });
  expect(receipt.acknowledgement).toBe('accepted');
  expect((await call(f.alice, `/equipment/assignments/${assignment.id}/request-return`, { version: 1, condition: 'good', note: reason })).status).toBe(409);
  const requested = await ok(f.hr, `/equipment/assignments/${assignment.id}/request-return`, { version: receipt.version, condition: 'good', note: reason });
  const body = { version: requested.version, assetVersion: 2, returnedOn: today, condition: 'good', disposition: 'available', note: reason, evidence: 'Synthetic signed receipt' };
  expect((await call(f.hr, `/equipment/assignments/${assignment.id}/return`, body)).status).toBe(403);
  expect((await ok(f.admin, `/equipment/assignments/${assignment.id}/return`, body)).status).toBe('returned');
  expect((await ok(f.hr, '/equipment/assets/' + asset.id)).state).toBe('available');
  expect((await ok(f.alice, `/equipment/assignments/${assignment.id}/history`)).total).toBe(4);
});

test('equipment concurrent issue cannot allocate one asset twice and history failure rolls back inventory', async () => {
  const f = await fixture(), asset = await ok(f.hr, '/equipment/assets', { assetTag: 'QA-RADIO', name: 'Synthetic radio', category: 'Radio' });
  const body = { assetId: asset.id, assetVersion: 1, issuedOn: today, dueOn: null, condition: 'good', note: reason };
  const results = await Promise.all([f.employee, f.other].map(e => call(f.hr, '/equipment/assignments', { ...body, employeeId: e.id })));
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  await pg.exec("CREATE FUNCTION reject_batch_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END $$; CREATE TRIGGER reject_batch_history BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION reject_batch_history()");
  try { expect((await call(f.hr, '/equipment/assets', { assetTag: 'QA-ROLLBACK', name: 'Must roll back', category: 'Radio' })).status).toBe(500); }
  finally { await pg.exec('DROP TRIGGER reject_batch_history ON hr_workflow_history; DROP FUNCTION reject_batch_history()'); }
  expect((await pg.query("SELECT id FROM hr_equipment_assets WHERE asset_tag='QA-ROLLBACK'")).rows).toHaveLength(0);
});

test('handbook publication pins immutable content and only the assigned employee can acknowledge its exact edition', async () => {
  const f = await fixture(), content = { title: 'Synthetic staff handbook', summary: 'Preview', body: 'Synthetic staff handbook content for local verification only.', effectiveOn: today, reason };
  const draft = await ok(f.admin, '/handbook/catalogue', { ...content, category: 'General' });
  expect((await call(f.alice, '/handbook/editions/' + draft.id)).status).toBe(404);
  const published = await ok(f.admin, `/handbook/editions/${draft.id}/publish`, { version: 1, reason });
  expect((await call(f.admin, `/handbook/editions/${draft.id}`, { ...content, version: published.version }, 'PATCH')).status).toBe(409);
  const assigned = await ok(f.hr, '/handbook/assignments', { editionId: draft.id, employeeIds: [f.employee.id], dueDate: '2026-09-25', required: true, supersedePending: true, reason });
  const id = assigned.items[0].id, detail = await ok(f.alice, '/handbook/assignments/' + id), hash = detail.row.body_hash;
  expect((await call(f.bob, '/handbook/assignments/' + id)).status).toBe(404);
  expect((await call(f.hr, `/handbook/assignments/${id}/acknowledge`, { version: 1, bodyHash: hash, confirmed: true })).status).toBe(403);
  expect((await call(f.alice, `/handbook/assignments/${id}/acknowledge`, { version: 1, bodyHash: hash, confirmed: true })).status).toBe(409);
  expect((await call(f.alice, `/handbook/assignments/${id}/read`, { version: 1, bodyHash: 'a'.repeat(64) })).status).toBe(409);
  const read = await ok(f.alice, `/handbook/assignments/${id}/read`, { version: 1, bodyHash: hash });
  const acknowledged = await ok(f.alice, `/handbook/assignments/${id}/acknowledge`, { version: read.version, bodyHash: hash, confirmed: true });
  expect(acknowledged.status).toBe('acknowledged');
  const next = await ok(f.admin, `/handbook/catalogue/${draft.handbook_id}/editions`, { ...content, body: 'Synthetic updated handbook text for a second edition.', sourceEditionId: draft.id });
  await ok(f.admin, `/handbook/editions/${next.id}/publish`, { version: 1, reason });
  await ok(f.hr, '/handbook/assignments', { editionId: next.id, employeeIds: [f.employee.id], dueDate: '2026-09-25', required: true, reason });
  const saved = await ok(f.alice, '/handbook/assignments/' + id); expect(saved.row.status).toBe('acknowledged'); expect(saved.edition.body).toBe(content.body);
});

test('employment proposals need independent approval and explicit application, and stale profiles block updates', async () => {
  const f = await fixture(), body = { employeeId: f.employee.id, expectedEmployeeVersion: f.employee.recordVersion, kind: 'transfer', effectiveDate: today, changes: { department: 'Finance' }, reason };
  expect((await call(f.alice, '/employment/changes', body)).status).toBe(403);
  const change = await ok(f.hr, '/employment/changes', body);
  expect((await call(f.bob, '/employment/changes/' + change.id)).status).toBe(404);
  expect((await call(f.hr, `/employment/changes/${change.id}/actions`, { version: 1, action: 'approve', reason })).status).toBe(403);
  const approved = await ok(f.admin, `/employment/changes/${change.id}/actions`, { version: 1, action: 'approve', reason });
  expect((await context.db.select().from(s.employees).where(eq(s.employees.id, f.employee.id)))[0].department).toBe('Operations');
  await ok(f.hr, `/employment/changes/${change.id}/actions`, { version: approved.version, action: 'apply', reason });
  const employee = (await context.db.select().from(s.employees).where(eq(s.employees.id, f.employee.id)))[0];
  expect(employee.department).toBe('Finance'); expect(employee.recordVersion).toBeGreaterThan(f.employee.recordVersion);
  const next = await ok(f.hr, '/employment/changes', { ...body, expectedEmployeeVersion: employee.recordVersion, changes: { position: 'Senior Host' } });
  await context.db.update(s.employees).set({ position: 'Independently updated' }).where(eq(s.employees.id, f.employee.id));
  expect((await call(f.admin, `/employment/changes/${next.id}/actions`, { version: 1, action: 'approve', reason })).status).toBe(409);
  expect((await context.db.select().from(s.employees).where(eq(s.employees.id, f.employee.id)))[0].position).toBe('Independently updated');
});

test('reviewed service periods reject overlaps, preserve correction history and hide other employees', async () => {
  const f = await fixture(), path = `/employment/service/${f.employee.id}/requests`;
  const body = { action: 'record', targetPeriodId: null, expectedPeriodVersion: null, period: { startDate: '2025-01-01', endDate: '2025-12-31', qualifies: true, serviceType: 'permanent', note: 'Synthetic service period' }, reason };
  const requested = await ok(f.hr, path, body);
  expect((await call(f.hr, `/employment/period-requests/${requested.id}/actions`, { version: 1, action: 'approve', reason })).status).toBe(403);
  await ok(f.admin, `/employment/period-requests/${requested.id}/actions`, { version: 1, action: 'approve', reason });
  expect((await call(f.hr, path, body)).status).toBe(409);
  const service = await ok(f.alice, `/employment/service/${f.employee.id}`); expect(service.periods).toHaveLength(1);
  expect((await call(f.bob, `/employment/service/${f.employee.id}`)).status).toBe(404);
  const correct = await ok(f.hr, path, { ...body, action: 'correct', targetPeriodId: service.periods[0].id, expectedPeriodVersion: 1, period: { ...body.period, endDate: '2026-01-31' } });
  await ok(f.admin, `/employment/period-requests/${correct.id}/actions`, { version: 1, action: 'approve', reason });
  const result = await ok(f.alice, `/employment/service/${f.employee.id}`); expect(result.periods[0].end_date).toContain('2026-01-31'); expect(result.periods[0].version).toBe(2);
  expect((await ok(f.alice, `/employment/service/${f.employee.id}/history`)).items.length).toBeGreaterThanOrEqual(4);
});

test('retention preserves files and enforces holds, independent decisions, changed policies and restoration', async () => {
  const f = await fixture();
  const [document] = await context.db.insert(s.documents).values({ employeeId: f.employee.id, documentType: 'Passport', documentNumber: 'SYNTHETIC', issueDate: '2020-01-01', expiryDate: '2025-01-01', status: 'expired', documentFile: 'private/synthetic.pdf' }).returning();
  expect((await call(f.alice, '/retention/documents')).status).toBe(403);
  const policy = { documentType: 'Passport', version: 0, enabled: true, anchor: 'expiry', retentionDays: 1, reviewDays: 7, reason };
  expect((await call(f.hr, '/retention/policies', policy)).status).toBe(403); await ok(f.admin, '/retention/policies', policy);
  const hold = await ok(f.hr, '/retention/holds', { employeeId: f.employee.id, documentId: document.id, reason });
  expect((await call(f.hr, '/retention/requests', { documentId: document.id, action: 'archive', reason })).status).toBe(409);
  await ok(f.hr, `/retention/holds/${hold.id}/release`, { version: 1, reason });
  const request = await ok(f.hr, '/retention/requests', { documentId: document.id, action: 'archive', reason });
  expect((await call(f.hr, `/retention/requests/${request.id}/decision`, { version: 1, decision: 'approve', reason })).status).toBe(403);
  await ok(f.admin, '/retention/policies', { ...policy, version: 1, retentionDays: 2 });
  expect((await call(f.admin, `/retention/requests/${request.id}/decision`, { version: 1, decision: 'approve', reason })).status).toBe(409);
  await ok(f.hr, `/retention/requests/${request.id}/decision`, { version: 1, decision: 'withdraw', reason });
  const fresh = await ok(f.hr, '/retention/requests', { documentId: document.id, action: 'archive', reason });
  await ok(f.admin, `/retention/requests/${fresh.id}/decision`, { version: 1, decision: 'approve', reason });
  expect((await ok(f.hr, '/retention/documents?view=archived')).items).toHaveLength(1);
  expect((await context.db.select().from(s.documents))[0].documentFile).toBe(document.documentFile);
  const restore = await ok(f.hr, '/retention/requests', { documentId: document.id, action: 'restore', reason });
  await ok(f.admin, `/retention/requests/${restore.id}/decision`, { version: 1, decision: 'approve', reason });
  expect((await ok(f.hr, '/retention/documents?view=archived')).items).toHaveLength(0);
});

test('operational reminders stay in-app, deduplicate delivery and exclude inactive or archived records', async () => {
  const f = await fixture();
  const config = { ...defaultOperationalReminders, notifyApprovals: false, notifyTraining: false, notifyHandbooks: false, notifyEquipment: false };
  expect((await call(f.hr, '/reminders', { version: 0, config, reason })).status).toBe(403);
  await ok(f.admin, '/reminders', { version: 0, config, reason });
  const docs = await context.db.insert(s.documents).values([f.employee, f.other].map(e => ({ employeeId: e.id, documentType: 'Passport', documentNumber: 'SYNTHETIC', issueDate: '2025-01-01', expiryDate: '2026-09-25', status: 'valid' as const, documentFile: 'private/synthetic.pdf' }))).returning();
  await context.db.execute(sql`INSERT INTO hr_document_archives(document_id,employee_id,archived,changed_by) VALUES (${docs[1].id},${f.other.id},true,${f.admin.id})`);
  const one = await runOperationalReminders(now), two = await runOperationalReminders(now);
  expect(one.created).toBe(1); expect(two.created).toBe(0);
  const messages = await context.db.select().from(s.notifications); expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({ userId: f.alice.id, channel: 'push' });
  await context.db.update(s.users).set({ isActive: false }).where(eq(s.users.id, f.alice.id));
  expect((await runOperationalReminders(new Date(+now + 2 * 86400000))).created).toBe(0);
});

test('helpdesk business deadlines skip weekends and holidays, including split working windows', () => {
  const calendar = structuredClone(defaultHelpdeskAutomation.calendar);
  expect(businessDeadline(new Date('2026-09-17T13:00:00Z'), 2, calendar).toISOString()).toBe('2026-09-20T07:00:00.000Z');
  calendar.holidays = [{ date: '2026-09-20', name: 'Synthetic closure' }];
  expect(businessDeadline(new Date('2026-09-17T13:00:00Z'), 2, calendar).toISOString()).toBe('2026-09-21T07:00:00.000Z');
  calendar.week[1].windows = [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '17:00' }];
  expect(businessDeadline(new Date('2026-09-21T08:30:00Z'), 1, calendar).toISOString()).toBe('2026-09-21T10:30:00.000Z');
});

test('helpdesk automation respects confidential routing and prevents repeated escalation or duplicate reminders', async () => {
  const f = await fixture(), config = { ...defaultHelpdeskAutomation, enabled: true, clockMode: 'elapsed', autoEscalate: true, escalationDelayMinutes: 0 };
  await context.db.execute(sql`INSERT INTO helpdesk_automation_policies(version,config,created_by,reason) VALUES (1,${JSON.stringify(config)}::jsonb,${f.admin.id},${reason})`);
  const [ticket] = await context.db.insert(s.helpdeskCases).values({ requesterId: f.alice.id, category: 'general', title: 'Synthetic private request', confidential: true, assigneeId: f.admin.id, firstResponseDueAt: new Date(+now - 3600000), resolutionDueAt: new Date(+now + 86400000), policySnapshot: { escalationAssigneeId: f.hr.id } as any }).returning();
  await context.db.execute(sql`UPDATE helpdesk_cases SET automation_snapshot=${JSON.stringify({ version: 1, createdBy: f.admin.id, config })}::jsonb,automation_next_check_at=${now} WHERE id=${ticket.id}`);
  const first = await runHelpdeskAutomation(now); expect(first.escalated).toBe(0); expect(first.notifications).toBe(1);
  expect((await pg.query("SELECT kind FROM helpdesk_automation_events")).rows).toEqual([{ kind: 'escalation_blocked' }]);
  await context.db.update(s.helpdeskCases).set({ policySnapshot: { escalationAssigneeId: f.admin.id } as any }).where(eq(s.helpdeskCases.id, ticket.id));
  const later = new Date(+now + 10 * 60000), result = await runHelpdeskAutomation(later); expect(result.escalated).toBe(1);
  const count = (await context.db.select().from(s.notifications)).length;
  expect((await runHelpdeskAutomation(later)).notifications).toBe(0); expect((await context.db.select().from(s.notifications)).length).toBe(count);
  expect((await context.db.select().from(s.notifications)).every((row: any) => row.channel === 'push' && !row.message.includes('Private case body') && row.userId !== f.hr.id)).toBe(true);
});
