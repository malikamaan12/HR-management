import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { employees, users, activityLogs, employeeLifecycleEvents, documents, documentVersions, type InsertEmployee } from '../shared/schema';
const context = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return context.db; }, pool: {} }));
const files = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
vi.mock('../server/services/r2', () => ({
  uploadDocument: files.upload, deleteDocumentObject: files.remove,
  validateDocumentFile: vi.fn(), documentDownloadUrl: vi.fn(),
  StorageUnavailableError: class extends Error {},
}));
import router from '../server/routes/employeeRecords';
import { authService } from '../server/services/auth';
import settingsRouter from '../server/routes/settings';
import leaveRouter from '../server/routes/leaveRequests';
import documentRouter from '../server/routes/documents';
import {defaultCompanySettings} from '../shared/settings';

let pg: PGlite, server: Server, base: string;
const password = 'EmployeeTest8!';
const input = (index = 1): InsertEmployee => ({ employeeId: `EMP-${String(index).padStart(4, '0')}`, firstName: 'Person', lastName: String(index).padStart(4, '0'),
  gender: 'female', dateOfBirth: '1990-05-13', nationality: 'Test', qidNumber: String(10000000000 + index), primaryMobile: 'private-phone',
  residentialAddress: 'private-address', emergencyContactName: 'private-contact', emergencyContactNumber: 'private-emergency', personalEmail: 'private@example.test',
  religion: 'other', bloodGroup: 'a_positive', ibanNumber: 'private-bank', type: 'permanent', department: 'Operations', position: 'Host', location: 'Mall FEC', joiningDate: '2026-05-01' });
