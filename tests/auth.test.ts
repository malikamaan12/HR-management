import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseStorage } from '../server/storage';
import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { users, authSessions } from '../shared/schema';
import { parseAuthResponse } from '../client/src/contexts/auth-session';

const testContext = vi.hoisted(() => ({ db: null as any, emails: [] as { email: string; token: string }[] }));
vi.mock('../server/db', () => ({ get db() { return testContext.db; }, pool: {} }));
vi.mock('../server/services/email', () => ({
  emailConfigured: () => true,
  sendPasswordResetEmail: async (email: string, token: string) => { testContext.emails.push({ email, token }); },
}));
import { authService, validateAuthConfiguration } from '../server/services/auth';
import { authenticate } from '../server/middleware/auth';
import { clockAttendance } from '../server/services/attendance';
import { employeeScope } from '../server/services/access';
import { employees } from '../shared/schema';
import express from 'express';
import payrollRouter from '../server/routes/payroll';
import leaveRouter from '../server/routes/leaveRequests';
import settingsRouter from '../server/routes/settings';
import usersRouter from '../server/routes/users';
import employeeRouter from '../server/routes/employee';
import { defaultCompanySettings } from '../shared/settings';

let pg: PGlite;
const password = 'CorrectHorse7!';
beforeAll(async () => {
  process.env.JWT_SECRET = 'test-access-secret-at-least-32-characters';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters';
  pg = new PGlite();
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  testContext.db = drizzle(pg);
});
beforeEach(async () => { await pg.exec('TRUNCATE auth_sessions, security_logs, employees, users RESTART IDENTITY CASCADE'); testContext.emails.length = 0; });
afterAll(async () => { await pg.close(); });
async function account(name = 'alice', active = true, role = 'employee') {
  const [user] = await testContext.db.insert(users).values({ username: name, password: await bcrypt.hash(password, 4), email: name + '@example.com',
    firstName: name, lastName: 'Test', role, department: 'Operations', isActive: active, approvalStatus: active ? 'approved' : 'pending' }).returning();
  return user;
}
test('requires distinct configured signing secrets', () => {
  const previous = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  expect(() => validateAuthConfiguration()).toThrow();
  process.env.JWT_SECRET = process.env.JWT_REFRESH_SECRET;
  expect(() => validateAuthConfiguration()).toThrow();
  process.env.JWT_SECRET = previous;
});
test('rejects unapproved and inactive accounts', async () => {
  const user = await account('alice', false);
  await expect(authService.login('alice', password)).rejects.toThrow(/approval|inactive/);
  await testContext.db.update(users).set({ approvalStatus: 'approved' }).where(eq(users.id, user.id));
  await expect(authService.login('alice', password)).rejects.toThrow(/inactive/);
});
test('refresh works after login, rotates tokens and rejects reuse', async () => {
  await account();
  const login = await authService.login('alice', password);
  expect(login.user).not.toHaveProperty('password');
  expect(login.user).not.toHaveProperty('passwordResetToken');
  const renewed = await authService.refreshToken(login.refreshToken);
  expect(renewed.refreshToken).not.toBe(login.refreshToken);
  expect(parseAuthResponse(renewed).user.userId).toBe(login.user.id);
  await expect(authService.refreshToken(login.refreshToken)).rejects.toThrow();
  await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();
  expect((await authService.authenticateToken(renewed.accessToken)).department).toBe('Operations');
  const audit = await pg.query("SELECT event_type FROM security_logs WHERE event_type = 'login_success'");
  expect(audit.rows).toHaveLength(1);
});
test('only one concurrent refresh can consume a token', async () => {
  await account(); const login = await authService.login('alice', password);
  const results = await Promise.allSettled([authService.refreshToken(login.refreshToken), authService.refreshToken(login.refreshToken)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
});
test('logout immediately invalidates access and refresh tokens', async () => {
  await account(); const login = await authService.login('alice', password);
  await authService.logoutSession(login.refreshToken);
  await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();
  await expect(authService.refreshToken(login.refreshToken)).rejects.toThrow();
});
test('deactivation invalidates a previously valid session', async () => {
  const user = await account(); const login = await authService.login('alice', password);
  await testContext.db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
  await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();
  await expect(authService.refreshToken(login.refreshToken)).rejects.toThrow();
});
test('reset does not expose a token and selects the correct account among pending resets', async () => {
  await account(); await account('bob');
  const session = await authService.login('bob', password);
  const absent = await authService.requestPasswordReset('missing@example.com');
  const present = await authService.requestPasswordReset('alice@example.com');
  expect(present).toEqual(absent);
  expect(present).not.toHaveProperty('resetToken');
  await authService.requestPasswordReset('bob@example.com');
  const reset = testContext.emails.find(x => x.email === 'bob@example.com')!;
  await authService.resetPassword(reset.token, 'ChangedPassword8!');
  await expect(authService.login('bob', password)).rejects.toThrow();
  await expect(authService.login('bob', 'ChangedPassword8!')).resolves.toHaveProperty('accessToken');
  await expect(authService.login('alice', password)).resolves.toHaveProperty('accessToken');
  await expect(authService.authenticateToken(session.accessToken)).rejects.toThrow();
  await expect(authService.resetPassword(reset.token, 'AnotherPassword9!')).rejects.toThrow();
});
test('reset rejects expired and invalid tokens', async () => {
  const user = await account(); await authService.requestPasswordReset(user.email);
  await testContext.db.update(users).set({ passwordResetExpires: new Date(0) }).where(eq(users.id, user.id));
  await expect(authService.resetPassword(testContext.emails[0].token, password)).rejects.toThrow();
  await expect(authService.resetPassword('not-a-token', password)).rejects.toThrow();
});
test('registration ignores requested privileged roles and hashes the password', async () => {
  const user = await authService.registerUser({ username: 'eve', email: 'eve@example.com', firstName: 'Eve', lastName: 'Test', password, role: 'super_admin', isActive: true });
  expect(user.role).toBe('permanent_employee'); expect(user.isActive).toBe(false);
  const stored = await authService.findUserByUsername('eve');
  expect(stored!.password).not.toBe(password); expect(await bcrypt.compare(password, stored!.password)).toBe(true);
});
test('session listing does not expose tokens and users cannot revoke other sessions', async () => {
  const alice = await account(); await account('bob');
  await authService.login('bob', password);
  const sessions = await authService.getUserSessions(2);
  expect(sessions[0]).not.toHaveProperty('accessToken'); expect(sessions[0]).not.toHaveProperty('refreshToken');
  await expect(authService.revokeSession(sessions[0].id, alice.id)).rejects.toThrow();
});
test('unauthenticated requests remain unauthorized in development', async () => {
  const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'development';
  const response: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn(); await authenticate({ headers: {}, cookies: {} } as any, response, next);
  expect(response.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  process.env.NODE_ENV = previous;
});
test('password changes invalidate sessions', async () => {
  const user = await account(); const login = await authService.login('alice', password);
  await authService.changePassword(user.id, password, 'ReplacementPass9!');
  await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();
  await expect(authService.refreshToken(login.refreshToken)).rejects.toThrow();
});
test('lockout stops further login after repeated failed attempts', async () => {
  await account();
  for (let i = 0; i < 5; i++) await expect(authService.login('alice', 'wrong')).rejects.toThrow();
  await expect(authService.login('alice', password)).rejects.toThrow(/locked/);
});

test('employee fields persist and employee IDs are not treated as account IDs', async () => {
  const alice = await account(); const bob = await account('bob');
  const store = new DatabaseStorage();
  const employee = await store.createEmployee({ employeeId: 'EMP-001', firstName: 'Alice', lastName: 'Actual', userId: bob.id,
    gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Qatar', qidNumber: '12345678901', primaryMobile: '12345678',
    residentialAddress: 'Doha', emergencyContactName: 'Contact', emergencyContactNumber: '87654321', type: 'permanent',
    department: 'Operations', position: 'Coordinator', location: 'Doha', joiningDate: '2026-01-01' });
  expect(employee.id).toBe(alice.id);
  expect(await store.getEmployeeByUserId(alice.id)).toBeUndefined();
  expect((await store.getEmployeeByUserId(bob.id))?.firstName).toBe('Alice');
  await store.updateEmployee(employee.id, { firstName: 'Updated', primaryMobile: '23456789' });
  const reloaded = await new DatabaseStorage().getEmployee(employee.id);
  expect(reloaded?.firstName).toBe('Updated'); expect(reloaded?.primaryMobile).toBe('23456789');
  const persisted = await pg.query('SELECT first_name FROM employees WHERE id = $1', [employee.id]);
  expect(persisted.rows[0]).toMatchObject({ first_name: 'Updated' });
  expect(await store.getEmployeesByType('temporary')).toHaveLength(0);
  expect(await store.getEmployeesByType('permanent')).toHaveLength(1);
  const event=await store.createEvent({name:'Annual Conference',location:'Doha',startDate:'2026-10-01',endDate:'2026-10-02',createdBy:alice.id});
  expect((await store.getEvents())[0].startDate).toBe('2026-10-01');
  const profile=await store.createEventStaffProfile({employeeId:employee.id,availability:{days:['Monday']}});
  expect(profile.id).toBeGreaterThan(0);
  await store.updateEventStaffProfile(profile.id,{notes:'Available evenings'});
  expect((await store.getEventStaffProfileByEmployeeId(employee.id))?.notes).toBe('Available evenings');
  const roster=await store.createEventRoster({eventId:event.id,rosterName:'Front desk'});
  await store.updateEventRoster(roster.id,{status:'published'});
  expect((await store.getEventRosters(event.id))[0].status).toBe('published');
  const assignment=await store.createEventStaffAssignment({eventId:event.id,employeeId:employee.id,role:'Host',startTime:new Date('2026-10-01T08:00:00Z'),endTime:new Date('2026-10-01T16:00:00Z'),status:'assigned'});
  await store.updateEventStaffAssignment(assignment.id,{role:'Lead host'});
  expect((await store.getEventRosterAssignments(event.id,'Lead host'))[0].employeeId).toBe(employee.id);
  const performance=await store.createEventStaffPerformance({assignmentId:assignment.id,ratedBy:employee.id,rating:'good',punctualityRating:4,attitudeRating:5,skillRating:4});
  expect((await store.getEventStaffPerformances(event.id,employee.id))[0].id).toBe(performance.id);
  const message=await store.createEventCommunication({eventId:event.id,senderId:alice.id,messageType:'announcement',subject:'Briefing',content:'Meet at reception.'});
  await store.createEventCommunicationRecipient({communicationId:message.id,recipientId:employee.id});
  expect((await store.getEventCommunications(event.id))[0].content).toBe('Meet at reception.');
  expect((await store.getEventCommunicationRecipients(message.id))[0].recipientId).toBe(employee.id);
  // Bob's account ID differs from this employee ID. Scope must use the explicit link.
  const actor={userId:bob.id,username:'bob',role:'permanent_employee' as const,department:'Operations'};
  expect(await testContext.db.select().from(employees).where(employeeScope(actor,'employee_database'))).toHaveLength(1);
  expect(await testContext.db.select().from(employees).where(employeeScope({...actor,userId:alice.id},'employee_database'))).toHaveLength(0);
  const time=(hour:number,minute=0)=>new Date(Date.UTC(2026,8,12,hour,minute));
  await clockAttendance(bob.id,'in',undefined,undefined,time(8));
  await expect(clockAttendance(bob.id,'in',undefined,undefined,time(8,1))).rejects.toThrow(/Already/);
  await clockAttendance(bob.id,'break_start',undefined,undefined,time(10));
  await clockAttendance(bob.id,'break_end',undefined,undefined,time(10,15));
  await clockAttendance(bob.id,'break_start',undefined,undefined,time(12));
  await clockAttendance(bob.id,'break_end',undefined,undefined,time(12,30));
  const done=await clockAttendance(bob.id,'out',undefined,undefined,time(16));
  expect(done.totalBreakMinutes).toBe(45);expect(done.totalWorkHours).toBe(435);
  await expect(clockAttendance(bob.id,'out',undefined,undefined,time(17))).rejects.toThrow(/Already/);
});

test('HTTP workflows enforce ownership, payroll calculations, leave decisions and account permissions', async()=>{
  const admin=await account('admin',true,'super_admin');
  const alice=await account('alice',true,'permanent_employee');
  const bob=await account('bob',true,'permanent_employee');
  const store=new DatabaseStorage();
  const makeEmployee=(id:number,name:string,qid:string)=>store.createEmployee({userId:id,employeeId:name,firstName:name,lastName:'Test',gender:'female',dateOfBirth:'1990-01-01',nationality:'Qatar',qidNumber:qid,primaryMobile:'12345678',residentialAddress:'Doha',emergencyContactName:'Contact',emergencyContactNumber:'87654321',type:'permanent',department:'Operations',position:'Coordinator',location:'Doha',joiningDate:'2026-01-01'});
  const employee=await makeEmployee(alice.id,'Alice','12345678901');
  const adminEmployee=await makeEmployee(admin.id,'Admin','12345678902');
  const tokens=Object.fromEntries(await Promise.all(['admin','alice','bob'].map(async name=>[name,(await authService.login(name,password)).accessToken])));
  const app=express();app.use(express.json());app.use('/payroll',payrollRouter);app.use('/leaves',leaveRouter);app.use('/settings',settingsRouter);app.use('/users',usersRouter);app.use('/employee',employeeRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const port=(server.address() as {port:number}).port;
  const call=async(actor:string,path:string,method='GET',body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:`Bearer ${tokens[actor]}`, 'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  try{
    const input={employeeId:employee.id,month:9,year:2026,basicSalary:'1000.10',allowances:{housing:'250.25'},deductions:{absence:'10.05'}};
    expect((await call('alice','/payroll','POST',input)).status).toBe(400);
    const created=await call('admin','/payroll','POST',input);expect(created.status).toBe(201);expect(created.data.netSalary).toBe('1240.30');
    expect((await call('admin','/payroll','POST',input)).status).toBe(400);
    expect((await call('bob','/payroll/month/9/year/2026')).data).toEqual([]);
    expect((await call('alice','/payroll/month/9/year/2026')).data).toHaveLength(1);
    expect((await call('admin',`/payroll/${created.data.id}/mark-paid`,'POST',{reference:'BANK-TEST'})).status).toBe(200);
    expect((await call('admin',`/payroll/${created.data.id}`,'PATCH',input)).status).toBe(400);
    const request={employeeId:employee.id,leaveType:'annual',startDate:'2026-09-14',endDate:'2026-09-15',reason:'Test',totalDays:999,status:'approved',approvedBy:alice.id};
    const leave=await call('alice','/leaves','POST',request);expect(leave.status).toBe(201);expect(leave.data.status).toBe('pending');expect(leave.data.totalDays).toBe(2);expect(leave.data.approvedBy).toBeNull();
    expect((await call('bob',`/leaves/${leave.data.id}`)).status).toBe(404);
    expect((await call('alice',`/leaves/${leave.data.id}/status`,'PATCH',{status:'approved'})).status).toBe(403);
    expect((await call('admin',`/leaves/${leave.data.id}/status`,'PATCH',{status:'approved'})).status).toBe(200);
    expect((await call('admin',`/leaves/${leave.data.id}/status`,'PATCH',{status:'rejected'})).status).toBe(400);
    const own=await call('admin','/leaves','POST',{...request,employeeId:adminEmployee.id});expect(own.status).toBe(201);
    expect((await call('admin',`/leaves/${own.data.id}/status`,'PATCH',{status:'approved'})).status).toBe(400);
    expect((await call('alice','/settings/company','PUT',{...defaultCompanySettings,companyName:'Changed'})).status).toBe(403);
    expect((await call('admin','/settings/company','PUT',{...defaultCompanySettings,companyName:'Test company'})).status).toBe(200);
    expect((await call('alice','/settings/company')).data.companyName).toBe('Test company');
    expect((await call('alice','/users')).status).toBe(403);
    const listed=await call('admin','/users');expect(listed.status).toBe(200);for(const user of listed.data){expect(user).not.toHaveProperty('password');expect(user).not.toHaveProperty('passwordResetToken');}
    expect((await call('admin',`/users/${bob.id}/link-employee`,'POST',{employeeId:employee.id})).status).toBe(400);
    const dashboard=await call('alice','/employee/dashboard');expect(dashboard.status).toBe(200);expect(dashboard.data.leaves.available).toBeNull();expect(dashboard.data.payroll.netSalary).toBe('1240.30');
    expect((await call('bob','/employee/dashboard')).status).toBe(404);
    expect((await call('admin',`/users/${alice.id}`,'PATCH',{isActive:false})).status).toBe(200);
    expect((await call('alice','/settings/company')).status).toBe(401);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
