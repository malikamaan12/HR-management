import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import {users,employees,calculationRuleVersions} from '../shared/schema';
import {calculationRulesSchema,defaultCalculationRules,calculateTime,calculatePolicyPayroll,calculateLeave,ruleDate,type CalculationSnapshot} from '../shared/calculation-rules';
import {defaultCompanySettings} from '../shared/settings';
const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import settingsRouter from '../server/routes/settings';
import leaveRouter from '../server/routes/leaveRequests';
import payrollRouter from '../server/routes/payroll';
import attendanceRouter from '../server/routes/attendance';
import {clockAttendance} from '../server/services/attendance';
import {calculationSnapshot} from '../server/services/calculation-rules';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const password='CalculationTest8!',fresh=()=>structuredClone(defaultCalculationRules),today=()=>ruleDate();
const addDays=(date:string,days:number)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
async function account(role='super_admin',name=role){const [u]=await context.db.insert(users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,password)).accessToken};}
async function employee(index:number,userId?:number,workSchedule='management_office'){return (await context.db.insert(employees).values({userId,employeeId:'RULE-'+index,firstName:'Synthetic',lastName:String(index),gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'test-'+index,primaryMobile:'test',residentialAddress:'test',emergencyContactName:'test',emergencyContactNumber:'test',type:'permanent',department:'Operations',position:'Manager',location:'Test',joiningDate:'2020-01-01',workSchedule}).returning())[0];}
async function request(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};}
async function publish(token:string,rules=fresh(),extra:Record<string,unknown>={}){return request(token,'/settings/calculation-rules',{scope:'management_office',rules,expectedVersion:0,effectiveFrom:today(),reason:'Synthetic approved rule change',...extra});}
beforeAll(async()=>{
 process.env.JWT_SECRET='calculation-rule-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='calculation-rule-refresh-secret-32-characters';process.env.APP_TIMEZONE='Asia/Qatar';
 pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/settings',settingsRouter);app.use('/leaves',leaveRouter);app.use('/payroll',payrollRouter);app.use('/attendance',attendanceRouter);
 server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE users,employees,app_settings RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pg.close();});

test('bounded methods reject unknown formula code, invalid increments and duplicate or invalid holidays',()=>{
 for(const patch of [{roundingMinutes:0},{roundingMinutes:7},{roundingMode:'eval'},{lateGraceMinutes:-1},{breakTreatment:'ignore'}])expect(calculationRulesSchema.safeParse({...fresh(),attendance:{...fresh().attendance,...patch}}).success).toBe(false);
 expect(calculationRulesSchema.safeParse({...fresh(),formula:'process.exit()'}).success).toBe(false);
 for(const holidays of [[{date:'2026-02-30',name:'Bad'}],[{date:'2026-01-01',name:'A'},{date:'2026-01-01',name:'B'}]])expect(calculationRulesSchema.safeParse({...fresh(),leave:{...fresh().leave,holidays}}).success).toBe(false);
 expect(calculateTime(479,30,{...fresh().attendance,roundingMinutes:15}).calculatedMinutes).toBe(450);
 expect(calculateTime(479,30,{...fresh().attendance,breakTreatment:'paid',roundingMinutes:15,roundingMode:'down'}).calculatedMinutes).toBe(465);
 expect(()=>calculateTime(60,61,fresh().attendance)).toThrow();
 expect(calculatePolicyPayroll('100.03',{}, {},{roundingCents:5,roundingMode:'nearest'})).toMatchObject({netSalary:'100.05',roundingAdjustmentCents:2});
});

test('only existing admin and super admin roles can read, preview or publish policies',async()=>{
 expect((await request('','/settings/calculation-rules')).status).toBe(401);
 for(const role of ['employee','hr','manager','payroll_specialist']){const u=await account(role);expect((await request(u.token,'/settings/calculation-rules')).status).toBe(403);expect((await publish(u.token)).status).toBe(403);expect((await request(u.token,'/settings/calculation-rules/preview',{})).status).toBe(403);}
 const admin=await account('admin'),superAdmin=await account();
 expect((await request(admin.token,'/settings/calculation-rules?scope=management_office')).body.active.version).toBe(0);
 const first=await publish(admin.token);expect(first.status).toBe(201);
 expect((await publish(superAdmin.token,fresh(),{expectedVersion:first.body.id})).status).toBe(201);
 expect((await request(superAdmin.token,'/settings/calculation-rules?scope=default')).body.active.version).toBe(0);
});