async function account(role = 'super_admin', name = role) {
  const [user] = await context.db.insert(users).values({ username: name, password: await bcrypt.hash(password, 4), email: name + '@example.test', firstName: name,
    lastName: 'Test', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...user, token: (await authService.login(name, password)).accessToken };
}
async function request(token: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as any };
}
async function create(index = 1, extra: Partial<InsertEmployee> = {}) {
  const [employee] = await context.db.insert(employees).values({ ...input(index), ...extra }).returning();
  return employee;
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'employee-records-test-access-secret-32-characters';
  process.env.JWT_REFRESH_SECRET = 'employee-records-test-refresh-secret-32-characters';
  pg = new PGlite();
  for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  context.db = drizzle(pg);
  const app = express(); app.use(express.json()); app.use('/employees', router); app.use('/settings',settingsRouter); app.use('/leaves',leaveRouter); app.use('/documents',documentRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
beforeEach(async () => {
  await pg.exec('TRUNCATE users, employees, activity_logs, app_settings RESTART IDENTITY CASCADE');
  files.upload.mockReset().mockResolvedValue('documents/1/test.pdf'); files.remove.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await pg.close(); });

test('employee endpoints require a valid session', async () => {
  for (const path of ['/employees', '/employees/directory', '/employees/1', '/employees/1/activity']) expect((await request('', path)).status).toBe(401);
});

test('lifecycle form payload records history without an employee ID and protects private notes', async () => {
  const admin = await account();
  const manager = await account('manager'); const lead = await create(1, { userId: manager.id });
  const self = await account('permanent_employee'); const employee = await create(2, { userId: self.id, reportingManagerId: lead.id });
  const payload = { eventType: 'promotion', effectiveDate: '2026-05-02', reason: 'Approved promotion review', notes: 'Private employment notes', expectedVersion: employee.recordVersion };
  const result = await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', payload);
  expect(result.status).toBe(201); expect(result.body.employee.recordVersion).toBe(employee.recordVersion + 1);
  expect((await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', payload)).status).toBe(409);
  expect((await request(manager.token, `/employees/${employee.id}/lifecycle`)).status).toBe(403);
  expect((await request(self.token, `/employees/${employee.id}/lifecycle`)).body.history[0].notes).toBe(payload.notes);
  expect((await request(self.token, `/employees/${employee.id}/lifecycle`, 'POST', payload)).status).toBe(403);
  expect((await context.db.select().from(employeeLifecycleEvents))).toHaveLength(1);
});

test('termination disables linked login and sessions; future and stale status changes are rejected', async () => {
  const admin = await account(); const self = await account('permanent_employee');
  const employee = await create(1, { userId: self.id });
  const payload = { eventType: 'termination', effectiveDate: '2026-05-03', reason: 'Employment ended by agreement', expectedVersion: employee.recordVersion };
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  expect((await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', { ...payload, effectiveDate: future })).status).toBe(400);
  expect((await authService.login(self.username, password)).accessToken).toBeTruthy();
  const ended = await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', payload);
  expect(ended.status).toBe(201); expect(ended.body.employee.status).toBe('inactive');
  expect((await request(self.token, `/employees/${employee.id}`)).status).toBe(401);
  await expect(authService.login(self.username, password)).rejects.toThrow(/inactive/);
  const reactivated = await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', { ...payload, eventType: 'reactivation', effectiveDate: '2026-05-04', expectedVersion: ended.body.employee.recordVersion });
  expect(reactivated.status).toBe(201); expect(reactivated.body.employee.status).toBe('active');
  await expect(authService.login(self.username, password)).rejects.toThrow(/inactive/);
});

test('lifecycle history and status changes roll back together when auditing fails', async () => {
  const admin = await account(); const employee = await create();
  await pg.exec("CREATE FUNCTION reject_lifecycle_audit() RETURNS trigger AS $$ BEGIN IF NEW.entity_type = 'employee_lifecycle' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_lifecycle_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_audit();");
  try {
    expect((await request(admin.token, `/employees/${employee.id}/lifecycle`, 'POST', { eventType: 'termination', effectiveDate: '2026-05-03', reason: 'Test rollback guarantee', expectedVersion: employee.recordVersion })).status).toBe(500);
    expect((await context.db.select().from(employeeLifecycleEvents))).toHaveLength(0);
    expect((await context.db.select().from(employees).where(eq(employees.id, employee.id)))[0].status).toBe('active');
  } finally { await pg.exec('DROP TRIGGER reject_lifecycle_audit ON activity_logs; DROP FUNCTION reject_lifecycle_audit();'); }
});

async function uploadDocumentFor(token: string, employeeId: number) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ employeeId: String(employeeId), documentType: 'passport', documentNumber: 'TEST-123', issueDate: '2026-01-01', expiryDate: '2027-01-01' })) body.append(key, value);
  body.append('document', new Blob(['%PDF-test'], { type: 'application/pdf' }), 'test.pdf');
  const response = await fetch(base + '/documents', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  return { status: response.status, body: await response.json() as any };
}

test('document upload records an atomic initial snapshot with scoped version access', async () => {
  const admin = await account(); const self = await account('permanent_employee');
  const unrelated = await account('permanent_employee', 'unrelated');
  const employee = await create(1, { userId: self.id }); await create(2, { userId: unrelated.id });
  const uploaded = await uploadDocumentFor(admin.token, employee.id);
  expect(uploaded.status).toBe(201);
  const history = await request(self.token, `/documents/${uploaded.body.id}/versions`);
  expect(history.status).toBe(200); expect(history.body).toHaveLength(1);
  expect(history.body[0]).toMatchObject({ version: 1, createdBy: admin.id, snapshot: { documentNumber: 'TEST-123', employeeId: employee.id } });
  expect((await request(unrelated.token, `/documents/${uploaded.body.id}/versions`)).status).toBe(404);
});

test('failed snapshot persistence rolls back the document and removes the uploaded object', async () => {
  const admin = await account(); const employee = await create();
  await pg.exec("CREATE FUNCTION reject_document_version() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test version failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_document_version BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION reject_document_version();");
  try {
    expect((await uploadDocumentFor(admin.token, employee.id)).status).toBe(500);
    expect((await context.db.select().from(documents))).toHaveLength(0);
    expect((await context.db.select().from(documentVersions))).toHaveLength(0);
    expect(files.remove).toHaveBeenCalledWith('documents/1/test.pdf');
  } finally { await pg.exec('DROP TRIGGER reject_document_version ON document_versions; DROP FUNCTION reject_document_version();'); }
});
test('directory searches all records, counts matches, escapes wildcards and applies filters', async () => {
  const admin = await account();
  await context.db.insert(employees).values(Array.from({ length: 126 }, (_, i) => input(i + 1)));
  await create(127, { firstName: 'Special_100%', type: 'contract', status: 'on_leave' });
  const first = await request(admin.token, '/employees/directory?limit=25');
  expect(first.body.total).toBe(127); expect(first.body.employees).toHaveLength(25);
  const last = await request(admin.token, '/employees/directory?limit=25&page=6');
  expect(last.body.employees).toHaveLength(2);
  expect((await request(admin.token, '/employees/directory?q=EMP-0126')).body.employees[0].employeeId).toBe('EMP-0126');
  expect((await request(admin.token, '/employees/directory?q=%25')).body.total).toBe(1);
  expect((await request(admin.token, '/employees/directory?q=_&type=contract&status=on_leave')).body.total).toBe(1);
  expect((await request(admin.token, '/employees/directory?department=Unknown')).body.total).toBe(0);
  expect(first.body.employees[0]).not.toHaveProperty('qidNumber');
  expect(first.body.employees[0]).not.toHaveProperty('ibanNumber');
  expect((await request(admin.token, '/employees?limit=100')).body).toHaveLength(100);
});
test('team readers see only their own and direct reports, with private fields removed', async () => {
  const manager = await account('manager'); const own = await create(1, { userId: manager.id });
  const report = await create(2, { reportingManagerId: own.id }); const unrelated = await create(3);
  const list = await request(manager.token, '/employees/directory');
  expect(list.body.total).toBe(2); expect(list.body.canCreate).toBe(false);
  const record = await request(manager.token, `/employees/${report.id}`);
  expect(record.status).toBe(200); expect(record.body.access.canEdit).toBe(false);
  for (const field of ['qidNumber', 'ibanNumber', 'religion', 'bloodGroup', 'dateOfBirth', 'primaryMobile', 'residentialAddress', 'personalEmail', 'emergencyContactNumber', 'userId']) expect(record.body).not.toHaveProperty(field);
  expect((await request(manager.token, `/employees/${unrelated.id}`)).status).toBe(404);
  expect((await request(manager.token, `/employees/${report.id}/activity`)).status).toBe(403);
  const legacy = await request(manager.token, '/employees');
  expect(legacy.body.find((row: any) => row.id === report.id)).not.toHaveProperty('ibanNumber');
});
test('self access uses explicit account link, and finance cannot see personal demographics', async () => {
  const self = await account('permanent_employee'); const other = await create(); const own = await create(2, { userId: self.id });
  expect(other.id).toBe(self.id);
  expect((await request(self.token, `/employees/${other.id}`)).status).toBe(404);
  const record = await request(self.token, `/employees/${own.id}`);
  expect(record.body.ibanNumber).toBe('private-bank'); expect(record.body.access.canEdit).toBe(false);
  const finance = await account('finance'); const payroll = await request(finance.token, `/employees/${other.id}`);
  expect(payroll.body.ibanNumber).toBe('private-bank'); expect(payroll.body).not.toHaveProperty('bloodGroup'); expect(payroll.body).not.toHaveProperty('residentialAddress');
});
test('department HR read access remains confined to the department', async () => {
  const hr = await account('hr_manager'); const own = await create(); const outside = await create(2, { department: 'Finance' });
  expect((await request(hr.token, `/employees/${own.id}`)).body.qidNumber).toBe(own.qidNumber);
  expect((await request(hr.token, '/employees/directory')).body.total).toBe(1);
  expect((await request(hr.token, `/employees/${outside.id}`)).status).toBe(404);
});
test('create and update return a version and save an audit without sensitive field values', async () => {
  const hr = await account('hr'); const response = await request(hr.token, '/employees', 'POST', input());
  expect(response.status).toBe(201); expect(response.body.recordVersion).toBe(1);
  const updated = await request(hr.token, `/employees/${response.body.id}`, 'PATCH', { expectedVersion: 1, primaryMobile: 'new-private-phone', status: 'on_leave' });
  expect(updated.status).toBe(200); expect(updated.body.recordVersion).toBe(2);
  const history = await request(hr.token, `/employees/${response.body.id}/activity?limit=1`);
  expect(history.body.total).toBe(2); expect(history.body.history).toHaveLength(1);
  expect(history.body.history[0].details).toContain('primaryMobile'); expect(JSON.stringify(history.body)).not.toContain('new-private-phone');
});
test('rejects duplicates, blank required fields, invalid civil dates and end dates before joining', async () => {
  const hr = await account(); await create();
  expect((await request(hr.token, '/employees', 'POST', input())).status).toBe(409);
  for (const patch of [{ firstName: '  ' }, { dateOfBirth: '2000-02-30' }, { joiningDate: '1980-01-01' }, { contractEndDate: '2020-01-01' }, { workEmail: 'broken' }]) {
    expect((await request(hr.token, '/employees', 'POST', { ...input(2), ...patch })).status).toBe(400);
  }
  expect((await request(hr.token, '/employees/1oops')).status).toBe(400);
  expect((await request(hr.token, '/employees?page=0')).status).toBe(400);
});
test('write API rejects protected account and role fields and unauthorized edits', async () => {
  const hr = await account(); const person = await create(); const manager = await account('manager');
  for (const field of [{ userId: hr.id }, { roleId: 1 }, { recordVersion: 100 }, { photo: 'https://untrusted.test' }]) {
    expect((await request(hr.token, `/employees/${person.id}`, 'PATCH', { expectedVersion: 1, ...field })).status).toBe(400);
  }
  expect((await request(manager.token, '/employees', 'POST', input(2))).status).toBe(403);
  expect((await request(manager.token, `/employees/${person.id}`, 'PATCH', { expectedVersion: 1, firstName: 'Changed' })).status).toBe(403);
});
test('stale writes do not overwrite changes and all database update paths advance the version', async () => {
  const hr = await account(); const person = await create();
  const first = await request(hr.token, `/employees/${person.id}`, 'PATCH', { expectedVersion: 1, position: 'Supervisor' }); expect(first.status).toBe(200);
  expect((await request(hr.token, `/employees/${person.id}`, 'PATCH', { expectedVersion: 1, position: 'Stale' })).status).toBe(409);
  await context.db.update(employees).set({ costCenter: 'Imported' }).where(eq(employees.id, person.id));
  const current = await request(hr.token, `/employees/${person.id}`);
  expect(current.body.position).toBe('Supervisor'); expect(current.body.recordVersion).toBe(3);
  expect((await request(hr.token, `/employees/${person.id}`, 'PATCH', { expectedVersion: 2, position: 'Stale again' })).status).toBe(409);
});
test('reporting manager validation rejects missing, inactive, self and indirect cycles', async () => {
  const hr = await account(); const a = await create(); const b = await create(2, { reportingManagerId: a.id }); const c = await create(3, { secondaryManagerId: b.id });
  const inactive = await create(4, { status: 'inactive' });
  for (const manager of [a.id, b.id, c.id, inactive.id, 9999]) {
    expect((await request(hr.token, `/employees/${a.id}`, 'PATCH', { expectedVersion: 1, reportingManagerId: manager })).status).toBe(400);
  }
  const clear = await request(hr.token, `/employees/${b.id}`, 'PATCH', { expectedVersion: 1, reportingManagerId: null }); expect(clear.status).toBe(200);
});
test('an audit failure rolls back the employee write', async () => {
  const hr = await account();
  const existing = await create(2);
  await pg.exec("ALTER TABLE activity_logs ADD CONSTRAINT employee_audit_test CHECK (entity_type <> 'employee')");
  try {
    expect((await request(hr.token, '/employees', 'POST', input())).status).toBe(500);
    expect((await context.db.select().from(employees))).toHaveLength(1);
    expect((await request(hr.token, `/employees/${existing.id}`, 'PATCH', {expectedVersion: 1, firstName: 'Must roll back'})).status).toBe(500);
    const current = await request(hr.token, `/employees/${existing.id}`);
    expect(current.body.firstName).toBe(existing.firstName); expect(current.body.recordVersion).toBe(1);
  } finally { await pg.exec('ALTER TABLE activity_logs DROP CONSTRAINT employee_audit_test'); }
});

test('simultaneous edits accept only one version and preserve the losing editor conflict', async () => {
  const hr = await account(); const person = await create();
  const results = await Promise.all(['Editor A', 'Editor B'].map(position => request(hr.token, `/employees/${person.id}`, 'PATCH', {expectedVersion: 1, position})));
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect((await request(hr.token, `/employees/${person.id}/activity`)).body.total).toBe(1);
});

test('management calendar counts Sunday and excludes Friday/Saturday only for assigned office staff', async () => {
  const admin=await account();const office=await create(1,{workSchedule:'management_office'});const shift=await create(2,{workSchedule:'shift_based'});
  expect((await request(admin.token,`/employees/${office.id}`)).body.workSchedule).toBe('management_office');
  const leave={leaveType:'annual',startDate:'2026-09-13',endDate:'2026-09-13',reason:'Test leave',totalDays:999,workSchedule:'management_office'};
  const sunday=await request(admin.token,'/leaves','POST',{...leave,employeeId:office.id});
  expect(sunday.status).toBe(201);expect(sunday.body.totalDays).toBe(1);
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:office.id,startDate:'2026-09-18',endDate:'2026-09-19'})).status).toBe(400);
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:shift.id})).status).toBe(400);
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:shift.id,startDate:'2026-09-18',endDate:'2026-09-18'})).status).toBe(201);
});

test('office settings persist, require admin and survive a legacy settings update',async()=>{
  const admin=await account(),employee=await account('employee');
  const value={...defaultCompanySettings,managementOfficeSchedule:{...defaultCompanySettings.managementOfficeSchedule,startTime:'09:30'}};
  expect((await request(employee.token,'/settings/company','PUT',value)).status).toBe(403);
  expect((await request(admin.token,'/settings/company','PUT',value)).status).toBe(200);
  const {managementOfficeSchedule,...legacy}=defaultCompanySettings;
  expect((await request(admin.token,'/settings/company','PUT',legacy)).body.managementOfficeSchedule.startTime).toBe('09:30');
  expect((await request(employee.token,'/settings/company')).body.managementOfficeSchedule.workingDays).toEqual([0,1,2,3,4]);
  expect((await request(admin.token,'/settings/company','PUT',{...value,managementOfficeSchedule:{...value.managementOfficeSchedule,endTime:'08:00'}})).status).toBe(400);
});
