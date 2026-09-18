import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
import { courseDefinition } from '../shared/employee-services';
import { defaultInductionSettings, inductionContent } from '../shared/induction';
import { operationsTrainingSettings } from '../shared/operations-training';

const context = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return context.db; }, pool: {} }));
import router from '../server/routes/operations-training';
import { authService } from '../server/services/auth';
import { assignOnboardingInduction } from '../server/services/induction-learning';

let pg: PGlite, server: Server, base: string;
const password = 'SyntheticTraining8!';

async function account(name: string, role: schema.UserRole) {
  const [user] = await context.db.insert(schema.users).values({ username: name, email: name + '@example.test', password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...user, token: (await authService.login(name, password)).accessToken };
}
async function request(token: string | null, path = '/courses', body?: unknown) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}
async function employee(name: string, type: 'permanent' | 'temporary' | 'contract' = 'permanent', department = 'Operations') {
  const [row] = await context.db.insert(schema.employees).values({ employeeId: name, firstName: name, lastName: 'Synthetic', gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: name + '-QID', primaryMobile: '00000000', residentialAddress: 'Synthetic', emergencyContactName: 'Synthetic', emergencyContactNumber: '00000000', department, position: 'Test', location: 'Test', type, joiningDate: '2026-01-01' }).returning();
  return row;
}
async function fixture(options: { status?: 'draft' | 'published' | 'archived'; capacity?: number | null; asset?: boolean } = {}) {
  const admin = await account('administrator', 'super_admin');
  const definition = courseDefinition.parse({ title: 'Synthetic safety induction', description: 'Synthetic internal training content', provider: 'Internal', format: 'self_paced', delivery: 'internal', url: '', durationMinutes: 20, capacity: options.capacity ?? null, passScore: 80, requiresEvidence: false, validMonths: 12, approverId: admin.id, status: options.status || 'published' });
  const optionId = randomUUID();
  const content = inductionContent.parse({ lessons: [{ id: randomUUID(), title: 'Synthetic lesson', kind: options.asset ? 'document' : 'text', body: 'Private lesson content', assetId: options.asset ? 9999 : null, required: true, estimatedMinutes: 10 }], questions: [{ id: randomUUID(), prompt: 'Synthetic private quiz prompt?', kind: 'single', options: [{ id: optionId, text: 'Synthetic correct answer' }, { id: randomUUID(), text: 'Synthetic incorrect answer' }], correctOptionIds: [optionId], points: 2, explanation: 'Private answer explanation' }], settings: { ...defaultInductionSettings, validMonths: 12, retryDelayMinutes: 60 } });
  const [course] = await context.db.insert(schema.learningCourses).values({ definition, createdBy: admin.id }).returning();
  await context.db.execute(sql`INSERT INTO learning_induction_courses(course_id) VALUES (${course.id})`);
  const release = (await context.db.execute(sql`INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES (${course.id},1,1,${JSON.stringify({ ...definition, status: 'published' })}::jsonb,${JSON.stringify(content)}::jsonb,${admin.id}) RETURNING id`)).rows[0];
  if (options.status !== 'draft') await context.db.execute(sql`UPDATE learning_induction_courses SET published_release_id=${release.id} WHERE course_id=${course.id}`);
  await context.db.execute(sql`INSERT INTO learning_induction_drafts(course_id,definition,content,updated_by) VALUES (${course.id},${JSON.stringify({ ...definition, status: 'draft' })}::jsonb,${JSON.stringify(content)}::jsonb,${admin.id})`);
  const settings = { mandatoryForOnboarding: true, employeeTypes: ['permanent' as const], departments: ['Operations'], defaultDueDays: 14 };
  return { admin, course, content, definition, releaseId: Number(release.id), body: { courseVersion: 1, draftVersion: 1, publishedReleaseId: Number(release.id), settings, reason: 'Configure synthetic onboarding requirements' }, path: `/courses/${course.id}/requirements` };
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'operations-training-access-secret-long-enough';
  process.env.JWT_REFRESH_SECRET = 'operations-training-refresh-secret-long-enough';
  process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite();
  for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  context.db = drizzle(pg);
  const app = express(); app.use(express.json()); app.use(router);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
beforeEach(async () => { await pg.exec('TRUNCATE users,employees,app_settings RESTART IDENTITY CASCADE'); });
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (pg) await pg.close(); });

test('training requirement administration is session protected, no-store and limited to administrator roles', async () => {
  const f = await fixture();
  const anonymous = await request(null); expect(anonymous.status).toBe(401); expect(anonymous.cache).toBe('no-store');
  for (const role of ['hr', 'hr_director', 'department_head', 'permanent_employee'] as const) {
    const user = await account(role, role);
    expect((await request(user.token)).status).toBe(403);
    expect((await request(user.token, f.path, f.body)).status).toBe(403);
  }
  const admin = await account('secondadmin', 'admin');
  expect((await request(admin.token)).status).toBe(200);
  expect((await request(admin.token, f.path, f.body)).status).toBe(200);
});

