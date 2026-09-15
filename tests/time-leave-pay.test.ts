import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
import {defaultCalculationRules} from '../shared/calculation-rules';
import {timeEarnings} from '../shared/operations-policies';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import attendanceRouter from '../server/routes/attendance';
import leaveRouter from '../server/routes/leaveRequests';
import payrollRouter from '../server/routes/payroll';
import timesheetRouter from '../server/routes/timesheets';
import {clockAttendance} from '../server/services/attendance';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const at=(day=-2,hour=8)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+day);d.setUTCHours(hour,0,0,0);return d.toISOString();};
async function req(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function user(name:string,role:schema.UserRole='employee'){const [u]=await ctx.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('TestingPass123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,'TestingPass123!')).accessToken};}
async function setup(){const admin=await user('admin','super_admin'),alice=await user('alice'),bob=await user('bob');const [employee]=await ctx.db.insert(schema.employees).values({userId:alice.id,employeeId:'A001',firstName:'Alice',lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'secret-qid',primaryMobile:'private-phone',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'temporary',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01',workSchedule:'shift_based'}).returning();const [type]=await ctx.db.insert(schema.leaveTypes).values({name:'Annual',category:'paid',accrualMethod:'none',active:true}).returning();return {admin,alice,bob,employee,type};}
const leaveRules={enabled:true,monthlyDays:1.25,annualCap:15,prorate:true,minServiceDays:0,carryoverCap:5};
const payRules={enabled:true,hourlyRateCents:1000,overtimeAfterMinutes:360,overtimeMultiplierHundredths:150,roundingMode:'nearest'};
async function policy(f:any,kind='leave',rules:any=leaveRules){const result=await req(f.admin.token,'/attendance/policies',{kind,scope:kind==='leave'?'Annual':'shift_based',effectiveFrom:'2020-01-01',expectedVersion:0,reason:'Approved operating policy',rules});expect(result.status).toBe(201);return result.body;}
async function postRun(f:any,values:any){const body={employeeId:f.employee.id,leaveType:'Annual',year:new Date().getUTCFullYear()-1,expectedVersion:0,reason:'Verified source records',...values};const quote=await req(f.admin.token,'/leave/ledger-run',{...body,preview:true});expect(quote.status).toBe(200);const posted=await req(f.admin.token,'/leave/ledger-run',{...body,preview:false,expectedQuote:quote.body.quote,expectedPolicyId:quote.body.basis.policy?.id});return {quote,posted,body};}
async function timeFixture(){const f=await setup();await policy(f,'timepay',payRules);const day=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-1,10,8)),end=new Date(+day+8*3600000);const [site]=await ctx.db.insert(schema.workforceSites).values({name:'Mall',timezone:'Asia/Qatar'}).returning();const [team]=await ctx.db.insert(schema.workforceTeams).values({name:'Activation',kind:'fec',siteId:site.id}).returning();const [shift]=await ctx.db.insert(schema.workforceShifts).values({teamId:team.id,role:'Activity host',headcount:1,startAt:day,endAt:end,breakMinutes:30,createdBy:f.admin.id}).returning();const [assignment]=await ctx.db.insert(schema.workforceAssignments).values({shiftId:shift.id,employeeId:f.employee.id,status:'accepted',createdBy:f.admin.id}).returning();const [sheet]=await ctx.db.insert(schema.workforceTimesheets).values({assignmentId:assignment.id,status:'approved',actualStartAt:day,actualEndAt:end,breakMinutes:30,workedMinutes:450,employeeNote:'Private employee note',reviewerId:f.admin.id,reviewedAt:new Date(),payableMinutes:450,policyReference:'Verified hours'}).returning();const payroll=await req(f.admin.token,'/payroll',{employeeId:f.employee.id,month:day.getUTCMonth()+1,year:day.getUTCFullYear(),basicSalary:'100',allowances:{},deductions:{}});expect(payroll.status).toBe(201);return {...f,sheet,shift,payroll:payroll.body};}
beforeAll(async()=>{process.env.JWT_SECRET='test-time-leave-pay-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-time-leave-pay-refresh-32-characters';process.env.APP_TIMEZONE='UTC';pg=new PGlite();for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/attendance',attendanceRouter);app.use('/leave',leaveRouter);app.use('/payroll',payrollRouter);app.use('/timesheets',timesheetRouter);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,leave_types,workforce_sites,calculation_rule_versions RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pg.close();});

test('attendance corrections are independent, versioned, private and preserve calculation history',async()=>{
 const f=await setup();const record=await req(f.admin.token,'/attendance',{employeeId:f.employee.id,date:at().slice(0,10),status:'present',checkIn:at(),checkOut:at(-2,16),totalBreakMinutes:30});expect(record.status).toBe(201);
 const proposal={version:record.body.version,reason:'Clock missed final handover',proposed:{checkIn:at(),checkOut:at(-2,17),totalBreakMinutes:30}};
 expect((await req(f.bob.token,`/attendance/records/${record.body.id}/corrections`,proposal)).status).toBe(404);
 const correction=await req(f.alice.token,`/attendance/records/${record.body.id}/corrections`,proposal);expect(correction.status).toBe(201);
 expect((await req(f.alice.token,`/attendance/corrections/${correction.body.id}/decide`,{decision:'approved',reason:'Approve my own time'})).status).toBeGreaterThanOrEqual(400);
 const decided=await req(f.admin.token,`/attendance/corrections/${correction.body.id}/decide`,{decision:'approved',reason:'Confirmed against handover'});expect(decided.status).toBe(200);
 const [saved]=await ctx.db.select().from(schema.attendance);expect(saved.version).toBe(2);expect(saved.totalWorkHours).toBe(510);expect(saved.calculationSnapshot).toEqual(record.body.calculationSnapshot);
 expect((await req(f.alice.token,`/attendance/records/${saved.id}/history`)).body).toHaveLength(2);expect((await req(f.bob.token,`/attendance/records/${saved.id}/history`)).status).toBe(404);
});
test('intervening manual edits make a correction stale and permit withdrawal',async()=>{
 const f=await setup(),record=await req(f.admin.token,'/attendance',{employeeId:f.employee.id,date:at().slice(0,10),status:'present',checkIn:at(),checkOut:at(-2,16)});
 const c=await req(f.alice.token,`/attendance/records/${record.body.id}/corrections`,{version:1,reason:'Correct end of shift',proposed:{checkIn:at(),checkOut:at(-2,17),totalBreakMinutes:0}});
 await req(f.admin.token,'/attendance',{employeeId:f.employee.id,date:at().slice(0,10),status:'present',checkIn:at(),checkOut:at(-2,18)});
 expect((await req(f.admin.token,`/attendance/corrections/${c.body.id}/decide`,{decision:'approved',reason:'Review completed time'})).status).toBe(409);
 expect((await req(f.alice.token,`/attendance/corrections/${c.body.id}/decide`,{decision:'withdrawn',reason:'Record already corrected'})).status).toBe(200);
});
test('clock sessions continue across midnight and cannot duplicate active attendance',async()=>{
 const f=await setup();const start=new Date(at(-2,23)),end=new Date(at(-1,7));const row=await clockAttendance(f.alice.id,'in',undefined,undefined,start);
 await expect(clockAttendance(f.alice.id,'in',undefined,undefined,new Date(at(-1,1)))).rejects.toThrow(/active/);
 const done=await clockAttendance(f.alice.id,'out',undefined,undefined,end);expect(done.id).toBe(row.id);expect(done.totalWorkHours).toBe(480);expect(done.date).toBe(at().slice(0,10));
});
test('policies require admin and reject stale publications without overwriting history',async()=>{
 const f=await setup();const input={kind:'leave',scope:'Annual',effectiveFrom:'2020-01-01',expectedVersion:0,reason:'Versioned accrual policy',rules:leaveRules};expect((await req(f.alice.token,'/attendance/policies',input)).status).toBe(403);
 expect((await req(f.admin.token,'/attendance/policies',input)).status).toBe(201);expect((await req(f.admin.token,'/attendance/policies',input)).status).toBe(409);expect((await req(f.admin.token,'/attendance/policies?kind=leave&scope=Annual')).body).toHaveLength(1);
});
test('fractional accrual posts once, caps annual credits and refuses unfinished periods',async()=>{
 const f=await setup();await policy(f,'leave',{...leaveRules,annualCap:2});const first=await postRun(f,{kind:'accrual',month:1});expect(first.posted.status).toBe(201);expect(first.posted.body.days).toBe(1.25);
 const retry=await req(f.admin.token,'/leave/ledger-run',{...first.body,preview:false});expect(retry.status).toBe(201);expect(retry.body.entry.id).toBe(first.posted.body.entry.id);
 const second=await postRun(f,{kind:'accrual',month:2,expectedVersion:first.posted.body.entry.id});expect(second.posted.body.days).toBe(0.75);
 const future=await req(f.admin.token,'/leave/ledger-run',{...first.body,year:new Date().getUTCFullYear()+1,preview:true});expect(future.status).toBe(409);
 const balances=await req(f.alice.token,`/leave/balances/${f.employee.id}/${first.body.year}`);expect(balances.body.accounts[0].allocated).toBe(2);
});
test('carryover transfers available days instead of duplicating the source entitlement',async()=>{
 const f=await setup();await policy(f);const year=new Date().getUTCFullYear();const opening=await postRun(f,{kind:'opening',year:year-1,verifiedAvailable:7.25});expect(opening.posted.status).toBe(201);
 const carry=await postRun(f,{kind:'carryover',year});expect(carry.posted.status).toBe(201);expect(carry.posted.body.days).toBe(5);
 expect((await req(f.alice.token,`/leave/balances/${f.employee.id}/${year-1}`)).body.accounts[0].available).toBe(2.25);
 expect((await req(f.alice.token,`/leave/balances/${f.employee.id}/${year}`)).body.accounts[0].available).toBe(5);
});
test('half-day leave uses policy permission and reserves fractional funds',async()=>{
 const f=await setup(),year=new Date().getUTCFullYear(),date=at().slice(0,10);await postRun(f,{kind:'opening',year,verifiedAvailable:0.75});
 const body={employeeId:f.employee.id,leaveType:'Annual',startDate:date,endDate:date,dayFraction:0.5,reason:'Personal appointment'};expect((await req(f.alice.token,'/leave',body)).status).toBe(400);
 await ctx.db.insert(schema.calculationRuleVersions).values({scope:'shift_based',effectiveFrom:'2020-01-01',rules:{...defaultCalculationRules,leave:{...defaultCalculationRules.leave,countMethod:'calendar_days',allowHalfDays:true}},reason:'Allow fractional leave',createdBy:f.admin.id});
 const leave=await req(f.alice.token,'/leave',body);expect(leave.status).toBe(201);expect(leave.body.totalDays).toBe(0.5);
 expect((await req(f.alice.token,`/leave/balances/${f.employee.id}/${year}`)).body.accounts[0].available).toBe(0.25);
 expect((await req(f.alice.token,'/leave',body)).status).toBe(409);
});
test('legacy cross-year reconciliation preserves total and enables verified opening allocation',async()=>{
 const f=await setup(),year=new Date().getUTCFullYear();const [leave]=await ctx.db.insert(schema.leaves).values({employeeId:f.employee.id,leaveType:'Annual',startDate:`${year-1}-12-31`,endDate:`${year}-01-01`,totalDays:1.5,status:'approved',reason:'Legacy leave'}).returning();
 const body={leaveId:leave.id,splits:[{year:year-1,days:1},{year,days:0.5}],reason:'Verified historical allocation'};
 expect((await req(f.admin.token,`/leave/ledger-reconciliation/${f.employee.id}/split`,{...body,splits:[{year:year-1,days:1},{year,days:1}]})).status).toBe(400);
 expect((await req(f.admin.token,`/leave/ledger-reconciliation/${f.employee.id}/split`,body)).status).toBe(200);
 const opening=await postRun(f,{kind:'opening',year,verifiedAvailable:3.25});expect(opening.posted.status).toBe(201);expect(opening.posted.body.days).toBe(3.75);
});
test('preview staleness rejects leave posting when requests change reserved balance',async()=>{
 const f=await setup(),year=new Date().getUTCFullYear(),body={employeeId:f.employee.id,leaveType:'Annual',year,kind:'opening',verifiedAvailable:3,expectedVersion:0,reason:'Verified available balance',preview:true};const quote=await req(f.admin.token,'/leave/ledger-run',body);expect(quote.status).toBe(200);
 await ctx.db.insert(schema.leaves).values({employeeId:f.employee.id,leaveType:'Annual',startDate:at().slice(0,10),endDate:at().slice(0,10),totalDays:1,reason:'New pending request'});
 expect((await req(f.admin.token,'/leave/ledger-run',{...body,preview:false,expectedQuote:quote.body.quote})).status).toBe(409);
});
test('time-to-pay imports approved minutes, preserves allowance and locks sheets at payment',async()=>{
 const f=await timeFixture(),url=`/payroll/${f.payroll.id}/time-import`,body={preview:true,reason:'Verified approved hours',adjustmentCents:250,adjustmentReason:'Approved travel supplement'};
 const quote=await req(f.admin.token,url,body);expect(quote.status).toBe(200);expect(quote.body.totalCents).toBe(8500);expect(quote.body.netSalary).toBe('185.00');
 expect((await req(f.alice.token,url,body)).status).toBeGreaterThanOrEqual(400);
 expect((await req(f.admin.token,url,{...body,preview:false,quote:quote.body.quote})).status).toBe(201);
 expect((await req(f.admin.token,`/timesheets/${f.sheet.id}/reopen`,{version:1,reason:'Try changing reserved time'})).status).toBe(409);
 const edit=await req(f.admin.token,`/payroll/${f.payroll.id}`,{basicSalary:'120',allowances:{},deductions:{}},'PATCH');expect(edit.status).toBe(200);expect(edit.body.netSalary).toBe('205.00');
 expect((await req(f.admin.token,`/payroll/${f.payroll.id}/mark-paid`,{reference:'BANK-TEST-001'})).status).toBe(200);const [sheet]=await ctx.db.select().from(schema.workforceTimesheets);expect(sheet.status).toBe('payroll_locked');expect(sheet.payrollId).toBe(f.payroll.id);
 expect((await req(f.admin.token,`/payroll/${f.payroll.id}/time-release`,{reason:'Attempt paid release'})).status).toBe(409);
});
test('pending time import can be released and recalculated without losing history',async()=>{
 const f=await timeFixture(),url=`/payroll/${f.payroll.id}/time-import`,body={preview:true,reason:'Verify complete time'};const q=await req(f.admin.token,url,body);expect((await req(f.admin.token,url,{...body,preview:false,quote:q.body.quote})).status).toBe(201);
 expect((await req(f.admin.token,url,body)).status).toBe(409);expect((await req(f.admin.token,`/payroll/${f.payroll.id}/time-release`,{reason:'Recheck reported overtime'})).status).toBe(200);
 const history=await req(f.admin.token,url);expect(history.body[0].released_at).toBeTruthy();const next=await req(f.admin.token,url,body);expect(next.status).toBe(200);expect((await req(f.admin.token,url,{...body,preview:false,quote:next.body.quote})).status).toBe(201);
 expect((await req(f.admin.token,url)).body).toHaveLength(2);
});
test('roster reconciliation compares real clock evidence without inventing payable time',async()=>{
 const f=await timeFixture(),from=f.shift.startAt.toISOString().slice(0,10),url=`/attendance/roster-reconciliation?from=${from}&to=${from}`;
 expect((await req(f.admin.token,url)).body[0].issue).toBe('No overlapping clock record');
 await ctx.db.insert(schema.attendance).values({employeeId:f.employee.id,date:from,status:'present',checkIn:f.shift.startAt,checkOut:f.shift.endAt,totalBreakMinutes:30});
 expect((await req(f.admin.token,url)).body[0].issue).toBe('Clock and timesheet match');expect((await req(f.bob.token,url)).body).toEqual([]);
});
test('audit failure rolls back imported earnings and leaves time unreserved',async()=>{
 const f=await timeFixture(),url=`/payroll/${f.payroll.id}/time-import`,body={preview:true,reason:'Verified approved time'},q=await req(f.admin.token,url,body);
 await pg.exec("CREATE FUNCTION deny_batch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER deny_batch_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION deny_batch_audit();");
 try{expect((await req(f.admin.token,url,{...body,preview:false,quote:q.body.quote})).status).toBe(500);expect((await pg.query('select * from payroll_time_entries')).rows).toHaveLength(0);const [p]=await ctx.db.select().from(schema.payroll);expect(p.netSalary).toBe('100.00');}finally{await pg.exec('DROP TRIGGER deny_batch_audit ON activity_logs; DROP FUNCTION deny_batch_audit();');}
});
test('rate calculation keeps integer cents and configured rounding at the final earning amount',()=>{
 expect(timeEarnings(450,payRules as any)).toMatchObject({regularMinutes:360,overtimeMinutes:90,amountCents:8250});expect(timeEarnings(1,{...payRules,roundingMode:'down'} as any).amountCents).toBe(16);expect(timeEarnings(1,{...payRules,roundingMode:'up'} as any).amountCents).toBe(17);
});

test('staff with legacy self-update access cannot bypass independent attendance correction',async()=>{
 const f=await setup();await ctx.db.update(schema.users).set({role:'temporary_staff'}).where(eq(schema.users.id,f.alice.id));const refreshed=(await authService.login('alice','TestingPass123!')).accessToken;
 expect((await req(refreshed,'/attendance',{employeeId:f.employee.id,date:at().slice(0,10),status:'present',checkIn:at(),checkOut:at(-2,16)})).status).toBe(403);
});
test('accrual proration uses employment dates and audit failure rolls back leave and attendance decisions',async()=>{
 const f=await setup(),year=new Date().getUTCFullYear()-1;await ctx.db.update(schema.employees).set({joiningDate:`${year}-01-16`}).where(eq(schema.employees.id,f.employee.id));await policy(f,'leave',{...leaveRules,monthlyDays:3.1});const month=await postRun(f,{kind:'accrual',month:1});expect(month.posted.body.days).toBe(1.6);
 const record=await req(f.admin.token,'/attendance',{employeeId:f.employee.id,date:at().slice(0,10),status:'present',checkIn:at(),checkOut:at(-2,16)});const c=await req(f.alice.token,`/attendance/records/${record.body.id}/corrections`,{version:1,reason:'Correct end of shift',proposed:{checkIn:at(),checkOut:at(-2,17),totalBreakMinutes:0}});
 const run={employeeId:f.employee.id,leaveType:'Annual',year,month:2,kind:'accrual',expectedVersion:month.posted.body.entry.id,reason:'Accrual posting evidence',preview:true};const quote=await req(f.admin.token,'/leave/ledger-run',run);expect(quote.status).toBe(200);
 await pg.exec("CREATE FUNCTION deny_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER deny_decision_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION deny_decision_audit();");
 try{
  expect((await req(f.admin.token,'/leave/ledger-run',{...run,preview:false,expectedQuote:quote.body.quote,expectedPolicyId:quote.body.basis.policy.id})).status).toBe(500);
  expect((await ctx.db.select().from(schema.leaveLedger))).toHaveLength(1);
  expect((await req(f.admin.token,`/attendance/corrections/${c.body.id}/decide`,{decision:'approved',reason:'Verified final handover'})).status).toBe(500);
  const [row]=await ctx.db.select().from(schema.attendance);expect(row.version).toBe(1);expect((await pg.query('select status from attendance_corrections')).rows[0].status).toBe('pending');
 }finally{await pg.exec('DROP TRIGGER deny_decision_audit ON activity_logs; DROP FUNCTION deny_decision_audit();');}
});
