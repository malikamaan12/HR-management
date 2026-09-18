import correctionsRouter from '../server/routes/employeeCorrections';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import { employees, users, activityLogs, hrRules, employeeLifecycleEvents, documents, documentVersions, type InsertEmployee } from '../shared/schema';
const context = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return context.db; }, pool: {} }));
const files = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), download:vi.fn() }));
vi.mock('../server/services/r2', () => ({
  uploadDocument: files.upload, deleteDocumentObject: files.remove,
  validateDocumentFile: vi.fn(), documentDownloadUrl: files.download,
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
  const app = express(); app.use(express.json()); app.use('/employees', correctionsRouter); app.use('/employees', router); app.use('/settings',settingsRouter); app.use('/leaves',leaveRouter); app.use('/documents',documentRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
beforeEach(async () => {
  await pg.exec('TRUNCATE users, employees, activity_logs, app_settings RESTART IDENTITY CASCADE');
  files.upload.mockReset().mockResolvedValue('documents/1/test.pdf'); files.remove.mockReset().mockResolvedValue(undefined);
  files.download.mockReset().mockResolvedValue('https://files.example.test/signed');
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

async function replaceDocumentFor(token:string,id:number,overrides:Record<string,string>={},includeFile=true,endpoint='replace') {
  const body=new FormData();
  for(const [key,value] of Object.entries({documentNumber:'RENEWED-456',issueDate:'2027-01-01',expiryDate:'2028-01-01',reason:'Passport renewed by authority',expectedVersion:'1',...overrides}))body.append(key,value);
  if(includeFile)body.append('document',new Blob(['%PDF-new'],{type:'application/pdf'}),'renewed.pdf');
  const response=await fetch(base+`/documents/${id}/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body});
  return {status:response.status,body:await response.json() as any};
}
test('renewal requests leave the current document untouched until an independent approval',async()=>{
  const admin=await account(),self=await account('permanent_employee');const employee=await create(1,{userId:self.id});
  const original=await uploadDocumentFor(admin.token,employee.id);files.upload.mockResolvedValue('documents/1/proposed.pdf');
  const submitted=await replaceDocumentFor(self.token,original.body.id,{},true,'renewal-requests');expect(submitted.status).toBe(201);
  expect((await request(self.token,`/documents/${original.body.id}`)).body.documentNumber).toBe('TEST-123');
  const queue=await request(admin.token,'/documents/renewal-requests');expect(queue.body.items[0].canReview).toBe(true);
  const path=`/documents/renewal-requests/${submitted.body.id}/decision`;
  expect((await request(self.token,path,'POST',{decision:'approved',reason:'Self approval attempt'})).status).toBe(403);
  expect((await request(admin.token,path,'POST',{decision:'approved',reason:'Authority details checked'})).status).toBe(200);
  expect((await request(admin.token,path,'POST',{decision:'approved',reason:'Repeated approval attempt'})).status).toBe(409);
  const current=(await request(self.token,`/documents/${original.body.id}`)).body;expect(current).toMatchObject({documentNumber:'RENEWED-456',currentVersion:2,documentFile:'documents/1/proposed.pdf'});
  const history=(await request(self.token,`/documents/${original.body.id}/versions`)).body;expect(history[0].snapshot).toMatchObject({renewalRequestId:submitted.body.id,requestedBy:self.id,reviewReason:'Authority details checked'});
  expect(history[1].snapshot.documentFile).toBe('documents/1/test.pdf');expect(files.remove).not.toHaveBeenCalled();
});
test('renewal proposals are private, department scoped, and downloadable only by requester or reviewers',async()=>{
  const admin=await account(),self=await account('permanent_employee'),other=await account('permanent_employee','other'),hr=await account('hr_manager');
  const employee=await create(1,{userId:self.id,department:'Finance'});await create(2,{userId:other.id});
  const original=await uploadDocumentFor(admin.token,employee.id);const submitted=await replaceDocumentFor(self.token,original.body.id,{},true,'renewal-requests');
  for(const token of [other.token,hr.token]){
    expect((await request(token,'/documents/renewal-requests')).body.items).toEqual([]);
    expect((await request(token,`/documents/renewal-requests/${submitted.body.id}/download`)).status).toBe(404);
    expect((await request(token,`/documents/renewal-requests/${submitted.body.id}/decision`,'POST',{decision:'approved',reason:'Unauthorized review'})).status).toBe(404);
  }
  const response=await fetch(base+`/documents/renewal-requests/${submitted.body.id}/download`,{headers:{Authorization:`Bearer ${self.token}`},redirect:'manual'});expect(response.status).toBe(302);expect(response.headers.get('cache-control')).toBe('no-store');
});
test('duplicate pending requests clean their upload and withdrawal allows a new request',async()=>{
  const admin=await account(),self=await account('permanent_employee');const employee=await create(1,{userId:self.id});
  const original=await uploadDocumentFor(admin.token,employee.id);files.upload.mockResolvedValueOnce('proposal-one').mockResolvedValueOnce('proposal-two');
  const first=await replaceDocumentFor(self.token,original.body.id,{},true,'renewal-requests');
  expect((await replaceDocumentFor(self.token,original.body.id,{},true,'renewal-requests')).status).toBe(409);expect(files.remove).toHaveBeenCalledWith('proposal-two');
  expect((await request(admin.token,`/documents/renewal-requests/${first.body.id}/decision`,'POST',{decision:'withdrawn',reason:'Not the requester'})).status).toBe(403);
  expect((await request(self.token,`/documents/renewal-requests/${first.body.id}/decision`,'POST',{decision:'withdrawn',reason:'Correcting proposal fields'})).status).toBe(200);
  expect((await replaceDocumentFor(self.token,original.body.id,{},true,'renewal-requests')).status).toBe(201);
});
test('stale approval cannot overwrite direct replacement and rejection preserves current version',async()=>{
  const admin=await account(),reviewer=await account('super_admin','reviewer');const employee=await create();
  const original=await uploadDocumentFor(admin.token,employee.id);const proposed=await replaceDocumentFor(admin.token,original.body.id,{},true,'renewal-requests');
  const path=`/documents/renewal-requests/${proposed.body.id}/decision`;
  expect((await request(admin.token,path,'POST',{decision:'approved',reason:'Requester cannot approve'})).status).toBe(403);
  expect((await replaceDocumentFor(admin.token,original.body.id,{documentNumber:'DIRECT'})).status).toBe(200);
  expect((await request(reviewer.token,path,'POST',{decision:'approved',reason:'Version is now stale'})).status).toBe(409);
  expect((await request(reviewer.token,path,'POST',{decision:'rejected',reason:'Superseded by direct update'})).status).toBe(200);
  expect((await request(admin.token,`/documents/${original.body.id}`)).body.documentNumber).toBe('DIRECT');
});
test('failed approval snapshot rolls back the decision and keeps its proposal for retry',async()=>{
  const admin=await account(),reviewer=await account('super_admin','reviewer');const employee=await create();
  const original=await uploadDocumentFor(admin.token,employee.id);const proposed=await replaceDocumentFor(admin.token,original.body.id,{},true,'renewal-requests');
  await pg.exec("CREATE FUNCTION fail_renewal() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_renewal BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION fail_renewal();");
  try{
    expect((await request(reviewer.token,`/documents/renewal-requests/${proposed.body.id}/decision`,'POST',{decision:'approved',reason:'Reviewed replacement file'})).status).toBe(500);
    expect((await request(admin.token,`/documents/${original.body.id}`)).body.documentNumber).toBe('TEST-123');
    expect((await request(admin.token,'/documents/renewal-requests')).body.items[0].status).toBe('pending');expect(files.remove).not.toHaveBeenCalled();
  }finally{await pg.exec('DROP TRIGGER fail_renewal ON document_versions; DROP FUNCTION fail_renewal();');}
});
test('document replacement preserves files and scopes current and historical downloads',async()=>{
  const admin=await account(),self=await account('permanent_employee'),other=await account('permanent_employee','other');
  const employee=await create(1,{userId:self.id});await create(2,{userId:other.id});
  const uploaded=await uploadDocumentFor(admin.token,employee.id),id=uploaded.body.id;
  expect((await request(self.token,`/documents/${id}`)).body).toMatchObject({currentVersion:1,canReplace:true});
  files.upload.mockResolvedValue('documents/1/renewed.pdf');
  const renewed=await replaceDocumentFor(self.token,id);expect(renewed.status).toBe(200);
  expect(renewed.body).toMatchObject({id,employeeId:employee.id,documentType:'passport',documentNumber:'RENEWED-456',currentVersion:2});
  const history=(await request(self.token,`/documents/${id}/versions`)).body;
  expect(history.map((v:any)=>v.version)).toEqual([2,1]);
  expect(history[1].snapshot.documentFile).toBe('documents/1/test.pdf');
  expect(history[0].snapshot).toMatchObject({documentFile:'documents/1/renewed.pdf',changeReason:'Passport renewed by authority'});
  for(const [path,key] of [[`/documents/${id}/download`,'documents/1/renewed.pdf'],[`/documents/${id}/versions/1/download`,'documents/1/test.pdf']]){
    const response=await fetch(base+path,{headers:{Authorization:`Bearer ${self.token}`},redirect:'manual'});
    expect(response.status).toBe(302);expect(response.headers.get('cache-control')).toBe('no-store');expect(files.download).toHaveBeenLastCalledWith(key);
  }
  const calls=files.download.mock.calls.length;
  expect((await request(other.token,`/documents/${id}/versions/1/download`)).status).toBe(404);
  expect((await request(self.token,`/documents/${id}/versions/999/download`)).status).toBe(404);
  expect(files.download).toHaveBeenCalledTimes(calls);expect(files.remove).not.toHaveBeenCalled();
});
test('replacement rejects unauthorized callers, protected metadata, invalid dates and stale versions before uploading',async()=>{
  const admin=await account(),other=await account('permanent_employee'),reader=await account('finance');
  const employee=await create(),uploaded=await uploadDocumentFor(admin.token,employee.id),id=uploaded.body.id;
  expect((await request(reader.token,`/documents/${id}`)).body.canReplace).toBe(false);
  files.upload.mockClear();
  for(const token of [other.token,reader.token])expect((await replaceDocumentFor(token,id)).status).toBe(404);
  for(const fields of [{employeeId:'999'},{documentType:'visa'},{expiryDate:'2026-02-30'},{issueDate:'2029-01-01'},{reason:'x'}])expect((await replaceDocumentFor(admin.token,id,fields)).status).toBe(400);
  expect((await replaceDocumentFor(admin.token,id,{},false)).status).toBe(400);
  expect((await replaceDocumentFor(admin.token,id,{expectedVersion:'0'})).status).toBe(409);
  expect(files.upload).not.toHaveBeenCalled();
});
test('late replacement conflict cleans only its new object and preserves the winning version',async()=>{
  const admin=await account(),employee=await create(),uploaded=await uploadDocumentFor(admin.token,employee.id),id=uploaded.body.id;
  let release!:(key:string)=>void,started!:()=>void;
  const began=new Promise<void>(resolve=>{started=resolve;});
  files.upload.mockImplementationOnce(()=>{started();return new Promise<string>(resolve=>{release=resolve;});}).mockResolvedValueOnce('documents/1/winner.pdf');
  const first=replaceDocumentFor(admin.token,id);await began;
  const second=await replaceDocumentFor(admin.token,id);expect(second.status).toBe(200);
  release('documents/1/loser.pdf');expect((await first).status).toBe(409);
  expect(files.remove).toHaveBeenCalledExactlyOnceWith('documents/1/loser.pdf');
  expect((await request(admin.token,`/documents/${id}`)).body.documentFile).toBe('documents/1/winner.pdf');
  expect((await request(admin.token,`/documents/${id}/versions`)).body).toHaveLength(2);
});
test('failed replacement history rolls back metadata and cleans the replacement file',async()=>{
  const admin=await account(),employee=await create(),uploaded=await uploadDocumentFor(admin.token,employee.id),id=uploaded.body.id;
  files.upload.mockResolvedValue('documents/1/failed.pdf');
  await pg.exec("CREATE FUNCTION reject_replacement() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_replacement BEFORE INSERT ON document_versions FOR EACH ROW EXECUTE FUNCTION reject_replacement();");
  try{
    expect((await replaceDocumentFor(admin.token,id)).status).toBe(500);
    expect((await request(admin.token,`/documents/${id}`)).body).toMatchObject({documentNumber:'TEST-123',currentVersion:1,documentFile:'documents/1/test.pdf'});
    expect(files.remove).toHaveBeenCalledExactlyOnceWith('documents/1/failed.pdf');
  }finally{await pg.exec('DROP TRIGGER reject_replacement ON document_versions; DROP FUNCTION reject_replacement();');}
});
test('first replacement of a legacy document preserves the prior metadata as version one',async()=>{
  const admin=await account(),employee=await create();
  const [legacy]=await context.db.insert(documents).values({employeeId:employee.id,documentType:'passport',documentNumber:'LEGACY',issueDate:'2025-01-01',expiryDate:'2026-01-01',status:'expired',documentFile:'legacy.pdf'}).returning();
  expect((await request(admin.token,`/documents/${legacy.id}`)).body.currentVersion).toBe(0);
  expect((await replaceDocumentFor(admin.token,legacy.id,{expectedVersion:'0'})).status).toBe(200);
  const history=(await request(admin.token,`/documents/${legacy.id}/versions`)).body;
  expect(history.map((v:any)=>v.version)).toEqual([2,1]);expect(history[1].snapshot).toMatchObject({documentNumber:'LEGACY',documentFile:'legacy.pdf',changeReason:'Legacy document preserved before replacement'});
});
test('oversized renewal files return a useful error before private storage is called',async()=>{
  const admin=await account(),employee=await create(),uploaded=await uploadDocumentFor(admin.token,employee.id);
  files.upload.mockClear();const body=new FormData();body.append('document',new Blob([new Uint8Array(10*1024*1024+1)]),'large.pdf');
  const response=await fetch(base+`/documents/${uploaded.body.id}/replace`,{method:'POST',headers:{Authorization:`Bearer ${admin.token}`},body});
  expect(response.status).toBe(413);expect((await response.json()).message).toMatch(/10 MB/);expect(files.upload).not.toHaveBeenCalled();
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
  await context.db.insert(hrRules).values({kind:'leave',name:'annual',effectiveFrom:'2026-01-01',createdBy:admin.id,reason:'Confirmed test rule',config:{paid:true,balanceRequired:false,accrualMode:'none',annualDays:0,monthlyDays:0,carryoverLimit:0,minServiceDays:0,maxConsecutiveDays:30,approverId:null}});
  expect((await request(admin.token,`/employees/${office.id}`)).body.workSchedule).toBe('management_office');
  const leave={leaveType:'annual',startDate:'2026-09-13',endDate:'2026-09-13',reason:'Test leave',totalDays:999,workSchedule:'management_office'};
  const sunday=await request(admin.token,'/leaves','POST',{...leave,employeeId:office.id});
  expect(sunday.status).toBe(201);expect(sunday.body.totalDays).toBe(1);
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:office.id,startDate:'2026-09-18',endDate:'2026-09-19'})).status).toBe(400);
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:shift.id})).status).toBe(400);
  // Shift-based leave now requires an accepted roster, including on Fridays.
  expect((await request(admin.token,'/leaves','POST',{...leave,employeeId:shift.id,startDate:'2026-09-18',endDate:'2026-09-18'})).status).toBe(400);
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

test('employees request private contact corrections; only independent HR can apply them',async()=>{
 const staff=await account('employee'),hr=await account('super_admin'),other=await account('employee','other'),finance=await account('finance');const person=await create(1,{userId:staff.id});
 const path=`/employees/${person.id}/corrections`,data={expectedVersion:person.recordVersion,patch:{primaryMobile:'new-phone'},reason:'Updated contact number'};
 expect((await request(other.token,path,'POST',data)).status).toBe(404);
 expect((await request(staff.token,path,'POST',{...data,patch:{status:'inactive'}})).status).toBe(400);
 const made=await request(staff.token,path,'POST',data);expect(made.status).toBe(201);
 expect((await request(finance.token,path)).status).toBe(404);
 expect((await request(staff.token,path,'POST',data)).status).toBe(409);
 const decision=`${path}/${made.body.id}/decision`;
 expect((await request(staff.token,decision,'POST',{action:'approve',reason:'My own approval'})).status).toBe(403);
 expect((await request(hr.token,decision,'POST',{action:'approve',reason:'Verified with employee'})).status).toBe(200);
 const updated=await request(staff.token,`/employees/${person.id}`);expect(updated.body.primaryMobile).toBe('new-phone');expect(updated.body.recordVersion).toBeGreaterThan(person.recordVersion);
 expect((await request(hr.token,decision,'POST',{action:'approve',reason:'Duplicate approval'})).status).toBe(409);
 expect((await request(staff.token,path)).body.items[0]).toMatchObject({status:'approved',previous_values:{primaryMobile:'private-phone'},patch:{primaryMobile:'new-phone'}});
});
test('stale correction cannot overwrite a newer record and can be withdrawn',async()=>{
 const staff=await account('employee'),hr=await account();const person=await create(1,{userId:staff.id});const path=`/employees/${person.id}/corrections`;
 const made=await request(staff.token,path,'POST',{expectedVersion:person.recordVersion,patch:{primaryMobile:'requested-phone'},reason:'Changed phone number'});
 await context.db.update(employees).set({primaryMobile:'verified-newer-phone'}).where(eq(employees.id,person.id));
 const decision=`${path}/${made.body.id}/decision`;
 expect((await request(hr.token,decision,'POST',{action:'approve',reason:'Attempt older approval'})).status).toBe(409);
 expect((await request(staff.token,`/employees/${person.id}`)).body.primaryMobile).toBe('verified-newer-phone');
 expect((await request(staff.token,decision,'POST',{action:'withdraw',reason:'Newer record is correct'})).status).toBe(200);
});
test('correction approval and employee change roll back when auditing fails',async()=>{
 const staff=await account('employee'),hr=await account();const person=await create(1,{userId:staff.id});const path=`/employees/${person.id}/corrections`;
 const made=await request(staff.token,path,'POST',{expectedVersion:person.recordVersion,patch:{primaryMobile:'requested-phone'},reason:'Changed phone number'});
 await pg.exec("CREATE FUNCTION fail_correction_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_correction_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_correction_audit();");
 try{expect((await request(hr.token,`${path}/${made.body.id}/decision`,'POST',{action:'approve',reason:'Verified request'})).status).toBe(500);expect((await request(staff.token,`/employees/${person.id}`)).body.primaryMobile).toBe('private-phone');expect((await request(staff.token,path)).body.items[0].status).toBe('pending');}finally{await pg.exec('DROP TRIGGER fail_correction_audit ON activity_logs; DROP FUNCTION fail_correction_audit();');}
});
