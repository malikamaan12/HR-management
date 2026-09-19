import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, test, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { defaultCompanySettings } from '../shared/settings';
import { emptyCompensation } from '../shared/compensation';
import { letterDefinition, templateFields, renderLetterText } from '../shared/hr-letters';
const ctx = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: {} }));
import router from '../server/routes/hr-letters';
import { authService } from '../server/services/auth';
let pg: PGlite, server: Server, base: string, admin: any, reviewer: any, worker: any, manager: any, other: any, employee: any, otherEmployee: any;
const password = 'LetterExample8!', why = 'Synthetic workflow validation';
const definition = { name: 'Employment confirmation', description: 'Synthetic example', title: 'Confirmation for {{employee_name}}', body: '{{employee_name}} works at {{company_name}} as {{position}} since {{joining_date}}.\nRecipient: {{recipient}}\nPurpose: {{purpose}}', signatoryTitle: 'Human Resources', employeeTypes: ['permanent', 'temporary', 'contract'] };
async function account(name: string, role: s.UserRole, department = 'Operations') {
  const [row] = await ctx.db.insert(s.users).values({ username: name, email: `${name}@example.test`, password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department, isActive: true, approvalStatus: 'approved' }).returning();
  return { ...row, token: (await authService.login(name, password)).accessToken };
}
async function employeeRow(n: number, userId: number, department = 'Operations') {
  return (await ctx.db.insert(s.employees).values({ employeeId: 'LETTER-' + n, firstName: 'Test', lastName: 'Employee ' + n, userId, gender: 'other', dateOfBirth: '1990-01-01', nationality: 'Synthetic', qidNumber: 'SECRET-QID-' + n, primaryMobile: 'SECRET-PHONE', residentialAddress: 'SECRET-ADDRESS', emergencyContactName: 'SECRET-CONTACT', emergencyContactNumber: 'SECRET-NUMBER', department, position: 'Event host', location: 'Test venue', type: 'temporary', joiningDate: '2020-01-01' }).returning())[0];
}
async function request(actor: any, path: string, body?: any, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { ...(actor ? { Authorization: 'Bearer ' + actor.token } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, cache: response.headers.get('cache-control'), body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
}
async function published(content = definition, code = 'employment') {
  const created = await request(admin, '/templates', { code, definition: content, reason: why }); expect(created.status, created.body.message).toBe(201);
  const result = await request(admin, `/templates/${created.body.id}/publish`, { version: 1, reason: why }); expect(result.status, result.body.message).toBe(200); return result.body;
}
async function requested(template: any, actor = worker, employeeId = employee.id) {
  const result = await request(actor, '/requests', { employeeId, templateId: template.id, recipient: 'Test recipient', purpose: why, submissionKey: randomUUID() }); expect(result.status, result.body.message).toBe(201); return result.body;
}
async function action(row: any, name: string, actor = admin) {
  return request(actor, `/requests/${row.id}/${name}`, { version: row.version, reason: why, ...(name === 'issue' || name === 'revoke' ? { confirmed: true } : {}) });
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'letters-access-secret-at-least-thirtytwo'; process.env.JWT_REFRESH_SECRET = 'letters-refresh-secret-at-least-thirtytwo'; process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite(); for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  ctx.db = drizzle(pg); const app = express(); app.use(express.json()); app.use('/letters', router);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}/letters`;
});
beforeEach(async () => {
  await pg.exec('TRUNCATE users,employees,app_settings RESTART IDENTITY CASCADE');
  admin = await account('admin', 'super_admin'); reviewer = await account('reviewer', 'hr'); worker = await account('worker', 'temporary_staff'); manager = await account('manager', 'hr_manager'); other = await account('other', 'permanent_employee', 'Finance');
  employee = await employeeRow(1, worker.id); otherEmployee = await employeeRow(2, other.id, 'Finance');
  await ctx.db.insert(s.appSettings).values({ key: 'company', value: { ...defaultCompanySettings, companyName: 'Synthetic Company', companyEmail: 'hr@example.test' } });
});
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (pg) await pg.close(); });

test('template placeholders are constrained and substituted as literal values without recursive evaluation', () => {
  expect(() => templateFields('{{password}}')).toThrow(); expect(() => templateFields('{{employee_name')).toThrow(); expect(() => templateFields('{{__proto__}}')).toThrow();
  expect(renderLetterText('Dear {{employee_name}}', { employee_name: '{{company_name}}' })).toBe('Dear {{company_name}}');
  expect(() => renderLetterText('{{position}}', {})).toThrow(/Complete/);
  expect(() => renderLetterText('{{compensation_breakdown}}'.repeat(3), { compensation_breakdown: 'x'.repeat(50000) })).toThrow(/too long/);
  expect(letterDefinition.safeParse({ ...definition, body: '{{eval(x)}}' }).success).toBe(false);
});

test('templates require admin publishing, hide draft content, reject stale changes and preserve published revisions', async () => {
  expect((await request(null, '/context')).status).toBe(401);
  expect((await request(reviewer, '/templates', { code: 'example', definition, reason: why })).status).toBe(403);
  const created = await request(admin, '/templates', { code: 'example', definition, reason: why }); expect(created.status).toBe(201);
  expect((await request(worker, '/templates')).body.items).toHaveLength(0);
  expect((await request(worker, '/templates?all=true')).status).toBe(403);
  expect((await request(admin, `/templates/${created.body.id}`, { version: 9, definition, reason: why }, 'PATCH')).status).toBe(409);
  const pub = (await request(admin, `/templates/${created.body.id}/publish`, { version: 1, reason: why })).body;
  expect((await request(admin, `/templates/${pub.id}`, { version: pub.version, definition, reason: why }, 'PATCH')).status).toBe(409);
  const catalogue = await request(worker, '/templates'); expect(catalogue.body.items[0]).not.toHaveProperty('definition'); expect(catalogue.cache).toBe('no-store');
  await expect(pg.query('UPDATE hr_letter_templates SET definition=$1 WHERE id=$2', [{ ...definition, name: 'tampered' }, pub.id])).rejects.toThrow(/immutable/);
});

test('request creation is idempotent and rejects protected fields and cross-employee access', async () => {
  const template = await published(), input = { employeeId: employee.id, templateId: template.id, recipient: 'Test recipient', purpose: why, submissionKey: randomUUID() };
  const first = await request(worker, '/requests', input), second = await request(worker, '/requests', input); expect(second.body.id).toBe(first.body.id);
  expect((await request(worker, '/requests', { ...input, purpose: 'Different purpose' })).status).toBe(409);
  expect((await request(worker, '/requests', { ...input, status: 'issued' })).status).toBe(400);
  expect((await request(worker, '/requests', { ...input, employeeId: otherEmployee.id, submissionKey: randomUUID() })).status).toBe(404);
  expect((await request(other, `/requests/${first.body.id}`)).status).toBe(404);
  expect((await request(other, `/requests/${first.body.id}/print`)).status).toBe(404);
});

test('department HR scope is enforced in queues, details, preparation and employee directory', async () => {
  const template = await published(), outside = await requested(template, other, otherEmployee.id);
  expect((await request(manager, `/requests/${outside.id}`)).status).toBe(404);
  expect((await action(outside, 'prepare', manager)).status).toBe(404);
  expect((await request(manager, '/requests?view=team')).body.items).toHaveLength(0);
  expect((await request(manager, '/employees')).body.items.map((row: any) => row.id)).toEqual([employee.id]);
});

test('employee request flows through independent preparation and issue to safe printable content', async () => {
  const row = await requested(await published()); expect((await request(worker, `/requests/${row.id}/print`)).status).toBe(409);
  const prepared = (await action(row, 'prepare')).body; expect(prepared.status).toBe('prepared'); expect(prepared.snapshot.body).toContain('Synthetic Company');
  expect(JSON.stringify(prepared)).not.toContain('SECRET-'); expect((await action(prepared, 'issue')).status).toBe(403); expect((await action(prepared, 'issue', worker)).status).toBe(403);
  const issued = await action(prepared, 'issue', reviewer); expect(issued.status, issued.body.message).toBe(200); expect(issued.body.status).toBe('issued');
  const print = await request(worker, `/requests/${row.id}/print`); expect(print.status).toBe(200); expect(print.body).toContain(row.reference); expect(print.body).not.toContain('SECRET-');
  expect((await action(prepared, 'issue', reviewer)).status).toBe(409);
  await expect(pg.query("UPDATE hr_letter_requests SET snapshot='{}'::jsonb WHERE id=$1", [row.id])).rejects.toThrow(/immutable/);
});

test('changed employee/company facts block issue until HR prepares a new copy', async () => {
  const row = await requested(await published()), prepared = (await action(row, 'prepare')).body;
  await ctx.db.update(s.employees).set({ position: 'Senior event host' }).where(eq(s.employees.id, employee.id));
  expect((await action(prepared, 'issue', reviewer)).status).toBe(409);
  const refreshed = (await action(prepared, 'prepare')).body; expect(refreshed.snapshot.body).toContain('Senior event host');
  expect((await action(refreshed, 'issue', reviewer)).status).toBe(200);
});

test('return, employee correction and cancellation preserve versioned history', async () => {
  const template = await published(), row = await requested(template), returned = (await action(row, 'return', reviewer)).body;
  expect(returned.status).toBe('returned');
  expect((await request(other, `/requests/${row.id}`, { version: returned.version, templateId: template.id, recipient: 'Corrected recipient', purpose: why }, 'PATCH')).status).toBe(404);
  const corrected = (await request(worker, `/requests/${row.id}`, { version: returned.version, templateId: template.id, recipient: 'Corrected recipient', purpose: why }, 'PATCH')).body;
  expect(corrected.status).toBe('requested'); expect(corrected.snapshot).toBeNull();
  expect((await action(corrected, 'cancel', worker)).body.status).toBe('cancelled');
  const detail = (await request(worker, `/requests/${row.id}`)).body; expect(detail.history).toHaveLength(4); expect(detail.actions.prepare).toBe(false);
});

test('archiving a template retires every revision without altering issued letters', async () => {
  const template = await published(), row = await requested(template), prepared = (await action(row, 'prepare')).body, issued = (await action(prepared, 'issue', reviewer)).body;
  const draft = (await request(admin, `/templates/${template.id}/revise`, { version: template.version, reason: why })).body;
  const revision = (await request(admin, `/templates/${draft.id}/publish`, { version: draft.version, reason: why })).body;
  expect((await request(admin, `/templates/${revision.id}/archive`, { version: revision.version, reason: why })).status).toBe(200);
  expect((await request(worker, '/templates')).body.items).toHaveLength(0);
  expect((await request(worker, `/requests/${issued.id}/print`)).status).toBe(200);
  expect((await request(worker, '/requests', { employeeId: employee.id, templateId: template.id, recipient: 'Test', purpose: why, submissionKey: randomUUID() })).status).toBe(409);
});

test('revocation keeps the original content and blocks further printable downloads', async () => {
  const row = await requested(await published()), prepared = (await action(row, 'prepare')).body, issued = (await action(prepared, 'issue', reviewer)).body;
  expect((await action(issued, 'revoke', worker)).status).toBe(403);
  const revoked = (await action(issued, 'revoke', admin)).body; expect(revoked.snapshot).toEqual(issued.snapshot); expect(revoked.status).toBe('revoked');
  expect((await request(worker, `/requests/${row.id}/print`)).status).toBe(409);
});

test('salary letters require recorded compensation and preserve payment frequencies and revision evidence', async () => {
  const template = await published({ ...definition, body: '{{compensation_breakdown}}\nMonthly cash: {{monthly_cash_total}}' }), row = await requested(template);
  expect((await action(row, 'prepare')).status).toBe(409);
  const compensation = emptyCompensation(); compensation.items[0] = { ...compensation.items[0], amount: '150.00', frequency: 'per_event' };
  compensation.items.find(item => item.category === 'housing')!.provision = 'cash'; compensation.items.find(item => item.category === 'housing')!.amount = '200.00';
  compensation.items.find(item => item.category === 'flight_tickets')!.provision = 'cash'; compensation.items.find(item => item.category === 'flight_tickets')!.amount = '1000.00';
  await ctx.db.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by) VALUES(${employee.id},1,'2020-01-01',${JSON.stringify(compensation)}::jsonb,${why},${admin.id})`);
  const prepared = (await action(row, 'prepare')).body; expect(prepared.snapshot.body).toContain('150.00 QAR per assigned event shift'); expect(prepared.snapshot.body).toContain('1000.00 QAR per year'); expect(prepared.snapshot.body).toContain('Monthly cash: 200.00 QAR'); expect(prepared.snapshot.compensationVersion).toBe(1);
  await ctx.db.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by) VALUES(${employee.id},2,'2020-01-01',${JSON.stringify(compensation)}::jsonb,${why},${admin.id})`);
  expect((await action(prepared, 'issue', reviewer)).status).toBe(409);
});

test('HTML from recipient and source values is escaped in the printable document', async () => {
  const template = await published(), result = await request(worker, '/requests', { employeeId: employee.id, templateId: template.id, recipient: '<script>alert(1)</script>', purpose: why, submissionKey: randomUUID() });
  const prepared = (await action(result.body, 'prepare')).body, issued = (await action(prepared, 'issue', reviewer)).body;
  const print = (await request(worker, `/requests/${issued.id}/print`)).body; expect(print).not.toContain('<script>'); expect(print).toContain('&lt;script&gt;');
});

test('missing company details or inactive employment prevent preparation, and audit failure rolls back creation', async () => {
  const template = await published(), row = await requested(template); await ctx.db.delete(s.appSettings).where(eq(s.appSettings.key, 'company'));
  expect((await action(row, 'prepare')).status).toBe(409);
  await ctx.db.update(s.employees).set({ status: 'inactive' }).where(eq(s.employees.id, employee.id)); expect((await action(row, 'prepare')).status).toBe(409);
  await pg.exec("CREATE FUNCTION fail_letter_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.kind='letter_template' THEN RAISE EXCEPTION 'synthetic audit error'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_letter_history BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION fail_letter_audit()");
  try {
    expect((await request(admin, '/templates', { code: 'rollback-template', definition, reason: why })).status).toBe(500);
    expect((await pg.query("SELECT count(*)::int AS count FROM hr_letter_templates WHERE code='rollback-template'")).rows[0].count).toBe(0);
  } finally { await pg.exec('DROP TRIGGER fail_letter_history ON hr_workflow_history; DROP FUNCTION fail_letter_audit()'); }
});
