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
import reviewRouter from '../server/routes/assignmentReviews';
import overviewRouter from '../server/routes/teamOverview';
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
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/timesheets',router);app.use('/workforce',workforce);app.use('/reviews',reviewRouter);app.use('/overview',overviewRouter);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE workforce_sites,users,employees RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pg.close();});

const ratings=()=>({punctuality:4,service:3,teamwork:5,roleSkill:null,evidence:{punctuality:'Arrived at the agreed start and completed handover.',service:'Explained the activity clearly to the guests.',teamwork:'Helped a colleague complete the closing checklist.',roleSkill:'Not observed directly during this assignment.'},roleExpectation:'Host the activity and complete its opening and closing checks.',summary:'A reliable shift with clear guest communication.',improvementActions:''});
async function fixture(){const f=await setup();const time=await approve(f);const [reviewGrant]=await context.db.insert(schema.workforceGrants).values({teamId:f.team.id,userId:f.lead.id,permission:'review_performance',startAt:new Date(instant(-10)),endAt:new Date(instant(10))}).returning();return {...f,time,reviewGrant};}
async function publish(f:any,values=ratings(),author=f.lead){const r=await request(author.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:values});expect(r.status).toBe(201);return r.body;}
async function overview(f:any,user=f.lead){return request(user.token,`/overview?teamId=${f.team.id}`);}
const dispute=(version:number)=>({version,kind:'dispute',message:'The approved arrival change was not reflected in the rating.'});