test('catalogue exposes only published requirement summaries, bounded search and paging', async () => {
  const f = await fixture();
  const result = await request(f.admin.token, '/courses?q=safety&offset=0');
  expect(result.status).toBe(200); expect(result.cache).toBe('no-store'); expect(result.body.total).toBe(1);
  expect(result.body.items[0]).toMatchObject({ id: f.course.id, courseVersion: 1, draftVersion: 1, publishedReleaseId: f.releaseId, hasDraft: false, canPublish: true });
  expect(Object.keys(result.body.items[0].settings).sort()).toEqual(['defaultDueDays', 'departments', 'employeeTypes', 'mandatoryForOnboarding']);
  const serialized = JSON.stringify(result.body);
  for (const value of ['correctOptionIds', 'Private lesson content', 'Synthetic private quiz prompt?', 'Private answer explanation']) expect(serialized).not.toContain(value);
  expect((await request(f.admin.token, '/courses?q=unmatched')).body.total).toBe(0);
  expect((await request(f.admin.token, '/courses?offset=25')).body.items).toEqual([]);
  expect((await request(f.admin.token, '/courses?offset=-1')).status).toBe(400);
  expect((await request(f.admin.token, '/courses?q=' + 'x'.repeat(101))).status).toBe(400);
});

test('requirements publish a new immutable release without touching author content, quiz scores or completions', async () => {
  const f = await fixture(), person = await employee('COMPLETED');
  const [enrollment] = await context.db.insert(schema.learningEnrollments).values({ courseId: f.course.id, employeeId: person.id, status: 'completed', courseSnapshot: { ...f.definition, version: 1 }, requestedBy: f.admin.id, approverId: f.admin.id, progress: 100, score: 100, certificateNumber: 'SYNTHETIC-CERT-1', completedAt: new Date('2026-01-02'), expiresOn: '2099-01-01' }).returning();
  await context.db.execute(sql`INSERT INTO learning_induction_enrollments(enrollment_id,release_id,required,completion_brand) VALUES (${enrollment.id},${f.releaseId},false,'{"certificateTitle":"Original certificate"}'::jsonb)`);
  const attempt = (await context.db.execute(sql`INSERT INTO learning_induction_attempts(enrollment_id,attempt_number,start_key,questions,answers,status,expires_at,submitted_at,created_by,score,earned_points,total_points,passed) VALUES (${enrollment.id},1,${randomUUID()},${JSON.stringify(f.content.questions)}::jsonb,'[]'::jsonb,'submitted',now(),now(),${f.admin.id},100,2,2,true) RETURNING id`)).rows[0];
  await context.db.execute(sql`UPDATE learning_induction_enrollments SET passed_attempt_id=${attempt.id} WHERE enrollment_id=${enrollment.id}`);
  await context.db.execute(sql`INSERT INTO learning_induction_lesson_progress(enrollment_id,lesson_id,completed_at,completed_by) VALUES (${enrollment.id},${f.content.lessons[0].id},now(),${f.admin.id})`);
  const snapshots = async () => ({ enrollment: (await context.db.select().from(schema.learningEnrollments))[0], internal: (await pg.query('SELECT * FROM learning_induction_enrollments')).rows, attempts: (await pg.query('SELECT * FROM learning_induction_attempts')).rows, lessons: (await pg.query('SELECT * FROM learning_induction_lesson_progress')).rows });
  const before = await snapshots();
  const result = await request(f.admin.token, f.path, f.body);
  expect(result.status, result.body.message).toBe(200); expect(result.body).toMatchObject({ changed: true, courseVersion: 2, draftVersion: 2, releaseNumber: 2 });
  const releases = (await pg.query<any>('SELECT * FROM learning_induction_releases ORDER BY id')).rows;
  expect(releases).toHaveLength(2); expect(releases[0].content).toEqual(f.content);
  expect(releases[1].content).toEqual({ ...f.content, settings: { ...f.content.settings, ...f.body.settings } });
  expect(releases[1].definition).toEqual(releases[0].definition);
  expect(await snapshots()).toEqual(before);
  const [saved] = await context.db.select().from(schema.learningCourses).where(eq(schema.learningCourses.id, f.course.id));
  expect(saved.history.at(-1)).toMatchObject({ action: 'Onboarding requirements published', actorId: f.admin.id, reason: f.body.reason, version: 2 });
  expect((await request(f.admin.token)).body.items[0]).toMatchObject({ hasDraft: false, canPublish: true, publishedReleaseId: result.body.publishedReleaseId });
});

test('stale course, draft or release guards block changes and protect existing author work', async () => {
  const f = await fixture();
  for (const field of ['courseVersion', 'draftVersion', 'publishedReleaseId']) expect((await request(f.admin.token, f.path, { ...f.body, [field]: 99 })).status).toBe(409);
  const authorContent = { ...f.content, lessons: [{ ...f.content.lessons[0], body: 'Unpublished HR authored revision' }] };
  await context.db.execute(sql`UPDATE learning_induction_drafts SET content=${JSON.stringify(authorContent)}::jsonb WHERE course_id=${f.course.id}`);
  expect((await request(f.admin.token)).body.items[0]).toMatchObject({ hasDraft: true, canPublish: false });
  const result = await request(f.admin.token, f.path, f.body); expect(result.status).toBe(409); expect(result.body.message).toContain('unpublished author changes');
  expect((await pg.query<any>('SELECT content FROM learning_induction_drafts')).rows[0].content).toEqual(authorContent);
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
});

