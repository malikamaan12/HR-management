import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
import {siteTimeToIso} from '../shared/workforce';

const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import router from '../server/routes/workforce';
import leaveRouter from '../server/routes/leaveRequests';
import {authService} from '../server/services/auth';
import {DatabaseStorage} from '../server/storage';
let pg:PGlite,server:Server,base:string;
const password='WorkforceTestPass8!';
const instant=(days:number,hour=8)=>{const date=new Date();date.setUTCDate(date.getUTCDate()+days);date.setUTCHours(hour,0,0,0);return date.toISOString();};
const dates=(day=3)=>({startAt:instant(day,8),endAt:instant(day,16)});
async function request(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST') {
  const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function account(name:string,role:schema.UserRole='employee') {
  const [user]=await context.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();
  const auth=await authService.login(name,password);return {...user,token:auth.accessToken};
}
async function employee(userId:number,name:string,type:schema.Employee['type']='temporary') {
  const [row]=await context.db.insert(schema.employees).values({userId,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'private-'+name,
    primaryMobile:'private-phone',residentialAddress:'private-address',emergencyContactName:'Private',emergencyContactNumber:'private-number',type,department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01',ibanNumber:'private-bank'}).returning();
  return row;
}
async function setup(headcount=1) {
  const admin=await account('admin','super_admin'),lead=await account('lead','event_manager'),alice=await account('alice'),bob=await account('bob','temporary_staff');
  const a=await employee(alice.id,'Alice','permanent'),b=await employee(bob.id,'Bob','contract');
  const site=await request(admin.token,'/workforce/sites',{name:'Mall FEC',timezone:'Asia/Qatar'});expect(site.status).toBe(201);
  const team=await request(admin.token,'/workforce/teams',{name:'Guest experience',kind:'fec',siteId:site.body.id});expect(team.status).toBe(201);
  const teamId=team.body.id;
  for(const member of [a,b]) expect((await request(admin.token,`/workforce/teams/${teamId}/members`,{employeeId:member.id,startAt:instant(-1),endAt:instant(10)})).status).toBe(201);
  const grant=await request(admin.token,`/workforce/teams/${teamId}/grants`,{userId:lead.id,permission:'schedule',startAt:instant(-1),endAt:instant(10)});expect(grant.status).toBe(201);
  const shift=await request(lead.token,`/workforce/teams/${teamId}/shifts`,{role:'Activity host',headcount,breakMinutes:30,...dates()});expect(shift.status).toBe(201);
  return {admin,lead,alice,bob,a,b,teamId,shiftId:shift.body.id,grantId:grant.body.id};
}
beforeAll(async()=>{
  process.env.JWT_SECRET='test-workforce-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-workforce-refresh-secret-32-characters';
  pg=new PGlite();for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/workforce',router);app.use('/leave',leaveRouter);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE workforce_sites, users, employees, skills RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pg.close();});

test('site time conversion preserves Qatar overnight dates and rejects DST gaps and folds',()=>{
  expect(siteTimeToIso('2026-10-01T23:00','Asia/Qatar')).toBe('2026-10-01T20:00:00.000Z');
  expect(siteTimeToIso('2026-10-02T04:00','Asia/Qatar')).toBe('2026-10-02T01:00:00.000Z');
  expect(()=>siteTimeToIso('2026-03-08T02:30','America/New_York')).toThrow(/skipped|repeated/);
  expect(()=>siteTimeToIso('2026-11-01T01:30','America/New_York')).toThrow(/skipped|repeated/);
  expect(()=>siteTimeToIso('2026-02-30T10:00','Asia/Qatar')).toThrow(/valid/);
});

test('required skills must cover the whole shift and are rechecked when accepting an offer',async()=>{
  const f=await setup();
  const [skill]=await context.db.insert(schema.skills).values({name:'First aid'}).returning();
  await context.db.update(schema.workforceShifts).set({requiredSkills:[skill.id]}).where(eq(schema.workforceShifts.id,f.shiftId));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(409);
  const [qualification]=await context.db.insert(schema.employeeSkills).values({employeeId:f.a.id,skillId:skill.id,proficiencyLevel:3,certificationExpiry:new Date(instant(3,12))}).returning();
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(409);
  await context.db.update(schema.employeeSkills).set({certificationExpiry:new Date(instant(4))}).where(eq(schema.employeeSkills.id,qualification.id));
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id}); expect(offer.status).toBe(201);
  await context.db.update(schema.employeeSkills).set({certificationExpiry:new Date(instant(3,12))}).where(eq(schema.employeeSkills.id,qualification.id));
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  await context.db.update(schema.employeeSkills).set({certificationExpiry:new Date(instant(3,16))}).where(eq(schema.employeeSkills.id,qualification.id));
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
});

test('skill catalogue is scoped to administrators and current scheduling leads',async()=>{
  const f=await setup();
  const input={name:' First aid ',category:'Safety'};
  expect((await request('', '/workforce/skills')).status).toBe(401);
  expect((await request(f.lead.token,'/workforce/skills',input)).status).toBe(403);
  const created=await request(f.admin.token,'/workforce/skills',input);expect(created.status).toBe(201);
  expect(created.body).toEqual({id:expect.any(Number),name:'First aid',category:'Safety'});
  expect((await request(f.admin.token,'/workforce/skills',{name:'FIRST AID'})).status).toBe(409);
  expect((await request(f.admin.token,'/workforce/skills',{name:'X'})).status).toBe(400);
  expect((await request(f.alice.token,`/workforce/skills?teamId=${f.teamId}`)).status).toBe(404);
  expect((await request(f.lead.token,`/workforce/skills?teamId=${f.teamId}`)).body).toEqual([created.body]);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/skills?teamId=${f.teamId}`)).status).toBe(404);
  await context.db.update(schema.workforceGrants).set({permission:'schedule',revokedAt:new Date()}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/skills?teamId=${f.teamId}`)).status).toBe(404);
});

