import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, afterEach, test, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
const ctx = vi.hoisted(() => ({ db: null as any }));
vi.mock('../server/db', () => ({ get db() { return ctx.db; }, pool: {} }));
import ruleRouter from '../server/routes/hr-rules';
import leaveRouter from '../server/routes/leaveRequests';
import attendanceRouter from '../server/routes/attendance-operations';
import clockRouter from '../server/routes/attendance';
import payrollRouter from '../server/routes/payroll';
import lifecycleRouter from '../server/routes/lifecycle';
import hiringRouter from '../server/routes/hiring';
import employeeRouter from '../server/routes/employee';
import { authService } from '../server/services/auth';
import { clockAttendance } from '../server/services/attendance';
import { changeSheet } from '../server/services/timesheets';
import { seedCompensation } from './helpers/compensation';
let pg: PGlite, server: Server, base: string;
const password = 'OperationsTest8!';
async function request(token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') { const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }
function employeeInput(n: number) { return { employeeId: 'EMP-' + n, firstName: 'Employee', lastName: String(n), gender: 'female' as const, dateOfBirth: '1990-01-01', nationality: 'Test', qidNumber: 'ID-' + n, primaryMobile: '12345678', residentialAddress: 'Test address', emergencyContactName: 'Test contact', emergencyContactNumber: '12345678', department: 'Operations', position: 'Host', location: 'Doha', type: 'permanent' as const, joiningDate: '2025-01-01', workSchedule: 'management_office' }; }
async function account(name: string, role: s.UserRole, department = 'Operations') { const [u] = await ctx.db.insert(s.users).values({ username: name, email: name + '@example.test', password: await bcrypt.hash(password, 4), firstName: name, lastName: 'Tester', role, department, isActive: true, approvalStatus: 'approved' }).returning(); return { ...u, token: (await authService.login(name, password)).accessToken }; }
const attendanceConfig = { timezone: 'Asia/Qatar', workingDays: [0, 1, 2, 3, 4], startTime: '09:00', endTime: '17:00', breakMinutes: 30, graceMinutes: 10, holidays: [] };
const leaveConfig = { paid: true, balanceRequired: true, accrualMode: 'annual', annualDays: 21, monthlyDays: 0, carryoverLimit: 5, minServiceDays: 0, maxConsecutiveDays: 30, approverId: null };
const payConfig = { currency: 'USD', cycleStartDay: 1, payDay: 5, basis: 'salary', basicSalary: '1000.00', hourlyRate: '10.00', regularMinutesPerDay: 480, overtimeMultiplier: 1.5, allowances: { housing: '200.00' }, deductions: { loan: '10.00' }, approverId: 0 };
async function fixture() { const admin = await account('admin', 'super_admin'), reviewer = await account('reviewer', 'super_admin'), alice = await account('alice', 'permanent_employee'), bob = await account('bob', 'permanent_employee'); const [a] = await ctx.db.insert(s.employees).values({ ...employeeInput(1), userId: alice.id }).returning(); const [b] = await ctx.db.insert(s.employees).values({ ...employeeInput(2), userId: bob.id }).returning(); for (const u of [admin, reviewer])
    await ctx.db.insert(s.employees).values({ ...employeeInput(100 + u.id), userId: u.id }); return { admin, reviewer, alice, bob, a, b }; }
async function rule(f: any, kind: string, config: any, employeeId: number | null = null, effectiveFrom = '2026-01-01', name = kind === 'attendance' ? 'Work calendar' : kind === 'leave' ? 'Annual' : 'Pay policy') { const r = await request(f.admin.token, '/rules', { kind, name, config, employeeId, effectiveFrom, reason: 'Confirmed company configuration' }); expect(r.status, r.body.message).toBe(201); return r.body; }
beforeAll(async () => { process.env.JWT_SECRET = 'hr-operations-access-secret-at-least32'; process.env.JWT_REFRESH_SECRET = 'hr-operations-refresh-secret-at-least32'; process.env.APP_TIMEZONE = 'Asia/Qatar'; pg = new PGlite(); for (const f of readdirSync(new URL('../migrations', import.meta.url)).filter(n => n.endsWith('.sql')).sort())
    await pg.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8')); ctx.db = drizzle(pg); const app = express(); app.use(express.json()); app.use('/rules', ruleRouter); app.use('/leave', leaveRouter); app.use('/attendance', attendanceRouter); app.use('/clock', clockRouter); app.use('/payroll', payrollRouter); app.use('/lifecycle', lifecycleRouter); app.use('/hiring', hiringRouter); app.use('/employee',employeeRouter); server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); base = 'http://127.0.0.1:' + (server.address() as {
    port: number;
}).port; });
beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-15T12:00:00Z')); await pg.exec('TRUNCATE users, employees, workforce_sites, app_settings RESTART IDENTITY CASCADE'); });
afterEach(() => vi.useRealTimers());
afterAll(async () => { await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); await pg.close(); });
async function approvedTime(f: Awaited<ReturnType<typeof fixture>>, start: string, minutes: number) {
    const [site] = await ctx.db.insert(s.workforceSites).values({ name: 'Test venue', timezone: 'Asia/Qatar' }).returning();
    const [team] = await ctx.db.insert(s.workforceTeams).values({ name: 'Hosts', kind: 'fec', siteId: site.id }).returning();
    const startAt = new Date(start), endAt = new Date(+startAt + minutes * 60000);
    const [shift] = await ctx.db.insert(s.workforceShifts).values({ teamId: team.id, role: 'Host', headcount: 1, startAt, endAt, createdBy: f.admin.id }).returning();
    const [assignment] = await ctx.db.insert(s.workforceAssignments).values({ shiftId: shift.id, employeeId: f.a.id, status: 'accepted', createdBy: f.admin.id }).returning();
    const [sheet] = await ctx.db.insert(s.workforceTimesheets).values({ assignmentId: assignment.id, status: 'approved', actualStartAt: startAt, actualEndAt: endAt, breakMinutes: 0, workedMinutes: minutes, employeeNote: 'Verified actual shift', reviewerId: f.reviewer.id, reviewedAt: new Date(), payableMinutes: minutes, policyReference: 'Approved time policy' }).returning();
    return sheet;
}
test('completed service years and employee type gate leave, with dated acting cover',async()=>{
 const f=await fixture();
 await ctx.db.update(s.employees).set({joiningDate:'2025-09-17'}).where(eq(s.employees.id,f.a.id));
 await rule(f,'leave',{...leaveConfig,annualDays:30,carryoverLimit:0,minServiceYears:1,employeeTypes:['permanent'],approverId:f.reviewer.id,actingApprover:{userId:f.admin.id,startsOn:'2026-09-01',endsOn:'2026-09-30'}});
 const payload={employeeId:f.a.id,leaveType:'Annual',startDate:'2026-09-16',endDate:'2026-09-16'};
 expect((await request(f.alice.token,'/leave/preview',payload)).status).toBe(400);
 const valid=await request(f.alice.token,'/leave/preview',{...payload,startDate:'2026-09-17',endDate:'2026-09-17'});
 expect(valid.status,valid.body.message).toBe(200);
 await ctx.db.update(s.employees).set({type:'contract'}).where(eq(s.employees.id,f.a.id));
 expect((await request(f.alice.token,'/leave/preview',{...payload,startDate:'2026-09-17',endDate:'2026-09-17'})).status).toBe(400);
 await ctx.db.update(s.employees).set({joiningDate:'2025-01-01',type:'permanent'}).where(eq(s.employees.id,f.a.id));
 const saved=await request(f.alice.token,'/leave',{...payload,reason:'Acting manager coverage test'});
 expect(saved.status,saved.body.message).toBe(201);
 expect((await request(f.reviewer.token,`/leave/${saved.body.id}/status`,{status:'approved'},'PATCH')).status).toBe(403);
 expect((await request(f.admin.token,`/leave/${saved.body.id}/status`,{status:'approved'},'PATCH')).status).toBe(200);
});

