import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, afterEach, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
const ctx = vi.hoisted(() => ({ db: null as any, query: vi.fn(), configured: vi.fn(), probe: vi.fn(), cleanup: vi.fn(), fingerprint: vi.fn() }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: { query: ctx.query } }));
vi.mock('../server/services/r2', () => ({ privateStorageConfigured: ctx.configured }));
vi.mock('../server/services/storage-verification', () => ({ storageConfigurationFingerprint: ctx.fingerprint, verifyPrivateStorage: ctx.probe, retryStorageCheckCleanup: ctx.cleanup }));
import router from '../server/routes/system-readiness';
import { authService } from '../server/services/auth';
let pg: PGlite, server: Server, base: string;
const password = 'ReadinessExample8!', key = 'system:storage-verification';
async function account(name: string, role: s.UserRole) {
  await ctx.db.insert(s.users).values({ username: name, email: `${name}@example.test`, password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, isActive: true, approvalStatus: 'approved' });
  return (await authService.login(name, password)).accessToken;
}
async function request(token?: string, path = '', body?: unknown) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, cache: response.headers.get('cache-control'), body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
}
const result = () => ({ checkedAt: new Date().toISOString(), status: 'passed', cleanupKey: null, steps: ['upload', 'read', 'download', 'privacy', 'cleanup'].map(id => ({ id, status: 'passed' })) });
beforeAll(async () => {
  process.env.JWT_SECRET = 'readiness-access-secret-at-least-thirtytwo'; process.env.JWT_REFRESH_SECRET = 'readiness-refresh-secret-at-least-thirtytwo';
  pg = new PGlite(); for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  ctx.db = drizzle(pg); const app = express(); app.use(express.json()); app.use('/readiness', router);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/readiness`;
});
beforeEach(async () => {
  vi.clearAllMocks(); await pg.exec('TRUNCATE users,app_settings,activity_logs RESTART IDENTITY CASCADE');
  ctx.query.mockResolvedValue({ rows: [] }); ctx.configured.mockReturnValue(true); ctx.fingerprint.mockReturnValue('current-fingerprint'); ctx.probe.mockImplementation(async () => result()); ctx.cleanup.mockResolvedValue(undefined);
  vi.stubEnv('STORAGE_PROVIDER', 'supabase'); vi.stubEnv('APP_TIMEZONE', 'Asia/Qatar'); vi.stubEnv('APP_URL', 'https://synthetic.example.test'); vi.stubEnv('RESEND_API_KEY', 'PRIVATE-KEY'); vi.stubEnv('EMAIL_FROM', 'HR <hr@example.test>');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (pg) await pg.close(); });

test('only authenticated administrators can inspect configuration, run probes or download recovery guidance', async () => {
  const admin = await account('admin', 'admin'), hr = await account('hr', 'hr'), employee = await account('employee', 'permanent_employee');
  expect((await request()).status).toBe(401);
  for (const token of [hr, employee]) { expect((await request(token)).status).toBe(403); expect((await request(token, '/storage-check', {})).status).toBe(403); expect((await request(token, '/recovery-guide')).status).toBe(403); }
  const response = await request(admin); expect(response.status).toBe(200); expect(response.cache).toBe('no-store'); expect(response.body.storage.lastCheck).toBeNull(); expect(response.body.email.delivery).toBe('not_verified'); expect(JSON.stringify(response.body)).not.toContain('PRIVATE'); expect(ctx.probe).not.toHaveBeenCalled();
  expect((await request(admin, '/recovery-guide')).body).toContain('Encrypted database backups');
});

test('service status distinguishes connection failure and bad configuration without returning raw errors', async () => {
  const admin = await account('admin', 'super_admin'); ctx.query.mockRejectedValue(new Error('PRIVATE database URL'));
  vi.stubEnv('APP_URL', 'https://user:PRIVATE@example.test'); vi.stubEnv('APP_TIMEZONE', 'Invalid/Timezone'); vi.stubEnv('EMAIL_FROM', 'invalid');
  const response = await request(admin); expect(response.status).toBe(200); expect(response.body.database.status).toBe('unavailable'); expect(response.body.application.timezoneValid).toBe(false); expect(response.body.email.configured).toBe(false); expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
});

test('explicit storage probe saves safe results with audit history and enforces cooldown', async () => {
  const admin = await account('admin', 'super_admin');
  expect((await request(admin, '/storage-check', { key: 'documents/1/private.pdf' })).status).toBe(400);
  const response = await request(admin, '/storage-check', {}); expect(response.status, response.body.message).toBe(200); expect(response.body.status).toBe('passed');
  const state = (await request(admin)).body; expect(state.storage.lastCheck.status).toBe('passed'); expect(state.storage.running).toBe(false);
  const logs = await ctx.db.select().from(s.activityLogs).where(eq(s.activityLogs.entityType, 'storage_verification')); expect(logs).toHaveLength(2);
  expect((await request(admin, '/storage-check', {})).status).toBe(429); expect(ctx.probe).toHaveBeenCalledOnce();
});

test('an active lease prevents concurrent probes and a changed configuration marks historical evidence', async () => {
  const admin = await account('admin', 'admin');
  await ctx.db.insert(s.appSettings).values({ key, value: { runId: 'dc02a830-a28a-45f3-943c-98668eaa224f', startedAt: new Date().toISOString(), fingerprint: 'old-fingerprint', result: result() } });
  expect((await request(admin, '/storage-check', {})).status).toBe(409);
  const response = await request(admin); expect(response.body.storage.running).toBe(true); expect(response.body.storage.configurationChanged).toBe(true); expect(ctx.probe).not.toHaveBeenCalled();
});

test('cleanup retries only the stored synthetic key and rejects stale requests and changed destinations', async () => {
  const admin = await account('admin', 'super_admin'), saved = { ...result(), status: 'failed', cleanupKey: 'deployment-checks/dc02a830-a28a-45f3-943c-98668eaa224f.txt' };
  saved.steps[4].status = 'failed';
  await ctx.db.insert(s.appSettings).values({ key, value: { runId: null, startedAt: null, fingerprint: 'current-fingerprint', result: saved } });
  expect((await request(admin, '/storage-cleanup', { checkedAt: '2020-01-01T00:00:00.000Z' })).status).toBe(409);
  ctx.fingerprint.mockReturnValue('changed'); expect((await request(admin, '/storage-cleanup', { checkedAt: saved.checkedAt })).status).toBe(409);
  ctx.fingerprint.mockReturnValue('current-fingerprint'); expect((await request(admin, '/storage-cleanup', { checkedAt: saved.checkedAt })).status).toBe(200);
  expect(ctx.cleanup).toHaveBeenCalledExactlyOnceWith(saved.cleanupKey);
  const state = (await request(admin)).body.storage.lastCheck; expect(state.cleanupKey).toBeNull(); expect(state.status).toBe('failed'); expect(state.checkedAt).toBe(saved.checkedAt);
});