test('shift creation validates skill references and exposes names only for visible assignments',async()=>{
  const f=await setup();
  const skill=(await request(f.admin.token,'/workforce/skills',{name:'First aid'})).body;
  const input={role:'Safety host',headcount:1,...dates(4),requiredSkills:[skill.id]};
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{...input,requiredSkills:[99999]})).status).toBe(400);
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{...input,requiredSkills:[skill.id,skill.id]})).status).toBe(400);
  const shift=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,input);expect(shift.status).toBe(201);
  expect(shift.body.requiredSkills).toEqual([skill.id]);
  const roster=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`);expect(roster.body.skills).toEqual([skill]);
  expect((await request(f.admin.token,`/workforce/employees/${f.a.id}/qualifications`,{skillId:skill.id,proficiencyLevel:3,certificationExpiry:null,expectedUpdatedAt:null})).status).toBe(200);
  expect((await request(f.lead.token,`/workforce/shifts/${shift.body.id}/offers`,{employeeId:f.a.id})).status).toBe(201);
  expect((await request(f.alice.token,'/workforce/my-assignments')).body[0].requiredSkills).toEqual([skill]);
  expect((await request(f.bob.token,'/workforce/my-assignments')).body).toEqual([]);
});

test('qualification changes require HR, reject stale writes, and control full-shift eligibility',async()=>{
  const f=await setup();const skill=(await request(f.admin.token,'/workforce/skills',{name:'First aid'})).body;
  const url=`/workforce/employees/${f.a.id}/qualifications`;
  const input={skillId:skill.id,proficiencyLevel:3,certificationExpiry:instant(3,12),expectedUpdatedAt:null};
  for(const user of [f.lead,f.alice]) {
    expect((await request(user.token,url)).status).toBe(403);
    expect((await request(user.token,url,input)).status).toBe(403);
  }
  expect((await request(f.admin.token,url,{...input,skillId:99999})).status).toBe(400);
  expect((await request(f.admin.token,url,{...input,proficiencyLevel:6})).status).toBe(400);
  expect((await request(f.admin.token,url,{...input,certified:true})).status).toBe(400);
  expect((await request(f.admin.token,url,input)).status).toBe(200);
  expect((await request(f.admin.token,url,input)).status).toBe(409);
  await context.db.update(schema.workforceShifts).set({requiredSkills:[skill.id]}).where(eq(schema.workforceShifts.id,f.shiftId));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(409);
  const record=(await request(f.admin.token,url)).body[0];
  expect(Object.keys(record).sort()).toEqual(['id','skillId','name','proficiencyLevel','certificationExpiry','updatedAt'].sort());
  const renewal={...input,certificationExpiry:instant(3,16),expectedUpdatedAt:record.updatedAt};
  expect((await request(f.admin.token,url,renewal)).status).toBe(200);
  expect((await request(f.admin.token,url,renewal)).status).toBe(409);
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});expect(offer.status).toBe(201);
  const current=(await request(f.admin.token,url)).body[0];
  expect((await request(f.admin.token,url,{...input,expectedUpdatedAt:current.updatedAt})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
});

test('qualification and catalogue writes roll back when the audit cannot be stored',async()=>{
  const f=await setup();const skill=(await request(f.admin.token,'/workforce/skills',{name:'First aid'})).body;
  await pg.exec("CREATE FUNCTION reject_workforce_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END; $$; CREATE TRIGGER reject_workforce_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_workforce_audit();");
  try {
    expect((await request(f.admin.token,`/workforce/employees/${f.a.id}/qualifications`,{skillId:skill.id,proficiencyLevel:3,certificationExpiry:null,expectedUpdatedAt:null})).status).toBe(500);
    expect((await request(f.admin.token,`/workforce/employees/${f.a.id}/qualifications`)).body).toEqual([]);
    expect((await request(f.admin.token,'/workforce/skills',{name:'Evacuation'})).status).toBe(500);
    expect((await request(f.admin.token,'/workforce/skills')).body).toEqual([skill]);
  } finally {await pg.exec('DROP TRIGGER reject_workforce_audit ON activity_logs; DROP FUNCTION reject_workforce_audit();');}
});
test('unauthenticated requests and self-granted permissions are denied',async()=>{
  expect((await request('','/workforce/teams')).status).toBe(401);
  const f=await setup();
  expect((await request(f.alice.token,`/workforce/teams/${f.teamId}/grants`,{userId:f.alice.id,permission:'schedule',startAt:instant(-1),endAt:instant(10)})).status).toBe(403);
  expect((await request(f.lead.token,'/workforce/directory?kind=employees&q=Al')).status).toBe(403);
  expect((await request(f.alice.token,'/workforce/teams')).body.teams).toEqual([]);
  expect((await request(f.alice.token,`/workforce/teams/${f.teamId}/dashboard`)).status).toBe(404);
});
test('lead dashboard exposes only scoped teams and a minimal roster',async()=>{
  const f=await setup();const other=await request(f.admin.token,'/workforce/teams',{name:'Unrelated team',kind:'event',siteId:1});
  expect((await request(f.lead.token,`/workforce/teams/${other.body.id}/dashboard`)).status).toBe(404);
  await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const response=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`);
  expect(response.status).toBe(200);expect(response.body.shifts).toHaveLength(1);expect(response.body.members).toHaveLength(2);
  expect(response.body.grants).toEqual([]);expect(JSON.stringify(response.body)).not.toMatch(/private-|qidNumber|iban|salary|password|email/i);
  expect((await request(f.lead.token,'/workforce/teams')).body.teams.map((t:any)=>t.id)).toEqual([f.teamId]);
});
test('future, expired, partial and revoked grants cannot authorize scheduling',async()=>{
  const f=await setup();
  await context.db.update(schema.workforceGrants).set({endAt:new Date(instant(3,12))}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`)).body.shifts).toEqual([]);
  const outside=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard?from=${instant(4)}&to=${instant(8)}`);
  expect(outside.body.members).toEqual([]);expect(outside.body.shifts).toEqual([]);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(404);
  await context.db.update(schema.workforceGrants).set({startAt:new Date(instant(1)),endAt:new Date(instant(10))}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,'/workforce/teams')).body.teams).toEqual([]);
  await context.db.update(schema.workforceGrants).set({startAt:new Date(instant(-10)),endAt:new Date(instant(-1))}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`)).status).toBe(404);
  await context.db.update(schema.workforceGrants).set({startAt:new Date(instant(-1)),endAt:new Date(instant(10))}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.admin.token,`/workforce/teams/${f.teamId}/grants/${f.grantId}/revoke`,{})).status).toBe(200);
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Host',headcount:1,...dates(4)})).status).toBe(404);
});
test('view-only leads can read but cannot create shifts, offer or cancel',async()=>{
  const f=await setup();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grantId));
  const dashboard=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`);
  expect(dashboard.body.canSchedule).toBe(false);expect(dashboard.body.shifts[0].canSchedule).toBe(false);
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Host',headcount:1,...dates(4)})).status).toBe(404);
  expect((await request(f.lead.token,`/workforce/assignments/${offer.body.id}/cancel`,{reason:'Changed schedule'})).status).toBe(404);
});
test('employees alone respond to their linked offers; retries preserve one record and audit',async()=>{
  const f=await setup();expect(f.alice.id).not.toBe(f.a.id);
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});expect(offer.status).toBe(201);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).body.id).toBe(offer.body.id);
  expect((await request(f.bob.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(404);
  expect((await request(f.admin.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(404);
  expect((await request(f.alice.token,'/workforce/my-assignments')).body).toHaveLength(1);
  expect((await request(f.bob.token,'/workforce/my-assignments')).body).toHaveLength(0);
  for(let i=0;i<2;i++) expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  expect((await pg.query("select * from activity_logs where details = 'Offer accepted'")).rows).toHaveLength(1);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'declined'})).status).toBe(409);
});
test('simultaneous acceptance of the final place accepts only one employee',async()=>{
  const f=await setup();const a=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id}),b=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id});
  const results=await Promise.all([request(f.alice.token,`/workforce/assignments/${a.body.id}/respond`,{decision:'accepted'}),request(f.bob.token,`/workforce/assignments/${b.body.id}/respond`,{decision:'accepted'})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const dashboard=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`);expect(dashboard.body.shifts[0].assignments.filter((a:any)=>a.status==='accepted')).toHaveLength(1);
});
test('overlapping offers are rechecked on acceptance; adjacent shifts remain valid',async()=>{
  const f=await setup();const next=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Another host',headcount:1,startAt:instant(3,15),endAt:instant(3,18)});
  const a=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id}),b=await request(f.lead.token,`/workforce/shifts/${next.body.id}/offers`,{employeeId:f.a.id});
  expect((await request(f.alice.token,`/workforce/assignments/${a.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${b.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  const adjacent=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Evening host',headcount:1,startAt:instant(3,16),endAt:instant(3,20)});
  const c=await request(f.lead.token,`/workforce/shifts/${adjacent.body.id}/offers`,{employeeId:f.a.id});expect(c.status).toBe(201);
  expect((await request(f.alice.token,`/workforce/assignments/${c.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
});
test('membership, employment dates, and status must cover the entire shift',async()=>{
  const f=await setup();await context.db.update(schema.workforceMembers).set({endAt:new Date(instant(3,12))}).where(eq(schema.workforceMembers.employeeId,f.a.id));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(409);
  await context.db.update(schema.employees).set({contractEndDate:instant(2).slice(0,10)}).where(eq(schema.employees.id,f.b.id));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id})).status).toBe(409);
  await context.db.update(schema.employees).set({contractEndDate:null}).where(eq(schema.employees.id,f.b.id));
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id});expect(offer.status).toBe(201);
  await context.db.update(schema.employees).set({status:'inactive'}).where(eq(schema.employees.id,f.b.id));
  expect((await request(f.bob.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
});
test('overnight shifts detect leave on the following site day; cancellation permits leave approval',async()=>{
  const f=await setup();const overnight=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Night host',headcount:1,startAt:instant(4,20),endAt:instant(5,1)});
  const offer=await request(f.lead.token,`/workforce/shifts/${overnight.body.id}/offers`,{employeeId:f.a.id});expect(offer.status).toBe(201);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  const [leave]=await context.db.insert(schema.leaves).values({employeeId:f.a.id,leaveType:'Annual',startDate:instant(5).slice(0,10),endDate:instant(5).slice(0,10),totalDays:1,reason:'Private'}).returning();
  expect((await request(f.admin.token,`/leave/${leave.id}/status`,{status:'approved'},'PATCH')).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/assignments/${offer.body.id}/cancel`,{reason:'Approved leave cover'})).status).toBe(200);
  expect((await request(f.admin.token,`/leave/${leave.id}/status`,{status:'approved'},'PATCH')).status).toBe(200);
  const mine=await request(f.alice.token,'/workforce/my-assignments');expect(mine.body[0].cancellationReason).toBe('Approved leave cover');
  const second=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Late night host',headcount:1,startAt:instant(4,21),endAt:instant(5,2)});
  expect((await request(f.lead.token,`/workforce/shifts/${second.body.id}/offers`,{employeeId:f.a.id})).status).toBe(409);
});
test('legacy attendance and event assignments cannot double-book an accepted workforce shift',async()=>{
  const f=await setup(),storage=new DatabaseStorage();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  await expect(storage.createShiftSchedule({employeeId:f.a.id,shiftName:'Legacy',date:instant(3).slice(0,10),startTime:new Date(instant(3,9)),endTime:new Date(instant(3,17)),breakDuration:30,location:'Test'})).rejects.toThrow(/accepted workforce shift/);
  const [event]=await context.db.insert(schema.events).values({name:'Legacy event',startDate:instant(3).slice(0,10),endDate:instant(3).slice(0,10),location:'Test',createdBy:f.admin.id}).returning();
  await expect(storage.createEventStaffAssignment({eventId:event.id,employeeId:f.a.id,role:'Host',status:'assigned',startTime:new Date(instant(3,9)),endTime:new Date(instant(3,17))})).rejects.toThrow(/accepted workforce shift/);
  await storage.createEventStaffAssignment({eventId:event.id,employeeId:f.b.id,role:'Host',status:'assigned',startTime:new Date(instant(3,9)),endTime:new Date(instant(3,17))});
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id})).status).toBe(409);
});
test('invalid time zones, backwards and overlong shifts, and invalid breaks are rejected',async()=>{
  const f=await setup();expect((await request(f.admin.token,'/workforce/sites',{name:'Bad',timezone:'Imaginary/Zone'})).status).toBe(400);
  for(const input of [{startAt:instant(4),endAt:instant(3)}, {startAt:instant(3),endAt:instant(5)}, {...dates(),breakMinutes:480}, {...dates(),headcount:0}])
    expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Host',headcount:1,...input})).status).toBe(400);
  expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard?from=${instant(1)}&to=${instant(40)}`)).status).toBe(400);
});

test('availability is private, non-overlapping and rechecked on shift acceptance',async()=>{
 const f=await setup();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
 const declaration=await request(f.alice.token,'/workforce/availability',{...dates(),kind:'unavailable'});expect(declaration.status).toBe(201);
 expect((await request(f.alice.token,'/workforce/availability',{...dates(),kind:'available'})).status).toBe(409);
 expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
 const range=`?from=${instant(0)}&to=${instant(9)}`;
 expect((await request(f.bob.token,'/workforce/availability'+range)).body).toEqual([]);
 expect((await request(f.bob.token,`/workforce/availability/${declaration.body.id}/cancel`,{})).status).toBe(404);
 const candidates=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/candidates`);expect(candidates.status).toBe(200);expect(candidates.body.items.find((p:any)=>p.id===f.a.id).eligible).toBe(false);
 expect((await request(f.alice.token,`/workforce/availability/${declaration.body.id}/cancel`,{})).status).toBe(200);
 expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
 expect((await request(f.alice.token,'/workforce/availability',{...dates(),kind:'unavailable'})).status).toBe(409);
 expect((await request(f.alice.token,'/workforce/availability',{...dates(-3),kind:'available'})).status).toBe(400);
});
test('recurring rosters replay safely and roll back all occurrences outside grant dates',async()=>{
 const f=await setup(),url=`/workforce/teams/${f.teamId}/series`,input={shift:{role:'Recurring host',headcount:2,...dates(4)},count:3,intervalDays:2,requestKey:'c4b482d0-4b08-4cbd-8767-f43f969e062e'};
 const saved=await request(f.lead.token,url,input);expect(saved.status).toBe(201);expect(saved.body.shifts).toHaveLength(3);
 expect(saved.body.shifts.map((s:any)=>s.startAt)).toEqual([instant(4),instant(6),instant(8)]);
 expect((await request(f.lead.token,url,input)).body).toEqual(saved.body);
 expect((await request(f.lead.token,url,{...input,count:2})).status).toBe(409);
 const count=await pg.query('select count(*)::int as n from workforce_shifts');
 expect((await request(f.lead.token,url,{...input,count:5,requestKey:'a4b482d0-4b08-4cbd-8767-f43f969e062e'})).status).toBe(404);
 expect((await pg.query('select count(*)::int as n from workforce_shifts')).rows).toEqual(count.rows);
});
test('replacement cancels the original, retains history and requires new acceptance',async()=>{
 const f=await setup();const original=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${original.body.id}/respond`,{decision:'accepted'});
 const url=`/workforce/assignments/${original.body.id}/replace`,input={employeeId:f.b.id,reason:'Cover approved absence'};
 expect((await request(f.alice.token,url,input)).status).toBe(404);
 const saved=await request(f.lead.token,url,input);expect(saved.status).toBe(201);expect((await request(f.lead.token,url,input)).body).toEqual(saved.body);
 const rows=await context.db.select().from(schema.workforceAssignments);expect(rows.find((a:any)=>a.id===original.body.id).status).toBe('cancelled');expect(rows.find((a:any)=>a.id===saved.body.id).status).toBe('offered');
 expect((await pg.query('select * from workforce_replacements')).rows).toHaveLength(1);
 expect((await request(f.bob.token,`/workforce/assignments/${saved.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
});
test('shift revision archives responses, checks both windows and rejects stale revisions',async()=>{
 const f=await setup();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
 const url=`/workforce/shifts/${f.shiftId}/revise`,input={version:1,shift:{role:'Revised host',headcount:1,...dates(4)},reason:'Venue opening moved'};
 expect((await request(f.lead.token,url,{...input,shift:{...input.shift,...dates(11)}})).status).toBe(404);
 const revision=await request(f.lead.token,url,input);expect(revision.status).toBe(201);
 expect((await request(f.lead.token,url,input)).status).toBe(409);
 expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
 expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id})).status).toBe(409);
 const rows=await context.db.select().from(schema.workforceShifts);expect(rows.find((s:any)=>s.id===f.shiftId).cancelledAt).toBeTruthy();expect(rows.find((s:any)=>s.id===revision.body.id).supersedesId).toBe(f.shiftId);
 expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/history`)).body).toHaveLength(2);
 expect((await request(f.alice.token,`/workforce/shifts/${f.shiftId}/history`)).status).toBe(404);
 expect((await request(f.lead.token,`/workforce/shifts/${revision.body.id}/offers`,{employeeId:f.a.id})).status).toBe(201);
});
test('coverage flags pending absences without exposing reasons and inbox preserves lane permissions',async()=>{
 const f=await setup();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
 const [leave]=await context.db.insert(schema.leaves).values({employeeId:f.a.id,leaveType:'Annual',startDate:instant(3).slice(0,10),endDate:instant(3).slice(0,10),totalDays:1,reason:'SECRET medical information'}).returning();
 const range=`?from=${instant(0,0)}&to=${instant(9,0)}`;
 const coverage=await request(f.lead.token,`/workforce/teams/${f.teamId}/coverage`+range);expect(coverage.status).toBe(200);expect(coverage.body.items[0].warnings[0].issue).toBe('Absence request pending');expect(JSON.stringify(coverage.body)).not.toContain('SECRET');
 const inbox=await request(f.admin.token,`/workforce/teams/${f.teamId}/approvals`+range);expect(inbox.status).toBe(200);expect(inbox.body.leave.map((l:any)=>l.id)).toContain(leave.id);expect(JSON.stringify(inbox.body)).not.toContain('SECRET');
 const leadInbox=await request(f.lead.token,`/workforce/teams/${f.teamId}/approvals`+range);expect(leadInbox.status).toBe(200);expect(leadInbox.body.time).toEqual([]);expect(leadInbox.body.performance).toEqual([]);
 await context.db.update(schema.workforceGrants).set({revokedAt:new Date()}).where(eq(schema.workforceGrants.id,f.grantId));
 expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/approvals`+range)).status).toBe(404);
 expect((await request(f.lead.token,`/workforce/teams/${f.teamId}/coverage`+range)).status).toBe(404);
});
test('failed audit rolls back a replacement and a revision completely',async()=>{
 const f=await setup();const original=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
 await pg.exec("CREATE FUNCTION reject_operations_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER reject_operations_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_operations_audit();");
 try{
  expect((await request(f.lead.token,`/workforce/assignments/${original.body.id}/replace`,{employeeId:f.b.id,reason:'Coverage required'})).status).toBe(500);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,{version:1,shift:{role:'Revised host',headcount:1,...dates(4)},reason:'Venue changed'})).status).toBe(500);
  expect((await context.db.select().from(schema.workforceAssignments)).map((a:any)=>a.status)).toEqual(['offered']);
  expect((await pg.query('select * from workforce_replacements')).rows).toHaveLength(0);expect((await context.db.select().from(schema.workforceShifts))).toHaveLength(1);
 }finally{await pg.exec('DROP TRIGGER reject_operations_audit ON activity_logs; DROP FUNCTION reject_operations_audit();');}
});

