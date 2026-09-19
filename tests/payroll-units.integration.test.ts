import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, afterEach, test, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { emptyCompensation } from '../shared/compensation';
import { defaultArrivalRules } from '../shared/workforce-operations';
import { unpaidLeaveDeductionLabel } from '../shared/hr-rules';

const ctx = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: {} }));
import ruleRouter from '../server/routes/hr-rules';
import payrollRouter from '../server/routes/payroll';
import compensationRouter from '../server/routes/compensation';
import { authService } from '../server/services/auth';

let pg: PGlite, server: Server, base: string;
const password = 'PayrollScenario8!';
async function request(token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function account(name: string, role: s.UserRole) {
  const [user] = await ctx.db.insert(s.users).values({ username: name, email: name + '@example.test', password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Synthetic', role, department: 'Operations', isActive: true, approvalStatus: 'approved' }).returning();
  return { ...user, token: (await authService.login(name, password)).accessToken };
}
async function fixture() {
  const admin = await account('preparer', 'super_admin'), reviewer = await account('reviewer', 'super_admin'), employeeUser = await account('employee', 'permanent_employee');
  const [employee] = await ctx.db.insert(s.employees).values({ employeeId: 'PAYROLL-1', firstName: 'Synthetic', lastName: 'Employee', gender: 'female', dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: 'PAYROLL-TEST-QID', primaryMobile: '00000000', residentialAddress: 'Test only', emergencyContactName: 'Test', emergencyContactNumber: '00000000', department: 'Operations', position: 'Host', location: 'Test', type: 'permanent', joiningDate: '2025-01-01', workSchedule: 'management_office', userId: employeeUser.id }).returning();
  return { admin, reviewer, employeeUser, employee };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const pay = { currency: 'QAR', cycleStartDay: 1, payDay: 5, basis: 'salary', basicSalary: '3100.00', hourlyRate: '12.00', regularMinutesPerDay: 480, overtimeMultiplier: 1.5, allowances: {}, deductions: {} };
async function policy(f: Fixture, patch: Record<string, unknown> = {}, effectiveFrom = '2026-01-01') {
  const result = await request(f.admin.token, '/rules', { kind: 'payroll', name: 'Pay policy', employeeId: f.employee.id, effectiveFrom, reason: 'Synthetic payroll scenario policy', config: { ...pay, approverId: f.reviewer.id, ...patch } });
  expect(result.status, result.body.message).toBe(201);
  return result.body;
}
async function approvedShift(f: Fixture, start: string, minutes: number, approvalStatus: 'approved' | 'pending' = 'approved') {
  const [site] = await ctx.db.insert(s.workforceSites).values({ name: 'Synthetic venue', timezone: 'Asia/Qatar' }).returning();
  const [team] = await ctx.db.insert(s.workforceTeams).values({ name: 'Synthetic team', kind: 'event', siteId: site.id }).returning();
  const startAt = new Date(start), endAt = new Date(+startAt + minutes * 60000);
  const [shift] = await ctx.db.insert(s.workforceShifts).values({ teamId: team.id, role: 'Host', headcount: 1, startAt, endAt, createdBy: f.admin.id }).returning();
  const [assignment] = await ctx.db.insert(s.workforceAssignments).values({ shiftId: shift.id, employeeId: f.employee.id, status: 'accepted', createdBy: f.admin.id }).returning();
  const [presence] = await ctx.db.insert(s.workforcePresence).values({ assignmentId: assignment.id, employeeId: f.employee.id, arrivedAt: startAt, departedAt: endAt, arrivedBy: f.employeeUser.id, departedBy: f.employeeUser.id, approvalStatus, reviewedBy: approvalStatus === 'approved' ? f.reviewer.id : null, reviewedAt: approvalStatus === 'approved' ? new Date() : null, reviewNote: approvalStatus === 'approved' ? 'Synthetic independent attendance review' : null, policySnapshot: { id: null, rules: defaultArrivalRules } }).returning();
  const [sheet] = await ctx.db.insert(s.workforceTimesheets).values({ assignmentId: assignment.id, status: 'approved', actualStartAt: startAt, actualEndAt: endAt, breakMinutes: 0, workedMinutes: minutes, employeeNote: 'Synthetic approved shift', reviewerId: f.reviewer.id, reviewedAt: new Date(), payableMinutes: minutes, policyReference: 'Synthetic reviewed time' }).returning();
  return { sheet, presence };
}
async function leave(f: Fixture, day: string, options: { half?: boolean; paid?: boolean; status?: 'pending' | 'approved' } = {}) {
  const portion = options.half ? 'first_half' : 'full';
  const [row] = await ctx.db.insert(s.leaves).values({ employeeId: f.employee.id, leaveType: options.paid ? 'Paid' : 'Unpaid', startDate: day, endDate: day, totalDays: options.half ? 0.5 : 1, reason: 'Synthetic leave scenario', status: options.status || 'approved', approvedBy: f.reviewer.id, approvedAt: new Date() }).returning();
  await ctx.db.insert(s.leaveSnapshots).values({ leaveId: row.id, rules: [{ day, counted: true, dayPortion: portion, leaveRuleId: 1, leavePolicy: { paid: options.paid || false }, calendar: { hasSchedule: true, timezone: 'Asia/Qatar', workingDays: [0, 1, 2, 3, 4], startTime: '09:00', endTime: '17:00', breakMinutes: 0, graceMinutes: 0, holidays: [] } }], daysByYear: { '2026': options.half ? 0.5 : 1 }, balanceRequired: false, approverId: f.reviewer.id, approvalChain: [f.reviewer.id], dayPortion: portion });
  return row;
}
async function draft(f: Fixture) { return request(f.admin.token, '/payroll', { employeeId: f.employee.id, year: 2026, month: 9 }); }
async function action(f: Fixture, id: number, version: number, name: string) {
  return request((name === 'approve' || name === 'return' ? f.reviewer : f.admin).token, `/payroll/${id}/action`, { version, action: name, reason: 'Synthetic payroll review step' });
}
beforeAll(async () => {
  process.env.JWT_SECRET = 'payroll-units-access-secret-long-enough';
  process.env.JWT_REFRESH_SECRET = 'payroll-units-refresh-secret-long-enough';
  process.env.APP_TIMEZONE = 'Asia/Qatar';
  pg = new PGlite();
  for (const file of readdirSync(new URL('../migrations', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
  ctx.db = drizzle(pg);
  const app = express(); app.use(express.json()); app.use('/rules', ruleRouter); app.use('/payroll', payrollRouter); app.use('/compensation', compensationRouter);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
  await pg.exec("TRUNCATE users,employees,workforce_sites,app_settings RESTART IDENTITY CASCADE; INSERT INTO attendance_geofence_policy(id,config,enforced_from) VALUES (1,'{\"required\":false,\"maxAccuracyMeters\":100,\"maxAgeSeconds\":90,\"requirePermanentApproval\":false}', '2026-01-01') ON CONFLICT(id) DO UPDATE SET enforced_from='2026-01-01'");
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (pg) await pg.close(); });

test('first-day payday saves the previous completed 28th to 27th cycle',async()=>{
 const f=await fixture();await policy(f,{cycleStartDay:28,payDay:1});
 const result=await draft(f);expect(result.status,result.body.message).toBe(201);
 const [review]=await ctx.db.select().from(s.payrollReviews).where(eq(s.payrollReviews.payrollId,result.body.id));
 expect(review).toMatchObject({periodStart:'2026-07-28',periodEnd:'2026-08-27',payDate:'2026-09-01'});
});

test('daily pay counts one work date and preserves the independent attendance gate', async () => {
  const f = await fixture(); await policy(f, { basis: 'daily', dailyRate: '150.00', dailyPayMethod: 'full_day', overtimeEnabled: false });
  await approvedShift(f, '2026-08-10T06:00:00Z', 240); await approvedShift(f, '2026-08-10T11:00:00Z', 240);
  const pending = await approvedShift(f, '2026-08-11T06:00:00Z', 240, 'pending');
  expect((await draft(f)).status).toBe(409);
  expect(await ctx.db.select().from(s.payroll)).toHaveLength(0);
  await ctx.db.update(s.workforcePresence).set({ approvalStatus: 'approved', reviewedBy: f.reviewer.id, reviewedAt: new Date(), reviewNote: 'Synthetic independent attendance review' }).where(eq(s.workforcePresence.id, pending.presence.id));
  const result = await draft(f); expect(result.status, result.body.message).toBe(201); expect(result.body.netSalary).toBe('300.00');
  const detail = await request(f.admin.token, '/payroll/' + result.body.id);
  expect(detail.body.lines.map((line: any) => line.amount)).toEqual(['150.00', '0.00', '150.00']);
  expect(detail.body.lines[0].snapshot.calculation.unit).toBe('day');
});

test('per-event pay pays each assigned shift and locks approved time only after independent payment recording', async () => {
  const f = await fixture(); await policy(f, { basis: 'per_event', eventRate: '125.00', overtimeEnabled: false });
  await approvedShift(f, '2026-08-10T06:00:00Z', 240); await approvedShift(f, '2026-08-10T11:00:00Z', 240);
  const result = await draft(f); expect(result.status, result.body.message).toBe(201); expect(result.body.netSalary).toBe('250.00');
  expect((await action(f, result.body.id, 1, 'submit')).status).toBe(200);
  expect((await request(f.admin.token, `/payroll/${result.body.id}/action`, { version: 2, action: 'approve', reason: 'Attempt self approval' })).status).toBe(403);
  expect((await action(f, result.body.id, 2, 'approve')).status).toBe(200);
  const paid = await request(f.reviewer.token, `/payroll/${result.body.id}/mark-paid`, { version: 3, reference: 'SYNTHETIC-EVENT-1', confirmed: true });
  expect(paid.status, paid.body.message).toBe(200); expect(paid.body.netSalary).toBe('250.00');
  expect((await ctx.db.select().from(s.workforceTimesheets)).every((sheet: any) => sheet.status === 'payroll_locked')).toBe(true);
  expect((await draft(f)).status).toBe(409);
});

test.each(['daily', 'per_event'] as const)('onboarding %s package maps to a dated pay rule and keeps existing deductions', async frequency => {
  const f = await fixture(); const previous = await policy(f, { deductions: { Loan: '10.00' }, unpaidLeave: { enabled: true, divisor: 'fixed', fixedDays: 30, deductionBase: 'basic' } });
  const definition = emptyCompensation(); definition.items[0] = { ...definition.items[0], frequency, amount: '175.00' };
  const created = await request(f.admin.token, `/compensation/employees/${f.employee.id}`, { expectedVersion: 0, effectiveFrom: '2026-08-01', definition, reason: 'Synthetic package mapping' });
  expect(created.status, created.body.message).toBe(201);
  const url = `/compensation/employees/${f.employee.id}/packages/${created.body.id}/payroll-rule`;
  const body = { expectedVersion: 1, expectedRuleId: previous.id, reason: 'Reviewed synthetic payroll mapping', confirmed: true, cycleStartDay: 1, payDay: 5, regularMinutesPerDay: 480, overtimeMultiplier: 1.5, approverId: f.reviewer.id, hourlyRate: '12.00', dailyPayMethod: 'prorated', overtimeEnabled: false };
  expect((await request(f.employeeUser.token, url, body)).status).toBe(403);
  const mapped = await request(f.admin.token, url, body); expect(mapped.status, mapped.body.message).toBe(201);
  expect(mapped.body.config).toMatchObject({ basis: frequency, [frequency === 'daily' ? 'dailyRate' : 'eventRate']: '175.00', deductions: { Loan: '10.00' }, unpaidLeave: { enabled: true }, overtimeEnabled: false });
  expect((await request(f.admin.token, url, body)).status).toBe(409);
});

test('salary deducts only approved unpaid saved days and halves, preserving the amount after later policy edits', async () => {
  const f = await fixture(); await policy(f, { allowances: { Housing: '310.00' }, unpaidLeave: { enabled: true, deductionBase: 'basic_and_allowances', divisor: 'fixed', fixedDays: 31 } });
  await leave(f, '2026-08-10'); await leave(f, '2026-08-11', { half: true }); await leave(f, '2026-08-12', { paid: true }); await leave(f, '2026-08-13', { status: 'pending' });
  const result = await draft(f); expect(result.status, result.body.message).toBe(201);
  expect(result.body.deductions[unpaidLeaveDeductionLabel]).toBe('165.00'); expect(result.body.netSalary).toBe('3245.00');
  await policy(f, { basicSalary: '6200.00', unpaidLeave: { enabled: false } });
  expect((await action(f, result.body.id, 1, 'submit')).status).toBe(200);
  expect((await action(f, result.body.id, 2, 'approve')).status).toBe(200);
  const detail = await request(f.admin.token, '/payroll/' + result.body.id); expect(detail.body.record.netSalary).toBe('3245.00');
});

test('leave approved after generation blocks submission and regeneration refreshes the saved deduction', async () => {
  const f = await fixture(); await policy(f, { unpaidLeave: { enabled: true, deductionBase: 'basic', divisor: 'fixed', fixedDays: 31 } });
  const source = await leave(f, '2026-08-10', { status: 'pending' });
  const generated = await draft(f); expect(generated.status, generated.body.message).toBe(201); expect(generated.body.netSalary).toBe('3100.00');
  await ctx.db.update(s.leaves).set({ status: 'approved', reviewVersion: 2 }).where(eq(s.leaves.id, source.id));
  expect((await action(f, generated.body.id, 1, 'submit')).status).toBe(409);
  expect((await action(f, generated.body.id, 1, 'cancel')).status).toBe(200);
  const regenerated = await request(f.admin.token, `/payroll/${generated.body.id}/regenerate`, { version: 2, reason: 'Reconcile newly approved unpaid leave' });
  expect(regenerated.status, regenerated.body.message).toBe(201); expect(regenerated.body.netSalary).toBe('3000.00');
  expect(regenerated.body.review.history[0].snapshot.amounts.netSalary).toBe('3100.00');
});

test('cancelled leave after payroll approval blocks payment without rewriting approved amounts', async () => {
  const f = await fixture(); await policy(f, { unpaidLeave: { enabled: true, deductionBase: 'basic', divisor: 'calendar_days' } });
  const source = await leave(f, '2026-08-10'); const result = await draft(f); expect(result.status, result.body.message).toBe(201);
  await action(f, result.body.id, 1, 'submit'); await action(f, result.body.id, 2, 'approve');
  await ctx.db.update(s.leaves).set({ status: 'cancelled', reviewVersion: 2 }).where(eq(s.leaves.id, source.id));
  const paid = await request(f.reviewer.token, `/payroll/${result.body.id}/mark-paid`, { version: 3, reference: 'SHOULD-NOT-PAY', confirmed: true });
  expect(paid.status).toBe(409);
  const [record] = await ctx.db.select().from(s.payroll).where(eq(s.payroll.id, result.body.id)); expect(record.status).toBe('approved'); expect(record.netSalary).toBe('3000.00');
});

test('automatic unpaid deduction stays disabled for older salary rules and does not double-deduct hourly work', async () => {
  const f = await fixture(); await policy(f); await leave(f, '2026-08-10');
  const generated = await draft(f); expect(generated.status, generated.body.message).toBe(201); expect(generated.body.netSalary).toBe('3100.00');
  await action(f, generated.body.id, 1, 'cancel');
  await policy(f, { basis: 'hourly', unpaidLeave: { enabled: true, deductionBase: 'basic', divisor: 'fixed', fixedDays: 30 } });
  await approvedShift(f, '2026-08-11T06:00:00Z', 480);
  const regenerated = await request(f.admin.token, `/payroll/${generated.body.id}/regenerate`, { version: 2, reason: 'Synthetic hourly rule replacement' });
  expect(regenerated.status, regenerated.body.message).toBe(201); expect(regenerated.body.netSalary).toBe('96.00'); expect(regenerated.body.deductions[unpaidLeaveDeductionLabel]).toBeUndefined();
});