test('invalid date ranges are actionable errors and grace applies only to assigned calendars', async () => {
    const f = await fixture();
    expect((await request(f.admin.token, '/rules', { kind: 'payroll', name: 'Pay policy', employeeId: null, effectiveFrom: '2026-01-01', reason: 'Validate payday order', config: { ...payConfig, approverId: f.reviewer.id, cycleStartDay: 20, payDay: 5 } })).status).toBe(201);
    await rule(f, 'leave', leaveConfig);
    expect((await request(f.alice.token, '/leave/preview', { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-17', endDate: '2026-09-16' })).status).toBe(400);
    await ctx.db.update(s.employees).set({ workSchedule: 'unassigned' }).where(eq(s.employees.id, f.b.id));
    expect((await request(f.bob.token, `/attendance/day/${f.b.id}/2026-09-14`)).body.plannedMinutes).toBe(0);
    await rule(f, 'attendance', attendanceConfig);
    expect((await clockAttendance(f.alice.id, 'in', undefined, undefined, new Date('2026-09-14T06:10:00Z'))).status).toBe('present');
    expect((await clockAttendance(f.bob.id, 'in', undefined, undefined, new Date('2026-09-14T06:11:00Z'))).status).toBe('late');
});
test('hourly payroll shares the daily overtime cap, reserves time, regenerates with history and locks payment atomically', async () => {
    const f = await fixture();
    const one = await approvedTime(f, '2026-08-10T06:00:00Z', 300);
    await approvedTime(f, '2026-08-10T11:00:00Z', 300);
    await rule(f, 'payroll', { ...payConfig, basis: 'hourly', basicSalary: '0.00', allowances: {}, deductions: {}, approverId: f.reviewer.id });
    const draft = await request(f.admin.token, '/payroll', { employeeId: f.a.id, year: 2026, month: 9 });
    expect(draft.status, draft.body.message).toBe(201);
    expect(draft.body.netSalary).toBe('110.00');
    const id = draft.body.id;expect((await request(f.reviewer.token,`/payroll/${id}`,{version:1,adjustments:[],reason:'Reviewer must not prepare amounts'},'PATCH')).status).toBe(403);
    const detail = await request(f.admin.token, '/payroll/' + id);
    expect(detail.body.lines.map((l: any) => [l.regularMinutes, l.overtimeMinutes])).toEqual([[300, 0], [180, 120]]);
    await expect(ctx.db.transaction((tx: any) => changeSheet(tx, { userId: f.admin.id, role: f.admin.role } as any, one, { status: 'returned' }, 'Correction', 'Correct recorded time'))).rejects.toThrow(/payroll/i);
    expect((await request(f.admin.token, `/payroll/${id}/action`, { version: 1, action: 'cancel', reason: 'Update the employee rate' })).status).toBe(200);
    await rule(f, 'payroll', { ...payConfig, basis: 'hourly', hourlyRate: '20.00', allowances: {}, deductions: {}, approverId: f.reviewer.id }, f.a.id);
    const regen = await request(f.admin.token, `/payroll/${id}/regenerate`, { version: 2, reason: 'Recalculate approved rate' });
    expect(regen.status, regen.body.message).toBe(201);
    expect(regen.body.id).toBe(id);
    expect(regen.body.netSalary).toBe('220.00');
    expect(regen.body.review.history[0].snapshot.amounts.netSalary).toBe('110.00');
    expect((await request(f.admin.token, `/payroll/${id}/regenerate`, { version: 2, reason: 'Retry stale regeneration' })).status).toBe(409);
    await request(f.admin.token, `/payroll/${id}/action`, { version: 3, action: 'submit', reason: 'Ready for review' });
    await request(f.reviewer.token, `/payroll/${id}/action`, { version: 4, action: 'approve', reason: 'Verified regular and overtime' });
    await pg.exec("CREATE FUNCTION reject_pay_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced revision failure'; END $$; CREATE TRIGGER reject_pay_revision BEFORE INSERT ON timesheet_revisions FOR EACH ROW EXECUTE FUNCTION reject_pay_revision();");
    try {
        expect((await request(f.reviewer.token, `/payroll/${id}/mark-paid`, { version: 5, reference: 'PAY-QA-001', confirmed: true })).status).toBe(500);
        expect((await ctx.db.select().from(s.payroll).where(eq(s.payroll.id, id)))[0].status).toBe('approved');
        expect((await ctx.db.select().from(s.workforceTimesheets).where(eq(s.workforceTimesheets.id, one.id)))[0].status).toBe('approved');
    }
    finally {
        await pg.exec('DROP TRIGGER reject_pay_revision ON timesheet_revisions; DROP FUNCTION reject_pay_revision();');
    }
    expect((await request(f.reviewer.token, `/payroll/${id}/mark-paid`, { version: 5, reference: 'PAY-QA-001', confirmed: true })).status).toBe(200);
    expect((await ctx.db.select().from(s.workforceTimesheets).where(eq(s.workforceTimesheets.id, one.id)))[0]).toMatchObject({ status: 'payroll_locked', payrollId: id });expect((await request(f.alice.token,'/employee/dashboard')).body.payroll).toMatchObject({currency:'USD',netSalary:'220.00'});
});
test('a failed leave audit rolls back its request, reservation and newly posted accrual', async () => {
    const f = await fixture();
    await rule(f, 'leave', leaveConfig);
    await pg.exec("CREATE FUNCTION reject_leave_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='leave_request' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_leave_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_leave_audit();");
    try {
        expect((await request(f.alice.token, '/leave', { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17', reason: 'Family appointment' })).status).toBe(500);
        expect(await ctx.db.select().from(s.leaves)).toHaveLength(0);
        expect(await ctx.db.select().from(s.leaveLedger)).toHaveLength(0);
        expect(await ctx.db.select().from(s.leaveSnapshots)).toHaveLength(0);
    }
    finally {
        await pg.exec('DROP TRIGGER reject_leave_audit ON activity_logs; DROP FUNCTION reject_leave_audit();');
    }
});
test('employees can cancel their own pending leave and release its reservation', async () => {
    const f = await fixture();
    await rule(f, 'leave', leaveConfig);
    const leave = await request(f.alice.token, '/leave', { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17', reason: 'Planned family appointment' });
    expect((await request(f.bob.token, `/leave/${leave.body.id}/status`, { status: 'cancelled', reason: 'Cancel another employee request' }, 'PATCH')).status).toBe(404);
    expect((await request(f.alice.token, `/leave/${leave.body.id}/status`, { status: 'cancelled', reason: 'Plans have now changed' }, 'PATCH')).status).toBe(200);
    expect((await request(f.alice.token, `/leave/balances/${f.a.id}/2026`)).body.balances[0]).toMatchObject({ balance: 21, reserved: 0, available: 21 });const pending=await request(f.alice.token,'/leave',{employeeId:f.a.id,leaveType:'Annual',startDate:'2026-09-16',endDate:'2026-09-17',reason:'Another planned appointment'});await ctx.db.update(s.employees).set({status:'inactive',terminationDate:'2026-09-15'}).where(eq(s.employees.id,f.a.id));expect((await request(f.admin.token,`/leave/${pending.body.id}/status`,{status:'approved',reason:'Review after employment ends'},'PATCH')).status).toBe(409);
});
test('assigned checklist owners have limited access and cancellation preserves the active employee', async () => {
    const f = await fixture();
    const template = await request(f.admin.token, '/lifecycle/templates', { name: 'Employee orientation', kind: 'onboarding', tasks: [{ title: 'Orientation', kind: 'general', required: true, offsetDays: 0 }] });
    const flow = await request(f.admin.token, '/lifecycle', { employeeId: f.a.id, templateId: template.body.id, startDate: '2026-09-15', reason: 'Start orientation', ownerId: f.bob.id });
    const id = flow.body.id;
    const bob = await request(f.bob.token, '/lifecycle/' + id);
    expect(bob.status).toBe(200);
    expect(bob.body.canManage).toBe(false);
    const task = bob.body.tasks[0];
    expect((await request(f.bob.token, `/lifecycle/${id}/tasks/${task.id}`, { version: 1, ownerId: f.admin.id, evidence: 'Reassign this task' }, 'PATCH')).status).toBe(403);
    expect((await request(f.bob.token, `/lifecycle/${id}/tasks/${task.id}`, { version: 1, status: 'completed', evidence: 'Orientation attended' }, 'PATCH')).status).toBe(200);
    expect((await request(f.admin.token, `/lifecycle/${id}/cancel`, { version: 2, reason: 'Workflow no longer needed' })).status).toBe(200);
    expect((await ctx.db.select().from(s.employees).where(eq(s.employees.id, f.a.id)))[0].status).toBe('active');
    expect((await request(f.bob.token, `/lifecycle/${id}/tasks/${task.id}`, { version: 3, status: 'pending', evidence: 'Reopen the completed task' }, 'PATCH')).status).toBe(409);
});
test('document checklist evidence must belong to the employee and permits completion once verified',async()=>{
 const f=await fixture();const template=await request(f.admin.token,'/lifecycle/templates',{name:'Identity collection',kind:'onboarding',tasks:[{title:'Collect identity',kind:'document',required:true,offsetDays:0}]});const flow=await request(f.admin.token,'/lifecycle',{employeeId:f.a.id,templateId:template.body.id,startDate:'2026-09-15',reason:'Confirm employee identity',ownerId:f.admin.id});const id=flow.body.id,detail=await request(f.admin.token,'/lifecycle/'+id),task=detail.body.tasks[0];
 const doc={documentType:'passport',documentNumber:'SYNTHETIC',issueDate:'2025-01-01',expiryDate:'2030-01-01',status:'valid'};
 const [other]=await ctx.db.insert(s.documents).values({...doc,employeeId:f.b.id,documentFile:`documents/${f.b.id}/1234-abcd.pdf`}).returning();expect((await request(f.admin.token,`/lifecycle/${id}/tasks/${task.id}`,{version:1,status:'completed',evidence:'Identity collected',documentId:other.id},'PATCH')).status).toBe(400);
 const [own]=await ctx.db.insert(s.documents).values({...doc,employeeId:f.a.id,documentFile:`documents/${f.a.id}/1234-abcd.pdf`}).returning();expect((await request(f.admin.token,`/lifecycle/${id}/tasks/${task.id}`,{version:1,status:'completed',evidence:'Identity collected',documentId:own.id},'PATCH')).status).toBe(200);await seedCompensation(ctx.db,f.a.id,f.admin.id);expect((await request(f.admin.token,`/lifecycle/${id}/complete`,{version:2,reason:'Identity checklist verified',confirmed:true})).status).toBe(200);
});
test('interviews enforce scopes and versions, and declined offers allow a revised offer', async () => {
    const f = await fixture();
    const [actor] = await ctx.db.select().from(s.employees).where(eq(s.employees.userId, f.admin.id));
    const [job] = await ctx.db.insert(s.jobRequisitions).values({ requisitionId: 'JR-TEST', jobTitle: 'Host', department: 'Operations', location: 'Doha', positionType: 'permanent', numberOfVacancies: 1, jobDescription: 'Guest services', qualifications: 'Experience', responsibilities: 'Visitors', requiredSkills: 'Service', requestedBy: actor.id, status: 'open' }).returning();
    const [candidate] = await ctx.db.insert(s.candidates).values({ fullNameEn: 'Candidate', email: 'candidate@example.test', phone: '12345', source: 'other' }).returning();
    const [app] = await ctx.db.insert(s.jobApplications).values({ candidateId: candidate.id, requisitionId: job.id, applicationDate: '2026-09-15', status: 'shortlisted' }).returning();
    const interview = await request(f.admin.token, '/hiring/interviews', { applicationId: app.id, version: 1, interviewerId: actor.id, interviewDate: '2026-09-15T13:00:00Z', interviewType: 'video', interviewRound: 'first', reason: 'Video meeting in HR office' });
    expect(interview.status, interview.body.message).toBe(201);
    expect((await request(f.alice.token, '/hiring/interviews')).body.rows).toEqual([]);
    const result = { version: 1, status: 'completed', rating: 4, recommendation: 'hire', feedback: 'Strong customer service evidence' };
    expect((await request(f.admin.token, `/hiring/interviews/${interview.body.id}/result`, result)).status).toBe(409);
    vi.setSystemTime(new Date('2026-09-15T14:00:00Z'));
    f.admin.token = (await authService.login(f.admin.username, password)).accessToken;
    expect((await request(f.admin.token, `/hiring/interviews/${interview.body.id}/result`, result)).status).toBe(200);
    expect((await request(f.admin.token, `/hiring/interviews/${interview.body.id}/result`, result)).status).toBe(409);
    const offerInput = { applicationId: app.id, version: 2, salary: 2000, currency: 'QAR', startDate: '2026-10-01', expiryDate: '2026-09-20', reason: 'Approved compensation offer' };
    const offer = await request(f.admin.token, '/hiring/offers', offerInput);
    expect(offer.status).toBe(201);
    expect((await request(f.admin.token, `/hiring/offers/${offer.body.id}/action`, { version: 1, status: 'declined', reason: 'Candidate requests revised salary' })).status).toBe(200);
    expect((await request(f.admin.token, '/hiring/offers', { ...offerInput, version: 4, salary: 2100 })).status).toBe(201);
});
test('rules require administrators and employee overrides apply without rewriting saved leave', async () => { const f = await fixture(); expect((await request(f.alice.token, '/rules')).status).toBe(403); expect((await request('', '/leave')).status).toBe(401); await rule(f, 'attendance', attendanceConfig); await rule(f, 'leave', leaveConfig); const r = await request(f.alice.token, '/leave', { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17', reason: 'Family appointment' }); expect(r.status, r.body.message).toBe(201); expect(r.body.totalDays).toBe(2); await rule(f, 'attendance', { ...attendanceConfig, holidays: [{ date: '2026-09-17', name: 'Employee holiday' }] }, f.a.id); const saved = await request(f.alice.token, '/leave/' + r.body.id); expect(saved.body.totalDays).toBe(2); const preview = await request(f.alice.token, '/leave/preview', { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17' }); expect(preview.body.totalDays).toBe(1); const other = await request(f.bob.token, '/leave/preview', { employeeId: f.b.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17' }); expect(other.body.totalDays).toBe(2); expect((await request(f.bob.token, `/leave/balances/${f.a.id}/2026`)).status).toBe(404); });
test('leave reserves balance, serializes duplicate requests and refunds an approved cancellation once', async () => { const f = await fixture(); await rule(f, 'leave', { ...leaveConfig, annualDays: 2, approverId: f.reviewer.id }); const payload = { employeeId: f.a.id, leaveType: 'Annual', startDate: '2026-09-16', endDate: '2026-09-17', reason: 'Family appointment' }; const results = await Promise.all([request(f.alice.token, '/leave', payload), request(f.alice.token, '/leave', payload)]); expect(results.map(r => r.status).sort()).toEqual([201, 409]); const id = results.find(r => r.status === 201)!.body.id; expect((await request(f.alice.token, `/leave/balances/${f.a.id}/2026`)).body.balances[0]).toMatchObject({ balance: 2, reserved: 2, available: 0 }); expect((await request(f.admin.token, `/leave/${id}/status`, { status: 'approved' }, 'PATCH')).status).toBe(403); expect((await request(f.reviewer.token, `/leave/${id}/status`, { status: 'approved' }, 'PATCH')).status).toBe(200); expect((await request(f.reviewer.token, `/leave/${id}/status`, { status: 'approved' }, 'PATCH')).status).toBe(409); expect((await request(f.reviewer.token, `/leave/${id}/status`, { status: 'cancelled', version: 2 }, 'PATCH')).status).toBe(200); expect((await request(f.reviewer.token, `/leave/${id}/status`, { status: 'cancelled', version: 2 }, 'PATCH')).status).toBe(409); expect((await request(f.alice.token, `/leave/balances/${f.a.id}/2026`)).body.balances[0].balance).toBe(2); });
test('monthly accrual and capped carryover are idempotent and policy updates preserve posted credits', async () => { const f = await fixture(); await rule(f, 'leave', { ...leaveConfig, accrualMode: 'monthly', annualDays: 0, monthlyDays: 2 }, null, '2025-01-01'); const get = () => request(f.alice.token, `/leave/balances/${f.a.id}/2026`); const one = await get(), two = await get(); expect(one.body.balances[0].balance).toBe(21); expect(two.body.history).toHaveLength(one.body.history.length); await rule(f, 'leave', { ...leaveConfig, accrualMode: 'monthly', monthlyDays: 3 }, f.a.id, '2026-09-01'); expect((await get()).body.balances[0].balance).toBe(21); });
test('corrections require independent review, preserve breaks and reject stale clock changes', async () => { const f = await fixture(); await rule(f, 'attendance', attendanceConfig); const payload = { employeeId: f.a.id, date: '2026-09-14', expectedVersion: 0, checkIn: '2026-09-14T06:00:00Z', checkOut: '2026-09-14T14:00:00Z', breakMinutes: 45, reason: 'Missed mobile clock entry' }; const submitted = await request(f.alice.token, '/attendance/corrections', payload); expect(submitted.status, submitted.body.message).toBe(201); expect((await request(f.alice.token, `/attendance/corrections/${submitted.body.id}/review`, { decision: 'approved', reason: 'Reviewed records' })).status).toBe(404); const approved = await request(f.admin.token, `/attendance/corrections/${submitted.body.id}/review`, { decision: 'approved', reason: 'Reviewed shift records' }); expect(approved.status, approved.body.message).toBe(200); const day = await request(f.alice.token, `/attendance/day/${f.a.id}/2026-09-14`); expect(day.body.record.totalWorkHours).toBe(435); expect(day.body.plannedMinutes).toBe(450); expect(day.body.varianceMinutes).toBe(-15); expect((await request(f.alice.token, '/attendance/corrections', payload)).status).toBe(409); expect((await request(f.admin.token, '/clock', payload)).status).toBe(409); });
test('overnight clock out finds the open record across the local midnight boundary', async () => { const f = await fixture(); await clockAttendance(f.alice.id, 'in', undefined, undefined, new Date('2026-09-13T20:00:00Z')); const done = await clockAttendance(f.alice.id, 'out', undefined, undefined, new Date('2026-09-14T02:00:00Z')); expect(done.date).toBe('2026-09-13'); expect(done.totalWorkHours).toBe(360); });
test('payroll uses dated rates and requires an independent reviewer before recording external payment', async () => { const f = await fixture(); await rule(f, 'payroll', { ...payConfig, approverId: f.reviewer.id }); await rule(f, 'payroll', { ...payConfig, basicSalary: '1310.00', approverId: f.reviewer.id }, f.a.id, '2026-08-16'); const draft = await request(f.admin.token, '/payroll', { employeeId: f.a.id, year: 2026, month: 9 }); expect(draft.status, draft.body.message).toBe(201); expect(draft.body.basicSalary).toBe('1160.00'); expect(draft.body.netSalary).toBe('1350.00'); const id = draft.body.id; expect((await request(f.admin.token, `/payroll/${id}/mark-paid`, { version: 1, reference: 'BANK-001', confirmed: true })).status).toBe(409); expect((await request(f.admin.token, `/payroll/${id}/action`, { version: 1, action: 'submit', reason: 'Ready for review' })).status).toBe(200); expect((await request(f.admin.token, `/payroll/${id}/action`, { version: 2, action: 'approve', reason: 'Reviewed figures' })).status).toBe(403); expect((await request(f.reviewer.token, `/payroll/${id}/action`, { version: 2, action: 'approve', reason: 'Reviewed figures' })).status).toBe(200); expect((await request(f.reviewer.token, `/payroll/${id}/mark-paid`, { version: 3, reference: 'BANK-001', confirmed: true })).status).toBe(200); expect((await request(f.admin.token, `/payroll/${id}`, { version: 4, adjustments: [], reason: 'Change paid figures' }, 'PATCH')).status).toBe(409); expect((await request(f.bob.token, `/payroll/${id}`)).status).toBe(404); });
test('onboarding requires document evidence and offboarding revokes the linked account atomically', async () => { const f = await fixture(); const template = await request(f.admin.token, '/lifecycle/templates', { name: 'Exit', kind: 'offboarding', tasks: [{ title: 'Return laptop', kind: 'asset_return', required: true, offsetDays: 0 }] }); expect(template.status).toBe(201); const flow = await request(f.admin.token, '/lifecycle', { employeeId: f.a.id, templateId: template.body.id, startDate: '2026-09-15', reason: 'Employment ended', ownerId: f.admin.id }); expect(flow.status, flow.body.message).toBe(201); const id = flow.body.id; expect((await request(f.admin.token, `/lifecycle/${id}/complete`, { version: 1, reason: 'Exit checklist complete', confirmed: true })).status).toBe(409); const detail = await request(f.admin.token, '/lifecycle/' + id); const task = detail.body.tasks[0]; expect((await request(f.admin.token, `/lifecycle/${id}/tasks/${task.id}`, { version: 1, status: 'completed', evidence: 'Asset received by IT' }, 'PATCH')).status).toBe(400); expect((await request(f.admin.token, `/lifecycle/${id}/tasks/${task.id}`, { version: 1, status: 'completed', evidence: 'Asset received by IT', assetTag: 'LAP-001' }, 'PATCH')).status).toBe(200); expect((await request(f.admin.token, `/lifecycle/${id}/complete`, { version: 2, reason: 'Exit checklist complete', confirmed: true })).status).toBe(200); await expect(authService.authenticateToken(f.alice.token)).rejects.toThrow(); const [employee] = await ctx.db.select().from(s.employees).where(eq(s.employees.id, f.a.id)); expect(employee.status).toBe('inactive'); expect(employee.terminationDate).toBe('2026-09-15'); });
test('accepted-offer handoff creates one employee and checklist and rejects duplicate or invalid transitions', async () => { const f = await fixture(); const job = await request(f.admin.token, '/hiring/jobs', { jobTitle: 'Host', department: 'Operations', location: 'Doha', positionType: 'permanent', numberOfVacancies: 1, jobDescription: 'Guest services', qualifications: 'Relevant experience', responsibilities: 'Support visitors', requiredSkills: 'Customer service' }); expect(job.status, job.body.message).toBe(201); expect((await request(f.admin.token, `/hiring/jobs/${job.body.id}/action`, { version: 1, status: 'pending_approval', reason: 'Please approve hiring' })).status).toBe(200); expect((await request(f.reviewer.token, `/hiring/jobs/${job.body.id}/action`, { version: 2, status: 'approved', reason: 'Approved headcount' })).status).toBe(200); expect((await request(f.admin.token, `/hiring/jobs/${job.body.id}/action`, { version: 3, status: 'open', reason: 'Start recruitment' })).status).toBe(200); const app = await request(f.admin.token, '/hiring/applications', { requisitionId: job.body.id, fullNameEn: 'New Hire', email: 'hire@example.test', phone: '12345', source: 'other' }); expect(app.status).toBe(201); for (const [i, status] of ['screening', 'shortlisted'].entries())
    expect((await request(f.admin.token, `/hiring/applications/${app.body.id}/action`, { version: i + 1, status, reason: 'Reviewed candidate evidence' })).status).toBe(200); const offer = await request(f.admin.token, '/hiring/offers', { applicationId: app.body.id, version: 3, salary: 2000, currency: 'QAR', startDate: '2026-10-01', expiryDate: '2026-09-20', reason: 'Approved compensation offer' }); expect(offer.status, offer.body.message).toBe(201); expect((await request(f.admin.token, `/hiring/offers/${offer.body.id}/action`, { version: 1, status: 'accepted', reason: 'Signed acceptance received' })).status).toBe(200); const template = await request(f.admin.token, '/lifecycle/templates', { name: 'New employee', kind: 'onboarding', tasks: [{ title: 'Collect identification', kind: 'document', required: true, offsetDays: 0 }] }); const input = { version: 2, employee: { ...employeeInput(50), joiningDate: '2026-10-01' }, templateId: template.body.id, ownerId: f.admin.id, reason: 'Accepted candidate onboarding' }; const handoff = await request(f.admin.token, `/hiring/offers/${offer.body.id}/handoff`, input); expect(handoff.status, handoff.body.message).toBe(201); const retry = await request(f.admin.token, `/hiring/offers/${offer.body.id}/handoff`, input); expect(retry.body.employeeId).toBe(handoff.body.employeeId); expect((await ctx.db.select().from(s.hiringHandoffs))).toHaveLength(1); const workflow = await request(f.admin.token, '/lifecycle/' + handoff.body.caseId); const task = workflow.body.tasks[0]; expect((await request(f.admin.token, `/lifecycle/${handoff.body.caseId}/tasks/${task.id}`, { version: 1, status: 'completed', evidence: 'Collected passport' }, 'PATCH')).status).toBe(400); });