test('reviews require authentication, explicit grants and verified completed work',async()=>{
  expect((await request('','/reviews/')).status).toBe(401);const f=await setup();
  expect((await request(f.lead.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:ratings()})).status).toBe(404);
  await context.db.insert(schema.workforceGrants).values({teamId:f.team.id,userId:f.lead.id,permission:'review_performance',startAt:new Date(instant(-10)),endAt:new Date(instant(10))});
  expect((await request(f.lead.token,'/reviews/assignments')).body.items).toEqual([]);
  const row=await draft(f);expect((await request(f.lead.token,`/reviews/assignments/${f.assignment.id}`)).status).toBe(404);
  await request(f.alice.token,`/timesheets/${row.id}/submit`,{version:1});await request(f.lead.token,`/timesheets/${row.id}/review`,approval(2));
  expect((await request(f.lead.token,'/reviews/assignments')).body.items).toHaveLength(1);await publish(f);
});
test('separate performance grants do not grant time approval or scheduling, and date/revocation checks apply',async()=>{
  const f=await fixture();await context.db.delete(schema.workforceGrants).where(eq(schema.workforceGrants.id,f.grant.id));
  expect((await overview(f)).body.time).toBeNull();expect((await request(f.lead.token,`/workforce/teams/${f.team.id}/shifts`,{role:'Host',headcount:1,startAt:instant(2),endAt:instant(2,16)})).status).toBe(404);
  for(const change of [{permission:'schedule'},{permission:'view'},{permission:'review_time'},{permission:'review_performance',startAt:new Date(instant(1))},{startAt:new Date(instant(-1))},{startAt:new Date(instant(-10)),endAt:new Date(instant(-1))},{endAt:new Date(instant(10)),revokedAt:new Date()}]){
    await context.db.update(schema.workforceGrants).set(change).where(eq(schema.workforceGrants.id,f.reviewGrant.id));expect((await request(f.lead.token,`/reviews/assignments/${f.assignment.id}`)).status).toBe(404);
  }
});
test('only one review is published per assignment under competing requests',async()=>{
  const f=await fixture(),payload={assignmentId:f.assignment.id,confirmed:true,ratings:ratings()};const results=await Promise.all([request(f.lead.token,'/reviews/',payload),request(f.admin.token,'/reviews/',payload)]);
  expect(results.map(r=>r.status).sort()).toEqual([201,404]);expect((await pg.query('select id from assignment_review_history')).rows).toHaveLength(1);
});
test('evidence, rating bounds, improvement actions and reviewer confirmation are mandatory',async()=>{
  const f=await fixture();for(const value of [{...ratings(),punctuality:0},{...ratings(),service:6},{...ratings(),punctuality:1},{...ratings(),evidence:{...ratings().evidence,service:'Good'}},{...ratings(),punctuality:null,service:null,teamwork:null},{...ratings(),roleExpectation:'Host'}])expect((await request(f.lead.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:value})).status).toBe(400);
  expect((await request(f.lead.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:false,ratings:ratings()})).status).toBe(400);
  expect((await request(f.lead.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:ratings(),authorId:f.admin.id})).status).toBe(400);
  await publish(f,{...ratings(),punctuality:2,improvementActions:'Review the agreed start-time process with the employee.'});
});
test('self review is denied even for HR administrators with differing account and employee IDs',async()=>{
  const f=await fixture();expect(f.a.id).not.toBe(f.alice.id);await context.db.update(schema.users).set({role:'super_admin'}).where(eq(schema.users.id,f.alice.id));
  expect((await request(f.alice.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:ratings()})).status).toBe(404);
});
test('review lists, detail, history and counts exclude unrelated employees, leads and finance',async()=>{
  const f=await fixture(),row=await publish(f);
  for(const user of [f.bob,f.finance,f.auditor]){expect((await request(user.token,`/reviews/${row.id}`)).status).toBe(404);expect((await request(user.token,'/reviews/?view=team')).body.total).toBe(0);}
  for(const user of [f.alice,f.lead,f.admin])expect((await request(user.token,`/reviews/${row.id}`)).status).toBe(200);
  const mine=(await request(f.alice.token,'/reviews/')).body;expect(mine.total).toBe(1);expect(JSON.stringify(mine)).not.toMatch(/private-|iban|salary|email|ownerUserId|password/i);
  await context.db.update(schema.workforceGrants).set({revokedAt:new Date()}).where(eq(schema.workforceGrants.id,f.reviewGrant.id));expect((await request(f.lead.token,`/reviews/${row.id}`)).status).toBe(404);
  expect((await request(f.lead.token,'/reviews/?view=disputes')).status).toBe(403);
});
test('employee acknowledgement and later dispute are versioned; others cannot respond',async()=>{
  const f=await fixture(),row=await publish(f);expect((await request(f.lead.token,`/reviews/${row.id}/respond`,{version:1,kind:'acknowledge',message:''})).status).toBe(403);
  const ack=await request(f.alice.token,`/reviews/${row.id}/respond`,{version:1,kind:'acknowledge',message:''});expect(ack.status).toBe(200);
  expect((await request(f.alice.token,`/reviews/${row.id}/respond`,{version:2,kind:'comment',message:'I have further feedback about this review.'})).status).toBe(403);
  expect((await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(2))).status).toBe(200);
  const detail=(await request(f.alice.token,`/reviews/${row.id}`)).body;expect(detail.review.status).toBe('disputed');expect(detail.history.map((h:any)=>h.version)).toEqual([1,2,3]);expect(detail.capabilities.respond).toBe(false);
});
test('employee comments do not imply acknowledgement and can be escalated to a dispute',async()=>{
  const f=await fixture(),row=await publish(f);expect((await request(f.alice.token,`/reviews/${row.id}/respond`,{version:1,kind:'comment',message:'Please record that I helped with closing too.'})).status).toBe(200);
  expect((await request(f.alice.token,`/reviews/${row.id}`)).body.review.responseKind).toBe('comment');expect((await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(2))).status).toBe(200);
});
test('HR dispute decisions require an independent reviewer and preserve original scores and responses',async()=>{
  const f=await fixture(),row=await publish(f,ratings(),f.admin);await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(1));
  expect((await request(f.admin.token,`/reviews/${row.id}/resolve`,{version:2,outcome:'uphold',reason:'Reviewed the supplied evidence in detail.'})).status).toBe(403);
  await context.db.update(schema.users).set({role:'hr_director'}).where(eq(schema.users.id,f.alice.id));expect((await request(f.alice.token,`/reviews/${row.id}/resolve`,{version:2,outcome:'uphold',reason:'I approve my own challenge now.'})).status).toBe(403);
  const secondHR=await account('otherHR','hr_director');expect((await request(secondHR.token,'/reviews/?view=disputes')).body.total).toBe(1);
  const changed={...ratings(),punctuality:5,summary:'The agreed arrival change has been taken into account.'};
  expect((await request(secondHR.token,`/reviews/${row.id}/resolve`,{version:2,outcome:'amend',reason:'Verified the approved change with the shift records.',ratings:changed})).status).toBe(200);
  const detail=(await request(f.alice.token,`/reviews/${row.id}`)).body;expect(detail.review.punctuality).toBe(5);expect(detail.history[0].snapshot.punctuality).toBe(4);expect(detail.history[1].snapshot.employeeResponse).toMatch(/arrival change/);expect(detail.capabilities.respond).toBe(true);
  expect((await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(3))).status).toBe(200);
});
test('withdrawal is terminal and published reviews have no direct edit/delete endpoints',async()=>{
  const f=await fixture(),row=await publish(f);expect((await request(f.lead.token,`/reviews/${row.id}/resolve`,{version:1,outcome:'withdraw',reason:'Withdraw my own review without HR.'})).status).toBe(403);
  expect((await request(f.admin.token,`/reviews/${row.id}/resolve`,{version:1,outcome:'withdraw',reason:'Evidence was insufficient to support this review.'})).status).toBe(200);
  expect((await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(2))).status).toBe(403);
  expect((await request(f.admin.token,`/reviews/${row.id}/resolve`,{version:2,outcome:'amend',reason:'Attempt to edit a withdrawn review.',ratings:ratings()})).status).toBe(403);
  expect((await fetch(base+`/reviews/${row.id}`,{method:'DELETE',headers:{Authorization:'Bearer '+f.admin.token}})).status).toBe(404);
  expect((await request(f.lead.token,'/reviews/assignments')).body.items).toHaveLength(0);
});
test('competing employee responses write one decision and one history version',async()=>{
  const f=await fixture(),row=await publish(f);const results=await Promise.all([request(f.alice.token,`/reviews/${row.id}/respond`,dispute(1)),request(f.alice.token,`/reviews/${row.id}/respond`,{version:1,kind:'acknowledge',message:''})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await pg.query('select id from assignment_review_history')).rows).toHaveLength(2);
});
test('team overview scopes missing reviews and time queues separately from roster access',async()=>{
  const f=await fixture();const second=await assign(f,-1),draftRow=await draft(f,second.id,actual(-1));await request(f.alice.token,`/timesheets/${draftRow.id}/submit`,{version:1});
  const initial=await overview(f);expect(initial.status).toBe(200);expect(initial.body.reviews.missing).toBe(1);expect(initial.body.time.pending).toBe(1);expect(initial.body.reviews.missingItems[0].assignmentId).toBe(f.assignment.id);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.reviewGrant.id));expect((await overview(f)).body.reviews).toBeNull();expect((await overview(f)).body.time.pending).toBe(1);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grant.id));expect((await overview(f)).body.time).toBeNull();expect((await overview(f,f.bob)).status).toBe(404);
});
test('staffing gaps count accepted places per visible shift and exclude expired offers and unrelated teams',async()=>{
  const f=await fixture();const next=await assign(f,2);await context.db.update(schema.workforceShifts).set({headcount:3}).where(eq(schema.workforceShifts.id,next.shiftId));await context.db.insert(schema.workforceAssignments).values({shiftId:next.shiftId,employeeId:f.b.id,status:'offered',createdBy:f.admin.id});
  const [outside]=await context.db.insert(schema.workforceTeams).values({name:'Other operation',kind:'event',siteId:1}).returning();await context.db.insert(schema.workforceShifts).values({teamId:outside.id,role:'Private role',headcount:200,startAt:new Date(instant(2)),endAt:new Date(instant(2,16)),createdBy:f.admin.id});
  const result=await overview(f);expect(result.status).toBe(200);expect(result.body.staffing).toMatchObject({shifts:1,required:3,accepted:1,unfilled:2,pendingOffers:1});expect(result.body.staffing.gaps).toHaveLength(1);expect(JSON.stringify(result.body)).not.toMatch(/Private role|private-bank/);
  expect((await request(f.lead.token,`/overview?teamId=${outside.id}`)).status).toBe(404);
});
test('trends show criterion counts and exclude disputed, withdrawn and no-longer-verified reviews',async()=>{
  const f=await fixture();let result=await overview(f);expect(result.body.reviews.trend).toEqual([]);const row=await publish(f,{...ratings(),service:null});
  result=await overview(f);expect(result.body.reviews.included).toBe(1);expect(result.body.reviews.missing).toBe(0);expect(result.body.reviews.trend[0]).toMatchObject({punctuality:4,punctualityCount:1,service:null,serviceCount:0,teamwork:5,teamworkCount:1});
  await request(f.alice.token,`/reviews/${row.id}/respond`,dispute(1));result=await overview(f);expect(result.body.reviews.disputed).toBe(1);expect(result.body.reviews.included).toBe(0);expect(result.body.reviews.trend).toEqual([]);
  await request(f.admin.token,`/reviews/${row.id}/resolve`,{version:2,outcome:'uphold',reason:'Verified the examples against the agreed expectations.'});expect((await overview(f)).body.reviews.included).toBe(1);
  await request(f.admin.token,`/timesheets/${f.time.id}/reopen`,{version:f.time.version,reason:'Recheck time evidence from handover'});result=await overview(f);expect(result.body.reviews.unverified).toBe(1);expect(result.body.reviews.trend).toEqual([]);
  await request(f.admin.token,`/reviews/${row.id}/resolve`,{version:3,outcome:'withdraw',reason:'Withdraw while the supporting record is uncertain.'});expect((await overview(f)).body.reviews.withdrawn).toBe(1);
});
test('history failures roll back publication and sessions/date windows fail closed',async()=>{
  const f=await fixture();expect((await request(f.lead.token,`/overview?teamId=${f.team.id}&from=${instant(-100)}&to=${instant()}`)).status).toBe(400);
  await pg.exec("CREATE FUNCTION fail_review_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END $$; CREATE TRIGGER fail_review_history BEFORE INSERT ON assignment_review_history FOR EACH ROW EXECUTE FUNCTION fail_review_history();");
  try{expect((await request(f.lead.token,'/reviews/',{assignmentId:f.assignment.id,confirmed:true,ratings:ratings()})).status).toBe(500);expect((await pg.query('select id from assignment_reviews')).rows).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER fail_review_history ON assignment_review_history; DROP FUNCTION fail_review_history();');}
  await context.db.update(schema.users).set({isActive:false}).where(eq(schema.users.id,f.lead.id));expect((await request(f.lead.token,'/reviews/config')).status).toBe(401);
});

test('unified approval lanes show only current actionable records under each separate grant',async()=>{
 const f=await setup(),row=await submit(f),url=`/workforce/teams/${f.team.id}/approvals`;
 const first=await request(f.lead.token,url);expect(first.status).toBe(200);expect(first.body.time.map((t:any)=>t.id)).toEqual([row.id]);expect(first.body.performance).toEqual([]);
 await request(f.lead.token,`/timesheets/${row.id}/review`,approval(row.version));
 expect((await request(f.lead.token,url)).body.time).toEqual([]);expect((await request(f.lead.token,url)).body.performance).toEqual([]);
 const [grant]=await context.db.insert(schema.workforceGrants).values({teamId:f.team.id,userId:f.lead.id,permission:'review_performance',startAt:new Date(instant(-10)),endAt:new Date(instant(10))}).returning();
 const reviews=await request(f.lead.token,url);expect(reviews.status).toBe(200);expect(reviews.body.performance.map((r:any)=>r.id)).toEqual([f.assignment.id]);expect(JSON.stringify(reviews.body)).not.toMatch(/private-phone|private-bank|Completed hosting/);
 await context.db.update(schema.workforceGrants).set({startAt:new Date(instant(-1))}).where(eq(schema.workforceGrants.id,grant.id));
 expect((await request(f.lead.token,url)).body.performance).toEqual([]);
 await context.db.update(schema.workforceGrants).set({startAt:new Date(instant(-10))}).where(eq(schema.workforceGrants.id,grant.id));
 await publish(f);expect((await request(f.lead.token,url)).body.performance).toEqual([]);
});