test('recurring shifts preserve site clock time across DST and reject ambiguous occurrences atomically',async()=>{
 const f=await setup();await context.db.update(schema.workforceSites).set({timezone:'America/New_York'});
 const year=new Date().getUTCFullYear()+1;let sunday=new Date(Date.UTC(year,10,1));while(sunday.getUTCDay()!==0)sunday.setUTCDate(sunday.getUTCDate()+1);
 const before=new Date(+sunday-7*86400000).toISOString().slice(0,10),after=sunday.toISOString().slice(0,10);
 const url=`/workforce/teams/${f.teamId}/series`;
 const result=await request(f.admin.token,url,{shift:{role:'Morning host',headcount:1,startAt:siteTimeToIso(before+'T09:00','America/New_York'),endAt:siteTimeToIso(before+'T17:00','America/New_York')},count:2,intervalDays:7,requestKey:'b4b482d0-4b08-4cbd-8767-f43f969e062e'});
 expect(result.status).toBe(201);expect(result.body.shifts[1].startAt).toBe(siteTimeToIso(after+'T09:00','America/New_York'));
 expect(Date.parse(result.body.shifts[1].startAt)-Date.parse(result.body.shifts[0].startAt)).toBe(169*3600000);
 const count=(await pg.query('select count(*)::int as n from workforce_shifts')).rows;
 const invalid=await request(f.admin.token,url,{shift:{role:'Night host',headcount:1,startAt:siteTimeToIso(before+'T01:30','America/New_York'),endAt:siteTimeToIso(before+'T04:00','America/New_York')},count:2,intervalDays:7,requestKey:'d4b482d0-4b08-4cbd-8767-f43f969e062e'});
 expect(invalid.status).toBe(400);expect(invalid.body.message).toMatch(/skipped|repeated/);expect((await pg.query('select count(*)::int as n from workforce_shifts')).rows).toEqual(count);
});
