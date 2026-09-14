import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import router from '../server/routes/timesheets';
import workforce from '../server/routes/workforce';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const password='TimesheetTestPass8!';
const instant=(day=-2,hour=8)=>{const d=new Date();d.setUTCDate(d.getUTCDate()+day);d.setUTCHours(hour,0,0,0);return d.toISOString();};
const actual=(day=-2,start=8,end=16)=>({actualStartAt:instant(day,start),actualEndAt:instant(day,end),breakMinutes:30,employeeNote:'Completed hosting and handover'});
async function request(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function account(name:string,role:schema.UserRole='temporary_staff'){
  const [user]=await context.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();
  return {...user,token:(await authService.login(name,password)).accessToken};
}
async function employee(userId:number,name:string){return (await context.db.insert(schema.employees).values({userId,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'private-'+name,primaryMobile:'private-phone',residentialAddress:'private-address',emergencyContactName:'Private',emergencyContactNumber:'private-number',type:'temporary',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01',ibanNumber:'private-bank'}).returning())[0];}
async function setup(){
  const admin=await account('admin','super_admin'),lead=await account('lead','event_manager'),alice=await account('alice'),bob=await account('bob'),finance=await account('finance','payroll_specialist'),auditor=await account('auditor','finance_audit');
  const a=await employee(alice.id,'Alice'),b=await employee(bob.id,'Bob');
  const [site]=await context.db.insert(schema.workforceSites).values({name:'Mall FEC',timezone:'Asia/Qatar'}).returning();
  const [team]=await context.db.insert(schema.workforceTeams).values({name:'Guest experience',kind:'mall_activation',siteId:site.id}).returning();
  const [grant]=await context.db.insert(schema.workforceGrants).values({teamId:team.id,userId:lead.id,permission:'review_time',startAt:new Date(instant(-10)),endAt:new Date(instant(10))}).returning();
  const f={admin,lead,alice,bob,finance,auditor,a,b,team,grant};const assignment=await assign(f);return {...f,assignment};
}
async function assign(f:any,day=-2,start=8,end=16,employeeId=f.a.id){
  const [shift]=await context.db.insert(schema.workforceShifts).values({teamId:f.team.id,role:'Activity host',headcount:1,startAt:new Date(instant(day,start)),endAt:new Date(instant(day,end)),breakMinutes:30,createdBy:f.admin.id}).returning();
  return (await context.db.insert(schema.workforceAssignments).values({shiftId:shift.id,employeeId,status:'accepted',createdBy:f.admin.id}).returning())[0];
}
async function draft(f:any,assignmentId=f.assignment.id,values=actual(),token=f.alice.token){const r=await request(token,'/timesheets/',{assignmentId,...values});expect(r.status).toBe(201);return r.body;}
async function submit(f:any){const row=await draft(f);const r=await request(f.alice.token,`/timesheets/${row.id}/submit`,{version:row.version});expect(r.status).toBe(200);return r.body;}
const approval=(version:number)=>({version,decision:'approved',payableMinutes:450,policyReference:'Operations agreed break policy',reason:'Hours checked against shift handover'});
async function approve(f:any){const row=await submit(f);const r=await request(f.lead.token,`/timesheets/${row.id}/review`,approval(row.version));expect(r.status).toBe(200);return r.body;}
async function paid(f:any,employeeId=f.a.id,status='processed'){return (await context.db.insert(schema.payroll).values({employeeId,month:8,year:2026,basicSalary:'100.00',netSalary:'100.00',allowances:{},deductions:{},status,wpsReference:'TEST-PAYROLL'}).returning())[0];}
beforeAll(async()=>{
  process.env.JWT_SECRET='test-timesheet-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-timesheet-refresh-secret-32-characters';pg=new PGlite();
  for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/timesheets',router);app.use('/workforce',workforce);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE workforce_sites,users,employees RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pg.close();});

test('authentication and explicit employee linking protect drafts and assignment ownership',async()=>{
  expect((await request('','/timesheets/')).status).toBe(401);const f=await setup();expect(f.a.id).not.toBe(f.alice.id);
  expect((await request(f.bob.token,'/timesheets/',{assignmentId:f.assignment.id,...actual()})).status).toBe(404);
  const row=await draft(f);for(const user of [f.bob,f.lead,f.admin,f.finance])expect((await request(user.token,`/timesheets/${row.id}`)).status).toBe(404);
  expect((await request(f.alice.token,`/timesheets/${row.id}`)).body.sheet.workedMinutes).toBe(450);
  expect((await request(f.alice.token,'/timesheets/assignments')).body.items).toEqual([]);
  expect((await request(f.alice.token,'/timesheets/',{assignmentId:f.assignment.id,...actual(),employeeId:f.b.id})).status).toBe(400);
});
test('completed accepted assignments only, exact minutes and actual overlap are validated',async()=>{
  const f=await setup();await context.db.update(schema.workforceAssignments).set({status:'offered'}).where(eq(schema.workforceAssignments.id,f.assignment.id));
  expect((await request(f.alice.token,'/timesheets/',{assignmentId:f.assignment.id,...actual()})).status).toBe(409);
  await context.db.update(schema.workforceAssignments).set({status:'accepted'}).where(eq(schema.workforceAssignments.id,f.assignment.id));
  for(const value of [{...actual(),breakMinutes:480},{...actual(),actualEndAt:instant(-2,7)},{...actual(),actualStartAt:instant(-3,7)},{...actual(),actualStartAt:instant(-2,8).replace(':00.000Z',':01.000Z')},{...actual(-2,17,18)}])expect((await request(f.alice.token,'/timesheets/',{assignmentId:f.assignment.id,...value})).status).toBe(400);
  const future=await assign(f,1);expect((await request(f.alice.token,'/timesheets/',{assignmentId:future.id,...actual(1)})).status).toBe(409);
  await context.db.update(schema.employees).set({status:'inactive',contractEndDate:instant(-1).slice(0,10)}).where(eq(schema.employees.id,f.a.id));await draft(f);
});
test('duplicate creation retains a single sheet and initial revision',async()=>{
  const f=await setup(),payload={assignmentId:f.assignment.id,...actual()};const results=await Promise.all([request(f.alice.token,'/timesheets/',payload),request(f.alice.token,'/timesheets/',payload)]);
  expect(results.map(r=>r.status).sort()).toEqual([201,409]);expect((await pg.query('select id from timesheet_revisions')).rows).toHaveLength(1);
});
test('review grants are separate from scheduling and cannot create shifts or approve outside dates',async()=>{
  const f=await setup(),row=await submit(f);
  expect((await request(f.lead.token,`/workforce/teams/${f.team.id}/shifts`,{role:'Host',headcount:1,startAt:instant(2),endAt:instant(2,16)})).status).toBe(404);
  for(const change of [{permission:'schedule'},{permission:'view'},{permission:'review_time',startAt:new Date(instant(-1))},{startAt:new Date(instant(-10)),endAt:new Date(instant(-1))},{endAt:new Date(instant(10)),revokedAt:new Date()}]){
    await context.db.update(schema.workforceGrants).set(change).where(eq(schema.workforceGrants.id,f.grant.id));
    expect((await request(f.lead.token,`/timesheets/${row.id}/review`,approval(row.version))).status).toBe(404);expect((await request(f.lead.token,'/timesheets/?view=review')).body.total).toBe(0);
  }
});
test('review queue is scoped, minimal and includes only submitted or previously reviewed time',async()=>{
  const f=await setup(),row=await submit(f);const result=await request(f.lead.token,'/timesheets/?view=review');expect(result.body.total).toBe(1);
  expect(JSON.stringify(result.body)).not.toMatch(/private-|qidNumber|iban|salary|password|email|ownerUserId/i);
  expect((await request(f.bob.token,'/timesheets/?view=review')).body.total).toBe(0);expect((await request(f.finance.token,'/timesheets/?view=payroll')).body.total).toBe(0);
  expect((await request(f.lead.token,`/timesheets/${row.id}`,{version:row.version,...actual()},'PATCH')).status).toBe(403);
  expect((await request(f.alice.token,`/timesheets/${row.id}`,{version:row.version,...actual()},'PATCH')).status).toBe(409);
  await context.db.update(schema.users).set({isActive:false}).where(eq(schema.users.id,f.lead.id));expect((await request(f.lead.token,`/timesheets/${row.id}`)).status).toBe(401);
});
test('even administrators cannot approve their own time',async()=>{
  const f=await setup();await context.db.update(schema.users).set({role:'super_admin'}).where(eq(schema.users.id,f.alice.id));const row=await submit(f);
  expect((await request(f.alice.token,`/timesheets/${row.id}/review`,approval(row.version))).status).toBe(403);expect((await request(f.alice.token,`/timesheets/${row.id}`)).body.capabilities.review).toBe(false);
});
test('return, correction and resubmission preserve each version and approval leaves actuals unchanged',async()=>{
  const f=await setup(),row=await submit(f);const returned=await request(f.lead.token,`/timesheets/${row.id}/review`,{version:row.version,decision:'returned',reason:'Please include the handover time'});expect(returned.status).toBe(200);
  const edited=await request(f.alice.token,`/timesheets/${row.id}`,{version:returned.body.version,...actual(-2,8,17)},'PATCH');expect(edited.status).toBe(200);
  const sent=await request(f.alice.token,`/timesheets/${row.id}/submit`,{version:edited.body.version});expect(sent.status).toBe(200);
  const approved=await request(f.lead.token,`/timesheets/${row.id}/review`,{...approval(sent.body.version),payableMinutes:540});expect(approved.status).toBe(200);
  const detail=(await request(f.alice.token,`/timesheets/${row.id}`)).body;expect(detail.sheet.workedMinutes).toBe(510);expect(detail.sheet.payableMinutes).toBe(540);expect(detail.history.map((h:any)=>h.version)).toEqual([1,2,3,4,5,6]);expect(detail.history[1].snapshot.actualEndAt).toBe(instant(-2,16));
});
test('approval requires policy, bounded payable minutes and a reason; competing decisions are versioned',async()=>{
  const f=await setup(),row=await submit(f);for(const body of [{...approval(row.version),policyReference:''},{...approval(row.version),reason:''},{...approval(row.version),payableMinutes:481}])expect((await request(f.lead.token,`/timesheets/${row.id}/review`,body)).status).toBe(400);
  const results=await Promise.all([request(f.lead.token,`/timesheets/${row.id}/review`,approval(row.version)),request(f.admin.token,`/timesheets/${row.id}/review`,{version:row.version,decision:'returned',reason:'Check actuals again'})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await pg.query('select id from timesheet_revisions')).rows).toHaveLength(3);
});
test('overlapping actual claims are serialized while adjacent reported times are allowed',async()=>{
  const f=await setup(),second=await assign(f,-2,16,20),a=await draft(f,f.assignment.id,actual(-2,8,17)),b=await draft(f,second.id,actual(-2,16,20));
  const results=await Promise.all([request(f.alice.token,`/timesheets/${a.id}/submit`,{version:1}),request(f.alice.token,`/timesheets/${b.id}/submit`,{version:1})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const blocked=results[0].status===409?a:b;
  const corrected=blocked.id===a.id?actual(-2,8,16):actual(-2,17,20);
  expect((await request(f.alice.token,`/timesheets/${blocked.id}`,{version:1,...corrected},'PATCH')).status).toBe(200);
  expect((await request(f.alice.token,`/timesheets/${blocked.id}/submit`,{version:2})).status).toBe(200);
});
test('approved correction requires another HR administrator and retains previous payable time',async()=>{
  const f=await setup(),row=await approve(f);
  expect((await request(f.lead.token,`/timesheets/${row.id}/reopen`,{version:row.version,reason:'Correct the handover'})).status).toBe(403);
  expect((await request(f.admin.token,`/timesheets/${row.id}/reopen`,{version:row.version,reason:'Correct the handover'})).status).toBe(200);
  const detail=(await request(f.alice.token,`/timesheets/${row.id}`)).body;expect(detail.sheet.payableMinutes).toBeNull();expect(detail.history[2].snapshot.payableMinutes).toBe(450);
  expect((await request(f.finance.token,`/timesheets/${row.id}`)).status).toBe(404);
});
test('payroll read scope hides draft history and read-only auditors cannot lock',async()=>{
  const f=await setup(),row=await approve(f);for(const user of [f.finance,f.auditor]){const result=await request(user.token,`/timesheets/${row.id}`);expect(result.status).toBe(200);expect(result.body.history).toEqual([]);}
  const pay=await paid(f);expect((await request(f.auditor.token,`/timesheets/${row.id}/payroll-lock`,{version:row.version,payrollId:pay.id,confirmed:true})).status).toBe(403);
  expect((await request(f.lead.token,`/timesheets/${row.id}/payroll-options`)).status).toBe(403);
});
test('payroll inclusion requires processed payroll for the same employee and locks all further changes',async()=>{
  const f=await setup(),row=await approve(f),pending=await paid(f,f.a.id,'pending'),wrong=await paid(f,f.b.id),pay=await paid(f);
  for(const id of [pending.id,wrong.id])expect((await request(f.finance.token,`/timesheets/${row.id}/payroll-lock`,{version:row.version,payrollId:id,confirmed:true})).status).toBe(400);
  expect((await request(f.finance.token,`/timesheets/${row.id}/payroll-lock`,{version:row.version,payrollId:pay.id,confirmed:false})).status).toBe(400);
  await context.db.update(schema.users).set({role:'super_admin'}).where(eq(schema.users.id,f.alice.id));expect((await request(f.alice.token,`/timesheets/${row.id}/payroll-lock`,{version:row.version,payrollId:pay.id,confirmed:true})).status).toBe(403);
  const locked=await request(f.finance.token,`/timesheets/${row.id}/payroll-lock`,{version:row.version,payrollId:pay.id,confirmed:true});expect(locked.status).toBe(200);
  expect((await request(f.alice.token,`/timesheets/${row.id}`,{version:locked.body.version,...actual()},'PATCH')).status).toBe(409);
  expect((await request(f.admin.token,`/timesheets/${row.id}/reopen`,{version:locked.body.version,reason:'Change paid time'})).status).toBe(409);
  const [unchanged]=await context.db.select().from(schema.payroll).where(eq(schema.payroll.id,pay.id));expect(unchanged.netSalary).toBe('100.00');expect((await request(f.alice.token,`/timesheets/${row.id}`)).body.sheet.payrollId).toBe(pay.id);
});
test('revision write failure rolls back the timesheet and date windows remain bounded',async()=>{
  const f=await setup();expect((await request(f.alice.token,`/timesheets/?from=${instant(-100)}&to=${instant()}`)).status).toBe(400);
  await pg.exec("CREATE FUNCTION fail_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END $$; CREATE TRIGGER fail_revision BEFORE INSERT ON timesheet_revisions FOR EACH ROW EXECUTE FUNCTION fail_revision();");
  try{expect((await request(f.alice.token,'/timesheets/',{assignmentId:f.assignment.id,...actual()})).status).toBe(500);expect((await pg.query('select id from workforce_timesheets')).rows).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER fail_revision ON timesheet_revisions; DROP FUNCTION fail_revision();');}
});
