import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { defaultInductionSettings } from '../shared/induction';
const ctx = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: {} }));
import router from '../server/routes/induction';
import learning from '../server/routes/learning';
import { authService } from '../server/services/auth';
import { pendingInduction } from '../server/services/induction-learning';
let pg: PGlite, server: Server, base: string;
const reason = 'Synthetic induction workflow verification';
async function account(name: string, role: s.UserRole) {
  const password = 'SyntheticInduction8!', [u] = await ctx.db.insert(s.users).values({ username: name, email: name + '@example.test', password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...u, token: (await authService.login(name, password)).accessToken };
}
async function call(user: any, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + user.token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text() };
}
async function ok(user: any, path: string, body?: unknown, method?: string) { const result = await call(user, path, body, method); expect(result.status, JSON.stringify(result.body)).toBeLessThan(300); return result.body; }
async function fixture(settings = {}) {
  const admin = await account('author', 'super_admin'), reviewer = await account('reviewer', 'hr_director'), alice = await account('alice', 'permanent_employee'), bob = await account('bob', 'permanent_employee');
  const [employee] = await ctx.db.insert(s.employees).values({ userId: alice.id, employeeId: 'QA-LEARNER', firstName: 'Synthetic', lastName: 'Learner', gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: 'QA-QID', primaryMobile: '00000000', residentialAddress: 'Synthetic', emergencyContactName: 'Synthetic', emergencyContactNumber: '00000000', type: 'permanent', department: 'Operations', position: 'Host', location: 'Synthetic', joiningDate: '2025-01-01' }).returning();
  const correct = randomUUID(), wrong = randomUUID(), question = randomUUID(), lesson = randomUUID();
  const content = { settings: { ...defaultInductionSettings, shuffleOptions: false, shuffleQuestions: false, mandatoryForOnboarding: true, ...settings }, lessons: [{ id: lesson, title: 'Synthetic lesson', kind: 'text', body: 'Synthetic lesson content for verification.', assetId: null, required: true, estimatedMinutes: 5 }], questions: [{ id: question, prompt: 'Choose the synthetic answer?', kind: 'single', points: 2, options: [{ id: correct, text: 'Option A' }, { id: wrong, text: 'Option B' }], correctOptionIds: [correct], explanation: 'PRIVATE-ANSWER-EXPLANATION' }] };
  const definition = { title: 'Synthetic induction', description: 'Synthetic local course', provider: 'Internal', format: 'self_paced', delivery: 'internal', url: '', durationMinutes: 5, capacity: null, passScore: 80, requiresEvidence: false, validMonths: null, approverId: reviewer.id, status: 'draft' };
  const created = await ok(admin, '/induction/courses', { definition, content, reason });
  const published = await ok(admin, `/induction/courses/${created.id}/publish`, { version: created.version, draftVersion: 1, reason });
  const assigned = await ok(admin, `/induction/courses/${created.id}/assign`, { employeeIds: [employee.id], releaseId: published.releaseId, dueDate: null, required: true, reason });
  return { admin, reviewer, alice, bob, employee, content, definition, created, published, id: assigned.created[0].id, correct, wrong, question, lesson };
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  const completed = await ok(f.alice, `/induction/enrollments/${f.id}/lessons/${f.lesson}/complete`, { version: 1, confirmed: true });
  return ok(f.alice, `/induction/enrollments/${f.id}/attempts/start`, { version: completed.row.version, key: randomUUID() });
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'induction-workflow-access-long-secret'; process.env.JWT_REFRESH_SECRET = 'induction-workflow-refresh-long-secret'; process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite(); for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  ctx.db = drizzle(pg); const app = express(); app.use(express.json()); app.use('/induction', router); app.use('/learning', learning);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = 'http://127.0.0.1:' + (server.address() as any).port;
});
beforeEach(async () => {
  // Keep token issuance near database now(), which records quiz submission times.
  const clock = new Date(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(clock);
  await pg.exec('TRUNCATE users,employees,app_settings RESTART IDENTITY CASCADE');
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { if (server) await new Promise<void>(r => server.close(() => r())); await pg?.close(); });

test('learner must complete lessons, receives no answer keys, and cannot submit another employee quiz or a forged score', async () => {
  const f = await fixture();
  expect((await call(f.alice, `/induction/courses/${f.created.id}/draft`)).status).toBe(403);
  expect((await call(f.bob, `/induction/enrollments/${f.id}`)).status).toBe(404);
  expect((await call(f.alice, `/induction/enrollments/${f.id}/attempts/start`, { version: 1, key: randomUUID() })).status).toBe(409);
  expect((await call(f.admin, `/induction/enrollments/${f.id}/lessons/${f.lesson}/complete`, { version: 1, confirmed: true })).status).toBe(403);
  expect((await call(f.alice, `/learning/enrollments/${f.id}/actions`, { version: 1, action: 'submit_completion', score: 100, reason })).status).toBe(409);
  const attempt = await start(f), serialized = JSON.stringify(attempt);
  expect(serialized).not.toContain('correctOptionIds'); expect(serialized).not.toContain('PRIVATE-ANSWER-EXPLANATION');
  const path = `/induction/enrollments/${f.id}/attempts/${attempt.activeAttempt.id}/submit`, answers = [{ questionId: f.question, optionIds: [f.correct] }];
  expect((await call(f.bob, path, { answers })).status).toBe(404);
  expect((await call(f.alice, path, { answers, score: 100 })).status).toBe(400);
  const passed = await ok(f.alice, path, { answers }); expect(passed.result).toMatchObject({ passed: true, score: 100 }); expect(passed.row.status).toBe('completed');
  expect(passed.row.certificateNumber).toBeTruthy(); expect(await pendingInduction(ctx.db, f.employee.id)).toHaveLength(0);
  const replay = await ok(f.alice, path, { answers: [{ questionId: f.question, optionIds: [f.wrong] }] }); expect(replay.row.score).toBe(100);
  const certificate = await ok(f.alice, `/induction/enrollments/${f.id}/certificate`); expect(certificate).toContain(passed.row.certificateNumber);
  expect((await call(f.bob, `/induction/enrollments/${f.id}/certificate`)).status).toBe(404);
});

test('failed attempts enforce waiting time and attempt limits; required unfinished induction remains blocking', async () => {
  const f = await fixture({ maxAttempts: 2, retryDelayMinutes: 10 }), first = await start(f);
  const submit = (attempt: any) => ok(f.alice, `/induction/enrollments/${f.id}/attempts/${attempt.activeAttempt.id}/submit`, { answers: [{ questionId: f.question, optionIds: [f.wrong] }] });
  const failed = await submit(first); expect(failed.row.status).toBe('in_progress'); expect(failed.result.score).toBe(0);
  expect((await call(f.alice, `/induction/enrollments/${f.id}/attempts/start`, { version: failed.row.version, key: randomUUID() })).status).toBe(409);
  // Database records the real submission time; move the browser/server clock relative to that saved timestamp.
  vi.setSystemTime(new Date(Date.parse(failed.retryAfter) + 1));
  const second = await ok(f.alice, `/induction/enrollments/${f.id}/attempts/start`, { version: failed.row.version, key: randomUUID() });
  const exhausted = await submit(second); expect(exhausted.row.status).toBe('failed'); expect(exhausted.attemptsRemaining).toBe(0);
  expect((await call(f.alice, `/induction/enrollments/${f.id}/attempts/start`, { version: exhausted.row.version, key: randomUUID() })).status).toBe(409);
  expect(await pendingInduction(ctx.db, f.employee.id)).toHaveLength(1);
  expect((await call(f.alice, `/induction/enrollments/${f.id}/exempt`, { version: exhausted.row.version, reason })).status).toBe(403);
  await ok(f.reviewer, `/induction/enrollments/${f.id}/exempt`, { version: exhausted.row.version, reason });
  expect(await pendingInduction(ctx.db, f.employee.id)).toHaveLength(0);
});

test('expired timed attempts commit failure and cannot mint a certificate', async () => {
  const f = await fixture({ maxAttempts: 1, attemptMinutes: 1 }), attempt = await start(f);
  vi.setSystemTime(new Date(Date.parse(attempt.activeAttempt.expiresAt) + 1));
  expect((await call(f.alice, `/induction/enrollments/${f.id}/attempts/${attempt.activeAttempt.id}/submit`, { answers: [{ questionId: f.question, optionIds: [f.correct] }] })).status).toBe(409);
  const detail = await ok(f.alice, `/induction/enrollments/${f.id}`); expect(detail.row.status).toBe('failed'); expect(detail.attempts[0].status).toBe('expired');
  expect((await call(f.alice, `/induction/enrollments/${f.id}/certificate`)).status).toBe(409);
});

test('reviewed completion requires the independent assigned reviewer and preserves the server quiz score', async () => {
  const f = await fixture({ reviewRequired: true }), attempt = await start(f);
  const passed = await ok(f.alice, `/induction/enrollments/${f.id}/attempts/${attempt.activeAttempt.id}/submit`, { answers: [{ questionId: f.question, optionIds: [f.correct] }] });
  expect(passed.row.status).toBe('completion_submitted'); expect(passed.row.certificateNumber).toBeNull();
  const path = `/learning/enrollments/${f.id}/actions`, body = { version: passed.row.version, action: 'verify', score: 0, reason };
  expect((await call(f.admin, path, body)).status).toBe(403);
  await ok(f.reviewer, path, body);
  const detail = await ok(f.alice, `/induction/enrollments/${f.id}`); expect(detail.row).toMatchObject({ status: 'completed', score: 100, verifiedBy: f.reviewer.id });
});

test('publishing a revised quiz does not alter enrolled learners and assignment retries reuse one record', async () => {
  const f = await fixture();
  const draft = await ok(f.admin, `/induction/courses/${f.created.id}/draft`);
  const changed = await ok(f.admin, `/induction/courses/${f.created.id}/draft`, { version: draft.course.version, draftVersion: draft.draft.version, definition: draft.draft.definition, content: { ...f.content, lessons: [{ ...f.content.lessons[0], body: 'A new published lesson that the existing learner must not receive.' }] }, reason }, 'PUT');
  const next = await ok(f.admin, `/induction/courses/${f.created.id}/publish`, { version: changed.version, draftVersion: changed.draftVersion, reason });
  const detail = await ok(f.alice, `/induction/enrollments/${f.id}`); expect(detail.releaseNumber).toBe(1); expect(detail.content.lessons[0].body).toBe(f.content.lessons[0].body);
  const retry = await ok(f.admin, `/induction/courses/${f.created.id}/assign`, { employeeIds: [f.employee.id], releaseId: next.releaseId, dueDate: null, required: true, reason });
  expect(retry.created).toHaveLength(0); expect(retry.skipped[0].enrollmentId).toBe(f.id);
  expect(await ctx.db.select().from(s.learningEnrollments)).toHaveLength(1);
});