test('effective dates, same-day precedence and stale editor conflicts protect publication',async()=>{
 const u=await account();const rules=fresh();rules.attendance.breakTreatment='paid';const future=addDays(today(),30);
 const first=await publish(u.token,rules,{effectiveFrom:future});expect(first.status).toBe(201);
 expect((await calculationSnapshot({workSchedule:'management_office'},today())).version).toBe(0);
 expect((await calculationSnapshot({workSchedule:'management_office'},future)).version).toBe(first.body.id);
 expect((await publish(u.token)).status).toBe(409);
 expect((await publish(u.token,fresh(),{expectedVersion:first.body.id,effectiveFrom:addDays(today(),-1)})).status).toBe(400);
 const results=await Promise.all([publish(u.token,fresh(),{expectedVersion:first.body.id}),publish(u.token,rules,{expectedVersion:first.body.id})]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
 const active=await calculationSnapshot({workSchedule:'management_office'},today());expect(active.version).toBe(results.find(r=>r.status===201)!.body.id);
 expect((await calculationSnapshot({workSchedule:'management_office'},future)).version).toBe(first.body.id);
 const replacement=await publish(u.token,fresh(),{expectedVersion:active.version,effectiveFrom:future});expect(replacement.status).toBe(201);expect((await calculationSnapshot({workSchedule:'management_office'},future)).version).toBe(replacement.body.id);
 await expect(pg.exec('UPDATE calculation_rule_versions SET reason=\'tampered\'')).rejects.toThrow(/immutable/);
 await expect(pg.exec('DELETE FROM calculation_rule_versions')).rejects.toThrow(/immutable/);
});

test('audit failure rolls back the policy version and preview has no write side effects',async()=>{
 const u=await account();const rules=fresh();rules.attendance.breakTreatment='paid';rules.payroll={roundingCents:100,roundingMode:'up'};
 const preview=await request(u.token,'/settings/calculation-rules/preview',{scope:'management_office',rules,date:'2026-09-13',leaveEnd:'2026-09-19',elapsedMinutes:480,breakMinutes:30,basicSalary:'100.01',allowances:{},deductions:{}});
 expect(preview.status).toBe(200);expect(preview.body.current.attendance.calculatedMinutes).toBe(450);expect(preview.body.proposed.attendance.calculatedMinutes).toBe(480);expect(preview.body.proposed.payroll.netSalary).toBe('101.00');
 expect((await context.db.select().from(calculationRuleVersions))).toHaveLength(0);
 await pg.exec("ALTER TABLE activity_logs ADD CONSTRAINT rule_audit_test CHECK(entity_type <> 'calculation_rules')");
 try{expect((await publish(u.token)).status).toBe(500);expect((await context.db.select().from(calculationRuleVersions))).toHaveLength(0);}finally{await pg.exec('ALTER TABLE activity_logs DROP CONSTRAINT rule_audit_test');}
});

test('leave uses the scoped authoritative policy, holidays and saved totals after rule changes',async()=>{
 const u=await account(),owner=await account('employee'),person=await employee(1,owner.id),other=await employee(2,undefined,'shift_based');
 const start=addDays(today(),7),end=addDays(start,6),rules=fresh();rules.leave={countMethod:'calendar_days',maxCalendarDays:10,excludeHolidays:true,holidays:[{date:start,name:'Configured holiday'}]};
 const published=await publish(u.token,rules);expect(published.status).toBe(201);
 const quote=await request(owner.token,`/leaves/quote?employeeId=${person.id}&start=${start}&end=${end}`);expect(quote.body.totalDays).toBe(6);
 expect((await request(owner.token,`/leaves/quote?employeeId=${other.id}&start=${start}&end=${end}`)).status).toBe(403);
 const row=await request(owner.token,'/leaves',{employeeId:person.id,leaveType:'annual',startDate:start,endDate:end,reason:'Test leave duration',totalDays:999,calculationSnapshot:{version:999}});
 expect(row.status).toBe(201);expect(row.body.totalDays).toBe(6);expect(row.body.calculationSnapshot.version).toBe(published.body.id);
 expect((await request(owner.token,`/leaves/quote?employeeId=${person.id}&start=${start}&end=${addDays(start,10)}`)).status).toBe(400);
 const replacement=await publish(u.token,fresh(),{expectedVersion:published.body.id});expect(replacement.status).toBe(201);
 expect((await request(owner.token,`/leaves/${row.body.id}`)).body.totalDays).toBe(6);
 expect((await request(owner.token,`/leaves/quote?employeeId=${person.id}&start=${start}&end=${end}`)).body.totalDays).toBe(5);
});

test('clock-in pins rules through mid-shift changes and manual attendance calculates breaks on the server',async()=>{
 const admin=await account(),owner=await account('employee'),person=await employee(1,owner.id);
 let date=addDays(today(),7);while(new Date(date).getUTCDay()!==1)date=addDays(date,1);
 const time=(hhmm:string)=>new Date(`${date}T${hhmm}:00+03:00`),rules=fresh();rules.attendance={breakTreatment:'unpaid',roundingMinutes:15,roundingMode:'nearest',lateGraceMinutes:10};
 const version=await publish(admin.token,rules);const start=await clockAttendance(owner.id,'in',undefined,undefined,time('09:12'));expect(start.status).toBe('late');
 const changed=fresh();changed.attendance.breakTreatment='paid';const next=await publish(admin.token,changed,{expectedVersion:version.body.id});expect(next.status).toBe(201);
 await clockAttendance(owner.id,'break_start',undefined,undefined,time('12:00'));await clockAttendance(owner.id,'break_end',undefined,undefined,time('12:30'));
 const ended=await clockAttendance(owner.id,'out',undefined,undefined,time('17:04'));expect(ended.totalWorkHours).toBe(435);expect(ended.calculationSnapshot?.version).toBe(version.body.id);
 const manual=await request(admin.token,'/attendance',{employeeId:person.id,date:addDays(date,1),status:'present',checkIn:`${addDays(date,1)}T09:00:00+03:00`,checkOut:`${addDays(date,1)}T17:00:00+03:00`,totalBreakMinutes:30,totalWorkHours:999,calculationSnapshot:{version:999}});
 expect(manual.status).toBe(201);expect(manual.body.totalWorkHours).toBe(480);expect(manual.body.totalBreakMinutes).toBe(30);expect(manual.body.calculationSnapshot.version).toBe(next.body.id);
});

test('payroll uses its period policy and preserves it when later versions are published',async()=>{
 const u=await account(),person=await employee(1),second=await employee(2);
 const future=new Date(`${today()}T00:00:00Z`);future.setUTCMonth(future.getUTCMonth()+2,1);const date=future.toISOString().slice(0,10);
 const rules=fresh();rules.payroll={roundingCents:10,roundingMode:'up'};const version=await publish(u.token,rules,{effectiveFrom:date});
 const input={employeeId:person.id,year:future.getUTCFullYear(),month:future.getUTCMonth()+1,basicSalary:'1000.03',allowances:{},deductions:{}};
 const draft=await request(u.token,'/payroll',input);expect(draft.status).toBe(201);expect(draft.body.netSalary).toBe('1000.10');expect(draft.body.roundingAdjustmentCents).toBe(7);
 const changed=fresh();changed.payroll={roundingCents:100,roundingMode:'down'};expect((await publish(u.token,changed,{effectiveFrom:date,expectedVersion:version.body.id})).status).toBe(201);
 const edited=await request(u.token,`/payroll/${draft.body.id}`,{...input,basicSalary:'1000.04'},'PATCH');expect(edited.body.netSalary).toBe('1000.10');expect(edited.body.calculationSnapshot.version).toBe(version.body.id);
 expect((await request(u.token,'/payroll/preview',{...input,id:draft.body.id})).body.netSalary).toBe('1000.10');
 expect((await request(u.token,'/payroll',{...input,employeeId:second.id})).body.netSalary).toBe('1000.00');
});

test('calendar-day holidays are excluded once and working-day holidays do not double-subtract weekends',()=>{
 const snapshot:CalculationSnapshot={scope:'management_office',version:0,effectiveFrom:null,rules:fresh(),calendar:defaultCompanySettings};
 snapshot.rules.leave.excludeHolidays=true;snapshot.rules.leave.holidays=[{date:'2026-09-18',name:'Weekend holiday'},{date:'2026-09-17',name:'Working day holiday'}];
 expect(calculateLeave('2026-09-13','2026-09-19',snapshot).totalDays).toBe(4);
 snapshot.rules.leave.countMethod='calendar_days';expect(calculateLeave('2026-09-13','2026-09-19',snapshot).totalDays).toBe(5);
});