test.each(['draft', 'archived'] as const)('%s courses cannot be configured or listed as published requirements', async status => {
  const f = await fixture({ status });
  expect((await request(f.admin.token)).body.items).toEqual([]);
  expect((await request(f.admin.token, f.path, f.body)).status).toBe(409);
});

test('only the four approved settings are accepted with audience, due-day and reason limits', async () => {
  const f = await fixture();
  const invalid = [
    { ...f.body, settings: { ...f.body.settings, passScore: 0 } },
    { ...f.body, content: f.content },
    { ...f.body, settings: { ...f.body.settings, employeeTypes: [] } },
    { ...f.body, settings: { ...f.body.settings, employeeTypes: ['permanent', 'permanent'] } },
    { ...f.body, settings: { ...f.body.settings, departments: ['Operations', 'Operations'] } },
    { ...f.body, settings: { ...f.body.settings, departments: Array.from({ length: 101 }, (_, index) => 'Department ' + index) } },
    { ...f.body, settings: { ...f.body.settings, defaultDueDays: 366 } },
    { ...f.body, reason: '' },
  ];
  for (const body of invalid) expect((await request(f.admin.token, f.path, body)).status).toBe(400);
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
  expect(operationsTrainingSettings.safeParse({ ...f.body.settings, defaultDueDays: 0 }).success).toBe(true);
});

test('an unchanged audience, including reordered employee types, creates no extra release', async () => {
  const f = await fixture();
  const unchanged = { mandatoryForOnboarding: false, employeeTypes: ['contract', 'temporary', 'permanent'], departments: [], defaultDueDays: 7 };
  const result = await request(f.admin.token, f.path, { ...f.body, settings: unchanged });
  expect(result.status).toBe(200); expect(result.body).toMatchObject({ changed: false, courseVersion: 1, draftVersion: 1, publishedReleaseId: f.releaseId });
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
});

test('publishing revalidates the course approver and rolls back when the approver lost permission', async () => {
  const f = await fixture(), actor = await account('separateadmin', 'admin');
  await context.db.update(schema.users).set({ role: 'permanent_employee' }).where(eq(schema.users.id, f.admin.id));
  expect((await request(actor.token)).body.items[0]).toMatchObject({ canPublish: false });
  expect((await request(actor.token, f.path, f.body)).status).toBe(400);
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
});

test('missing course assets fail publishing without replacing the previous release', async () => {
  const f = await fixture({ asset: true });
  const result = await request(f.admin.token, f.path, f.body);
  expect(result.status).toBe(400); expect(result.body.message).toContain('asset must belong');
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
});

test('existing active enrollment capacity is checked before a requirement release can be published', async () => {
  const f = await fixture({ capacity: 1 });
  for (const name of ['CAPACITY-ONE', 'CAPACITY-TWO']) {
    const person = await employee(name);
    await context.db.insert(schema.learningEnrollments).values({ courseId: f.course.id, employeeId: person.id, status: 'approved', courseSnapshot: { ...f.definition, version: 1 }, requestedBy: f.admin.id, approverId: f.admin.id });
  }
  expect((await request(f.admin.token)).body.items[0]).toMatchObject({ canPublish: false });
  const result = await request(f.admin.token, f.path, f.body);
  expect(result.status).toBe(409); expect(result.body.message).toContain('Capacity');
  expect((await pg.query('SELECT id FROM learning_induction_releases')).rows).toHaveLength(1);
});

test('new onboarding uses the matching current requirement release and no existing employees are auto-assigned', async () => {
  const f = await fixture(); await employee('EXISTING');
  const updated = await request(f.admin.token, f.path, f.body); expect(updated.status).toBe(200);
  expect(await context.db.select().from(schema.learningEnrollments)).toEqual([]);
  const matched = await employee('NEW-MATCH'), wrongType = await employee('NEW-TEMP', 'temporary'), wrongDepartment = await employee('NEW-DEPT', 'permanent', 'Finance');
  const actor = { userId: f.admin.id, username: f.admin.username, role: f.admin.role, department: f.admin.department };
  for (const row of [matched, wrongType, wrongDepartment]) await context.db.transaction((tx: any) => assignOnboardingInduction(tx, actor, row));
  const assignments = await context.db.select().from(schema.learningEnrollments);
  expect(assignments).toHaveLength(1); expect(assignments[0].employeeId).toBe(matched.id);
  expect((await pg.query<any>('SELECT release_id,required FROM learning_induction_enrollments')).rows[0]).toEqual({ release_id: updated.body.publishedReleaseId, required: true });
});
