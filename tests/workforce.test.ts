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
import {recurrenceInput, expandRecurrence} from '../shared/workforce-rosters';
import {randomUUID} from 'node:crypto';
import {defaultArrivalRules} from '../shared/workforce-operations';
import {availabilityPattern,expandAvailability,defaultRenewalPolicy} from '../shared/workforce-renewals';
import {missingQualifications} from '../server/services/workforce';

const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import router from '../server/routes/workforce';
import leaveRouter from '../server/routes/leaveRequests';
import overviewRouter from '../server/routes/teamOverview';
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
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/workforce',router);app.use('/leave',leaveRouter);app.use('/overview',overviewRouter);
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
  await context.db.insert(schema.leaveSnapshots).values({leaveId:leave.id,rules:[],daysByYear:{[leave.startDate.slice(0,4)]:1},balanceRequired:false});
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

const repeat = (start=3,end=5) => ({role:'Recurring host',station:'Welcome',headcount:2,breakMinutes:30,
  startDate:instant(start).slice(0,10),endDate:instant(end).slice(0,10),weekdays:[0,1,2,3,4,5,6],startTime:'09:00',endTime:'17:00',endDayOffset:0});
const revision = (day=4) => ({version:1,reason:'Client changed the event schedule',shift:{role:'Revised host',station:'Entrance',headcount:1,breakMinutes:45,...dates(day)}});

test('recurrence preserves site wall times across DST, handles overnight dates, and rejects gaps or excess occurrences',()=>{
  const rows=expandRecurrence(recurrenceInput.parse({...repeat(),startDate:'2026-03-01',endDate:'2026-03-15',weekdays:[0],startTime:'09:00',endTime:'17:00'}),'America/New_York');
  expect(rows.map(r=>r.startAt.toISOString())).toEqual(['2026-03-01T14:00:00.000Z','2026-03-08T13:00:00.000Z','2026-03-15T13:00:00.000Z']);
  const night=expandRecurrence(recurrenceInput.parse({...repeat(),startDate:'2026-10-01',endDate:'2026-10-01',startTime:'23:00',endTime:'04:00',endDayOffset:1}),'Asia/Qatar');
  expect(night[0].startAt.toISOString()).toBe('2026-10-01T20:00:00.000Z');expect(night[0].endAt.toISOString()).toBe('2026-10-02T01:00:00.000Z');
  expect(()=>expandRecurrence(recurrenceInput.parse({...repeat(),startDate:'2026-03-08',endDate:'2026-03-08',startTime:'02:30'}),'America/New_York')).toThrow(/skipped|repeated/);
  expect(()=>recurrenceInput.parse({...repeat(),startDate:'2026-02-30'})).toThrow();
  expect(()=>expandRecurrence(recurrenceInput.parse({...repeat(),startDate:'2026-01-01',endDate:'2026-03-15'}),'Asia/Qatar')).toThrow(/60/);
});

test('recurrence preview is read-only; concurrent creation retries produce exactly one batch',async()=>{
  const f=await setup(), recurrence=repeat(), requestKey=randomUUID(), url=`/workforce/teams/${f.teamId}/series`;
  const preview=await request(f.lead.token,url+'/preview',recurrence);
  expect(preview.status).toBe(200);expect(preview.body.shifts).toHaveLength(3);
  expect((await context.db.select().from(schema.workforceShifts))).toHaveLength(1);
  const results=await Promise.all([request(f.lead.token,url,{requestKey,recurrence}),request(f.lead.token,url,{requestKey,recurrence})]);
  expect(results.map(r=>r.status).sort()).toEqual([200,201]);expect(results[0].body.id).toBe(results[1].body.id);
  expect((await context.db.select().from(schema.workforceShifts))).toHaveLength(4);
  expect((await context.db.select().from(schema.workforceSeries))).toHaveLength(1);
  expect((await request(f.lead.token,url,{requestKey,recurrence:{...recurrence,role:'Different host'}})).status).toBe(409);
});

test('recurrence authorization covers every occurrence; errors leave no partial batch',async()=>{
  const f=await setup(),url=`/workforce/teams/${f.teamId}/series`;
  expect((await request(f.alice.token,url+'/preview',repeat())).status).toBe(404);
  const outside={requestKey:randomUUID(),recurrence:repeat(8,11)};
  expect((await request(f.lead.token,url,outside)).status).toBe(404);
  expect((await request(f.admin.token,url,{requestKey:randomUUID(),recurrence:{...repeat(),weekdays:[]}})).status).toBe(400);
  expect((await request(f.admin.token,url+'/preview',repeat(-1,1))).status).toBe(400);
  expect((await context.db.select().from(schema.workforceSeries))).toHaveLength(0);
  expect((await context.db.select().from(schema.workforceShifts))).toHaveLength(1);
});

test('shift revisions preserve original terms and consent, require fresh acceptance, and reject stale actions',async()=>{
  const f=await setup();const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const revised=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision());
  expect(revised.status).toBe(201);expect(revised.body.offers).toBe(1);
  const newId=revised.body.shift.id;
  const [original]=await context.db.select().from(schema.workforceShifts).where(eq(schema.workforceShifts.id,f.shiftId));
  expect(original.status).toBe('replaced');expect(original.version).toBe(2);expect(original.replacementId).toBe(newId);expect(original.startAt.toISOString()).toBe(dates().startAt);
  const [history]=await context.db.select().from(schema.workforceShiftChanges);
  expect(history.snapshot.assignments[0].status).toBe('accepted');expect(history.snapshot.shift.role).toBe('Activity host');
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  const mine=await request(f.alice.token,'/workforce/my-assignments');
  expect(mine.body).toHaveLength(2);const next=mine.body.find((a:any)=>a.status==='offered');
  expect(next.replacesId).toBe(f.shiftId);expect(next.role).toBe('Revised host');expect(next.breakMinutes).toBe(45);
  expect((await request(f.alice.token,`/workforce/assignments/${next.id}/respond`,{decision:'accepted'})).status).toBe(200);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision(5))).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:1,reason:'Stale browser tab'})).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id})).status).toBe(409);
});

test('a conflicting revised offer rolls back every cancellation, replacement and audit',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const other=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Other event',headcount:1,...dates(4)});
  const second=await request(f.lead.token,`/workforce/shifts/${other.body.id}/offers`,{employeeId:f.a.id});
  await request(f.alice.token,`/workforce/assignments/${second.body.id}/respond`,{decision:'accepted'});
  const result=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision());
  expect(result.status).toBe(409);expect(result.body.message).toMatch(/accepted workforce shift/);
  const [original]=await context.db.select().from(schema.workforceAssignments).where(eq(schema.workforceAssignments.id,offer.body.id));
  expect(original.status).toBe('accepted');expect((await context.db.select().from(schema.workforceShifts))).toHaveLength(2);
  expect((await context.db.select().from(schema.workforceShiftChanges))).toHaveLength(0);
});

test('whole-shift cancellation keeps terminal responses and history, removes coverage, and blocks offers',async()=>{
  const f=await setup(2),a=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id}),b=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id});
  await request(f.alice.token,`/workforce/assignments/${a.body.id}/respond`,{decision:'accepted'});
  await request(f.bob.token,`/workforce/assignments/${b.body.id}/respond`,{decision:'declined'});
  const result=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:1,reason:'Venue cancelled this event'});
  expect(result.status).toBe(200);
  const dash=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`),shift=dash.body.shifts[0];
  expect(shift.status).toBe('cancelled');expect(shift.assignments.map((a:any)=>a.status).sort()).toEqual(['cancelled','declined']);
  const overview=await request(f.admin.token,`/overview?teamId=${f.teamId}`);
  expect(overview.status).toBe(200);expect(overview.body.staffing).toMatchObject({shifts:0,required:0,accepted:0,unfilled:0,pendingOffers:0});
  const mine=await request(f.alice.token,'/workforce/my-assignments');expect(mine.body[0].cancellationReason).toBe('Venue cancelled this event');
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(409);
  const [history]=await context.db.select().from(schema.workforceShiftChanges);expect(history.snapshot.assignments.some((a:any)=>a.status==='accepted')).toBe(true);
});

test('revisions and cancellation require current scheduling access and reject reported or started shifts',async()=>{
  const f=await setup();
  expect((await request(f.alice.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:1,reason:'No permission'})).status).toBe(404);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision(11))).status).toBe(404);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision())).status).toBe(404);
  const offer=await request(f.admin.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  // Simulate pre-existing imported time; it must remain immutable even if dated in the future.
  await context.db.insert(schema.workforceTimesheets).values({assignmentId:offer.body.id,actualStartAt:new Date(instant(3,8)),actualEndAt:new Date(instant(3,16)),breakMinutes:30,workedMinutes:450,employeeNote:'Imported time'});
  expect((await request(f.admin.token,`/workforce/shifts/${f.shiftId}/revise`,revision())).status).toBe(409);
  expect((await request(f.admin.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:1,reason:'Do not change reported time'})).status).toBe(409);
  await context.db.update(schema.workforceShifts).set({startAt:new Date(instant(-1,8)),endAt:new Date(instant(-1,16))}).where(eq(schema.workforceShifts.id,f.shiftId));
  expect((await request(f.admin.token,`/workforce/shifts/${f.shiftId}/revise`,{...revision(),version:2})).status).toBe(409);
});

test('one recurrence occurrence can change without altering the other dates',async()=>{
  const f=await setup(),batch=await request(f.lead.token,`/workforce/teams/${f.teamId}/series`,{requestKey:randomUUID(),recurrence:repeat()});
  const first=batch.body.shifts[0],second=batch.body.shifts[1];
  const revised=await request(f.lead.token,`/workforce/shifts/${first.id}/revise`,revision(6));expect(revised.status).toBe(201);
  expect(revised.body.shift.seriesId).toBe(batch.body.id);
  const [unchanged]=await context.db.select().from(schema.workforceShifts).where(eq(schema.workforceShifts.id,second.id));
  expect(unchanged.status).toBe('scheduled');expect(unchanged.version).toBe(1);expect(unchanged.startAt.toISOString()).toBe(second.startAt);
});

test('the recorded final employment date remains eligible through that local calendar day',async()=>{
  const f=await setup();await context.db.update(schema.employees).set({terminationDate:instant(3).slice(0,10)}).where(eq(schema.employees.id,f.a.id));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id})).status).toBe(201);
  const next=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Following day',headcount:1,...dates(4)});
  expect((await request(f.lead.token,`/workforce/shifts/${next.body.id}/offers`,{employeeId:f.a.id})).status).toBe(409);
});

async function qualification(f:Awaited<ReturnType<typeof setup>>,employeeId=f.a.id,through=5){
  const type=await request(f.admin.token,'/workforce/staffing/catalog',{name:'First aid'});expect(type.status).toBe(201);
  const credential=await request(f.admin.token,`/workforce/staffing/employees/${employeeId}/qualifications`,{qualificationId:type.body.id,validFrom:instant(-1).slice(0,10),validThrough:instant(through).slice(0,10),verificationReference:'PRIVATE-CERTIFICATE-REFERENCE'});expect(credential.status).toBe(201);
  return {qualificationId:type.body.id,credentialId:credential.body.id};
}
test('availability is private to its employee and HR, blocks new and pending offers, and preserves cancelled history',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const body={...dates(),note:'PRIVATE-PERSONAL-NOTE'};
  expect((await request(f.bob.token,`/workforce/staffing/employees/${f.a.id}/unavailable`,body)).status).toBe(404);
  const block=await request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/unavailable`,body);expect(block.status).toBe(201);
  expect((await request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/unavailable`,body)).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/staffing/profile?employeeId=${f.a.id}`)).status).toBe(404);
  expect((await request(f.bob.token,`/workforce/staffing/profile?employeeId=${f.a.id}`)).status).toBe(404);
  const own=await request(f.alice.token,'/workforce/staffing/profile');expect(own.body.unavailable[0].note).toBe(body.note);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  const second=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Second task',headcount:1,...dates()});
  expect((await request(f.lead.token,`/workforce/shifts/${second.body.id}/offers`,{employeeId:f.a.id})).status).toBe(409);
  const candidates=await request(f.lead.token,`/workforce/shifts/${second.body.id}/candidates`);expect(candidates.body.candidates.find((p:any)=>p.id===f.a.id)).toMatchObject({eligible:false,issue:'Employee has recorded unavailability during this shift'});
  expect(JSON.stringify(candidates.body)).not.toContain(body.note);expect(JSON.stringify((await context.db.select().from(schema.activityLogs)))).not.toContain(body.note);
  expect((await request(f.bob.token,`/workforce/staffing/unavailable/${block.body.id}/cancel`,{reason:'Not my record'})).status).toBe(404);
  expect((await request(f.alice.token,`/workforce/staffing/unavailable/${block.body.id}/cancel`,{reason:'Plans have changed'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  expect((await request(f.alice.token,'/workforce/staffing/profile')).body.unavailable[0].cancelledAt).toBeTruthy();
});
test('concurrent unavailability and shift acceptance cannot both succeed',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const results=await Promise.all([request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/unavailable`,{...dates(),note:''}),request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})]);
  expect(results.filter(r=>r.status===409)).toHaveLength(1);expect(results.filter(r=>r.status===200||r.status===201)).toHaveLength(1);
});
test('qualification catalog and verification are HR-only, dated and private, with duplicate prevention',async()=>{
  const f=await setup(),q=await qualification(f);
  expect((await request(f.lead.token,'/workforce/staffing/catalog',{name:'Other training'})).status).toBe(403);
  expect((await request(f.admin.token,'/workforce/staffing/catalog',{name:'FIRST AID'})).status).toBe(409);
  const input={qualificationId:q.qualificationId,validFrom:instant(1).slice(0,10),validThrough:instant(5).slice(0,10),verificationReference:'HR verified certificate'};
  expect((await request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/qualifications`,input)).status).toBe(403);
  expect((await request(f.admin.token,`/workforce/staffing/employees/${f.a.id}/qualifications`,input)).status).toBe(409);
  expect((await request(f.admin.token,`/workforce/staffing/employees/${f.b.id}/qualifications`,{...input,validFrom:'2026-02-30'})).status).toBe(400);
  expect((await request(f.alice.token,'/workforce/staffing/profile')).body.qualifications[0].verificationReference).toBe('PRIVATE-CERTIFICATE-REFERENCE');
  expect((await request(f.lead.token,`/workforce/staffing/profile?employeeId=${f.a.id}`)).status).toBe(404);
});
test('qualification validity covers overnight shifts and remains valid through the stated final day',async()=>{
  const f=await setup(),q=await qualification(f,f.a.id,3);
  const day=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'First aid host',headcount:1,...dates(),qualificationIds:[q.qualificationId]});expect(day.status).toBe(201);expect(day.body.requiredQualifications).toEqual([{id:q.qualificationId,name:'First aid'}]);
  expect((await request(f.lead.token,`/workforce/shifts/${day.body.id}/offers`,{employeeId:f.a.id})).status).toBe(201);
  expect((await request(f.lead.token,`/workforce/shifts/${day.body.id}/offers`,{employeeId:f.b.id})).status).toBe(409);
  const night=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Night first aid',headcount:1,startAt:instant(3,20),endAt:instant(4,1),qualificationIds:[q.qualificationId]});
  expect((await request(f.lead.token,`/workforce/shifts/${night.body.id}/offers`,{employeeId:f.a.id})).status).toBe(409);
  expect((await request(f.admin.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Invalid qualification',headcount:1,...dates(),qualificationIds:[99999]})).status).toBe(400);
});
test('revocation rechecks pending acceptance and flags accepted rosters without exposing verification references',async()=>{
  const f=await setup(),q=await qualification(f);
  const shift=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'First aid host',headcount:1,...dates(),qualificationIds:[q.qualificationId]});
  const offer=await request(f.lead.token,`/workforce/shifts/${shift.body.id}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const next=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Tomorrow first aid',headcount:1,...dates(4),qualificationIds:[q.qualificationId]});
  const pending=await request(f.lead.token,`/workforce/shifts/${next.body.id}/offers`,{employeeId:f.a.id});
  expect((await request(f.alice.token,`/workforce/staffing/qualifications/${q.credentialId}/revoke`,{reason:'Self revoke denied'})).status).toBe(403);
  expect((await request(f.admin.token,`/workforce/staffing/qualifications/${q.credentialId}/revoke`,{reason:'Certificate verification withdrawn'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${pending.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  const dashboard=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`),row=dashboard.body.shifts.find((s:any)=>s.id===shift.body.id).assignments[0];
  expect(row).toMatchObject({status:'accepted',missingQualifications:['First aid']});expect(JSON.stringify(dashboard.body)).not.toMatch(/PRIVATE-CERTIFICATE|verificationReference/);
  const mine=await request(f.alice.token,'/workforce/my-assignments');expect(mine.body.find((a:any)=>a.id===offer.body.id).missingQualifications).toEqual(['First aid']);
});
test('recurrence snapshots requirements and revisions preserve omitted requirements or require fresh consent to remove them',async()=>{
  const f=await setup(),q=await qualification(f),batch=await request(f.lead.token,`/workforce/teams/${f.teamId}/series`,{requestKey:randomUUID(),recurrence:{...repeat(),qualificationIds:[q.qualificationId]}});
  expect(batch.status).toBe(201);expect(batch.body.shifts.every((s:any)=>s.requiredQualifications[0].id===q.qualificationId)).toBe(true);
  const first=batch.body.shifts[0];
  const revise=await request(f.lead.token,`/workforce/shifts/${first.id}/revise`,revision());expect(revise.status).toBe(201);expect(revise.body.shift.requiredQualifications).toEqual(first.requiredQualifications);
  const removed=await request(f.lead.token,`/workforce/shifts/${revise.body.shift.id}/revise`,{...revision(),shift:{...revision().shift,qualificationIds:[]}});expect(removed.status).toBe(201);expect(removed.body.shift.requiredQualifications).toEqual([]);
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.b.id});await request(f.bob.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,{...revision(),shift:{...revision().shift,qualificationIds:[q.qualificationId]}})).status).toBe(409);
  const [original]=await context.db.select().from(schema.workforceAssignments).where(eq(schema.workforceAssignments.id,offer.body.id));expect(original.status).toBe('accepted');
});
test('replacement acceptance atomically transfers a full shift and repeated requests preserve one replacement',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const input={employeeId:f.b.id,shiftVersion:1,reason:'Cover the original employee'};
  const replacements=await Promise.all([request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,input),request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,input)]);
  expect(replacements.map(r=>r.status)).toEqual([201,201]);expect(replacements[0].body.id).toBe(replacements[1].body.id);
  const replacementId=replacements[0].body.id;
  expect((await request(f.alice.token,'/workforce/my-assignments')).body[0]).toMatchObject({status:'accepted',replacementPending:true});
  expect((await request(f.bob.token,'/workforce/my-assignments')).body[0]).toMatchObject({status:'offered',replacesAssignmentId:offer.body.id});
  expect((await request(f.lead.token,`/workforce/assignments/${replacementId}/respond`,{decision:'accepted'})).status).toBe(404);
  for(let i=0;i<2;i++)expect((await request(f.bob.token,`/workforce/assignments/${replacementId}/respond`,{decision:'accepted'})).status).toBe(200);
  const dashboard=await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`);expect(dashboard.body.shifts[0].assignments.map((a:any)=>a.status).sort()).toEqual(['accepted','cancelled']);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  expect((await request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/unavailable`,{...dates(),note:'Released for other plans'})).status).toBe(201);
});
test('replacement refusal and failed eligibility preserve the original accepted coverage',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const replacement=await request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,{employeeId:f.b.id,shiftVersion:1,reason:'Request alternative cover'});
  const block=await request(f.bob.token,`/workforce/staffing/employees/${f.b.id}/unavailable`,{...dates(),note:'Personal plans'});expect(block.status).toBe(201);
  expect((await request(f.bob.token,`/workforce/assignments/${replacement.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  expect((await request(f.bob.token,`/workforce/assignments/${replacement.body.id}/respond`,{decision:'declined'})).status).toBe(200);
  const [original]=await context.db.select().from(schema.workforceAssignments).where(eq(schema.workforceAssignments.id,offer.body.id));expect(original.status).toBe('accepted');
  expect((await request(f.alice.token,'/workforce/my-assignments')).body[0].replacementPending).toBe(false);
});
test('replacement offers enforce scope, stale versions and revision/cancellation safeguards',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id}),input={employeeId:f.b.id,shiftVersion:1,reason:'Alternative cover required'};
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/replacement`,input)).status).toBe(404);
  expect((await request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,{...input,shiftVersion:2})).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,{...input,employeeId:f.a.id})).status).toBe(400);
  const replacement=await request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,input);expect(replacement.status).toBe(201);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/revise`,revision())).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:1,reason:'The event is cancelled'})).status).toBe(200);
  expect((await request(f.bob.token,`/workforce/assignments/${replacement.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
});
test('replacement audit failure rolls back both employee statuses',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const replacement=await request(f.lead.token,`/workforce/assignments/${offer.body.id}/replacement`,{employeeId:f.b.id,shiftVersion:1,reason:'Swap after approval'});
  await pg.exec("CREATE FUNCTION fail_replacement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details LIKE '%replacement_accepted%' THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_replacement_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_replacement_audit();");
  try{expect((await request(f.bob.token,`/workforce/assignments/${replacement.body.id}/respond`,{decision:'accepted'})).status).toBe(500);}
  finally{await pg.exec('DROP TRIGGER test_replacement_audit ON activity_logs; DROP FUNCTION fail_replacement_audit();');}
  const all=await context.db.select().from(schema.workforceAssignments);expect(all.find((a:any)=>a.id===offer.body.id).status).toBe('accepted');expect(all.find((a:any)=>a.id===replacement.body.id).status).toBe('offered');
});
test('candidate searches are scoped, exclude existing assignments and reveal no private employee or verification data',async()=>{
  const f=await setup();await qualification(f);
  expect((await request(f.alice.token,`/workforce/shifts/${f.shiftId}/candidates`)).status).toBe(404);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/candidates?q=Alice`)).body.candidates.map((p:any)=>p.id)).toEqual([f.a.id]);
  await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const result=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/candidates`);expect(result.body.candidates.map((p:any)=>p.id)).toEqual([f.b.id]);
  expect(JSON.stringify(result.body)).not.toMatch(/private-|PRIVATE-|qid|salary|email|iban|note|reference/i);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grantId));expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/candidates`)).status).toBe(404);
});

async function liveAssignment(f:Awaited<ReturnType<typeof setup>>,startMinutes=-10,endMinutes=50){
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  const [shift]=await context.db.update(schema.workforceShifts).set({startAt:new Date(Date.now()+startMinutes*60000),endAt:new Date(Date.now()+endMinutes*60000),breakMinutes:0}).where(eq(schema.workforceShifts.id,f.shiftId)).returning();
  return {id:offer.body.id,shift};
}
test('membership revisions preserve the original start, append history and reject stale or unauthorized changes',async()=>{
  const f=await setup(),[member]=await context.db.select().from(schema.workforceMembers).where(eq(schema.workforceMembers.employeeId,f.a.id));
  const path=`/workforce/members/${member.id}/end-date`,input={version:member.version,endAt:instant(12),reason:'Contract coverage extended'};
  expect((await request(f.lead.token,path,input)).status).toBe(403);
  const saved=await request(f.admin.token,path,input);expect(saved.status).toBe(200);expect(saved.body.version).toBe(member.version+1);expect(saved.body.startAt).toBe(member.startAt.toISOString());
  expect((await request(f.admin.token,path,input)).status).toBe(409);
  expect((await request(f.alice.token,`/workforce/members/${member.id}/history`)).status).toBe(403);
  const history=await request(f.admin.token,`/workforce/members/${member.id}/history`);expect(history.body).toHaveLength(1);expect(history.body[0].previousEndAt).toBe(member.endAt.toISOString());
  expect((await request(f.admin.token,path,{...input,version:saved.body.version,endAt:instant(-1)})).status).toBe(409);
});
test('ending membership cannot strand offers or accepted shifts, overlap a period or reopen past history',async()=>{
  const f=await setup(),[member]=await context.db.select().from(schema.workforceMembers).where(eq(schema.workforceMembers.employeeId,f.a.id));
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const path=`/workforce/members/${member.id}/end-date`,input={version:1,endAt:instant(2),reason:'Employee changing teams'};
  expect((await request(f.admin.token,path,input)).status).toBe(409);
  await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  expect((await request(f.admin.token,path,input)).status).toBe(409);
  await request(f.lead.token,`/workforce/assignments/${offer.body.id}/cancel`,{reason:'Transfer approved by employee'});
  expect((await request(f.admin.token,path,input)).status).toBe(200);
  expect((await request(f.admin.token,`/workforce/teams/${f.teamId}/members`,{employeeId:f.a.id,startAt:instant(2),endAt:instant(15)})).status).toBe(201);
  expect((await request(f.admin.token,path,{...input,version:2,endAt:instant(5)})).status).toBe(409);
  await context.db.update(schema.workforceMembers).set({startAt:new Date(instant(-5)),endAt:new Date(instant(-2))}).where(eq(schema.workforceMembers.id,member.id));
  expect((await request(f.admin.token,path,{...input,version:3,endAt:instant(1)})).status).toBe(409);
});
test('arrival rules are admin-owned, dated and employee-specific, with immutable visit snapshots',async()=>{
  const f=await setup(),a=await liveAssignment(f),path=`/workforce/teams/${f.teamId}/arrival-rules`;
  const disabled={employeeId:null,effectiveAt:null,rules:{...defaultArrivalRules,enabled:false},reason:'Disable team mobile arrival'};
  expect((await request(f.lead.token,path,disabled)).status).toBe(403);
  expect((await request(f.admin.token,path,disabled)).status).toBe(201);
  expect((await request(f.alice.token,`/workforce/assignments/${a.id}/arrival`,{})).status).toBe(409);
  expect((await request(f.admin.token,path,{...disabled,employeeId:f.a.id,rules:defaultArrivalRules,effectiveAt:instant(1)})).status).toBe(201);
  expect((await request(f.alice.token,`/workforce/assignments/${a.id}/presence`)).body.rules.enabled).toBe(false);
  expect((await request(f.admin.token,path,{...disabled,employeeId:f.a.id,rules:defaultArrivalRules})).status).toBe(201);
  const arrived=await request(f.alice.token,`/workforce/assignments/${a.id}/arrival`,{});expect(arrived.status).toBe(200);
  await request(f.admin.token,path,{...disabled,employeeId:f.a.id});
  const own=await request(f.alice.token,`/workforce/assignments/${a.id}/presence`);expect(own.body.rules.enabled).toBe(true);
  expect((await request(f.alice.token,path)).status).toBe(403);
  expect((await request(f.admin.token,path,{...disabled,effectiveAt:instant(-1)})).status).toBe(400);
  const [stored]=await context.db.select().from(schema.workforcePresence);expect(stored.policySnapshot.rules.enabled).toBe(true);
});
test('mobile arrival and departure use server time, enforce ownership, and retry without duplicate visits',async()=>{
  const f=await setup(),a=await liveAssignment(f),path=`/workforce/assignments/${a.id}`;
  expect((await request(f.alice.token,path+'/departure',{})).status).toBe(409);
  expect((await request(f.bob.token,path+'/arrival',{})).status).toBe(404);
  expect((await request(f.admin.token,path+'/arrival',{})).status).toBe(404);
  expect((await request(f.alice.token,path+'/arrival',{arrivedAt:instant(-1)})).status).toBe(400);
  const before=Date.now(),first=await request(f.alice.token,path+'/arrival',{});expect(first.status).toBe(200);expect(Date.parse(first.body.arrivedAt)).toBeGreaterThanOrEqual(before);
  expect((await request(f.alice.token,path+'/arrival',{})).body.id).toBe(first.body.id);
  const departure=await request(f.alice.token,path+'/departure',{});expect(departure.status).toBe(200);expect(departure.body.flags).toContain('Departure before scheduled end');
  expect((await request(f.alice.token,path+'/departure',{})).body.departedAt).toBe(departure.body.departedAt);
  expect((await context.db.select().from(schema.workforcePresence))).toHaveLength(1);
  expect((await context.db.select().from(schema.workforceTimesheets))).toHaveLength(0);
  expect((await request(f.bob.token,path+'/presence')).status).toBe(404);
});
test('arrival rejects unopened windows and newly revoked qualifications before allowing any visit',async()=>{
  const f=await setup(),a=await liveAssignment(f,120,180),path=`/workforce/assignments/${a.id}/arrival`;
  expect((await request(f.alice.token,path,{})).status).toBe(409);
  await context.db.update(schema.workforceShifts).set({startAt:new Date(Date.now()-10*60000),requiredQualifications:[{id:900,name:'Safety certificate'}]}).where(eq(schema.workforceShifts.id,f.shiftId));
  const rejected=await request(f.alice.token,path,{});expect(rejected.status).toBe(409);expect(rejected.body.message).toMatch(/qualifications/);
  expect((await context.db.select().from(schema.workforcePresence))).toEqual([]);
});
test('early arrivals prevent shift revisions, cancellation and replacement even before scheduled start',async()=>{
  const f=await setup(),a=await liveAssignment(f,30,90);
  const pending=await request(f.lead.token,`/workforce/assignments/${a.id}/replacement`,{employeeId:f.b.id,shiftVersion:a.shift.version,reason:'Coverage requested'});expect(pending.status).toBe(201);
  expect((await request(f.alice.token,`/workforce/assignments/${a.id}/arrival`,{})).status).toBe(200);
  expect((await request(f.lead.token,`/workforce/assignments/${a.id}/cancel`,{reason:'Schedule changed'})).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/cancel`,{version:a.shift.version,reason:'Schedule changed'})).status).toBe(409);
  expect((await request(f.bob.token,`/workforce/assignments/${pending.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  const [original]=await context.db.select().from(schema.workforceAssignments).where(eq(schema.workforceAssignments.id,a.id));expect(original.status).toBe('accepted');
  expect((await request(f.lead.token,`/workforce/assignments/${a.id}/replacement`,{employeeId:f.b.id,shiftVersion:a.shift.version,reason:'New replacement requested'})).status).toBe(409);
});
test('only one visit stays open across non-overlapping assignments',async()=>{
  const f=await setup(),a=await liveAssignment(f,5,35);expect((await request(f.alice.token,`/workforce/assignments/${a.id}/arrival`,{})).status).toBe(200);
  const shift=await request(f.lead.token,`/workforce/teams/${f.teamId}/shifts`,{role:'Second role',headcount:1,startAt:new Date(Date.now()+40*60000).toISOString(),endAt:new Date(Date.now()+90*60000).toISOString()});expect(shift.status).toBe(201);
  const offer=await request(f.lead.token,`/workforce/shifts/${shift.body.id}/offers`,{employeeId:f.a.id});
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
  const blocked=await request(f.alice.token,`/workforce/assignments/${offer.body.id}/arrival`,{});expect(blocked.status).toBe(409);expect(blocked.body.message).toMatch(/previous assignment/);
  expect((await request(f.alice.token,`/workforce/assignments/${a.id}/departure`,{})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/arrival`,{})).status).toBe(200);
});
test('leads close and review visits with history, stale guards and exact grant coverage',async()=>{
  const f=await setup(),a=await liveAssignment(f),arrived=await request(f.alice.token,`/workforce/assignments/${a.id}/arrival`,{}),path=`/workforce/presence/${arrived.body.id}/review`;
  const input={version:1,action:'close',reason:'Employee forgot to record departure'};
  expect((await request(f.bob.token,path,input)).status).toBe(404);
  expect((await request(f.lead.token,path,{...input,action:'review'})).status).toBe(409);
  const closed=await request(f.lead.token,path,input);expect(closed.status).toBe(200);expect(closed.body.flags).toContain('Visit closed by lead');
  expect((await request(f.lead.token,path,input)).status).toBe(409);
  const reviewed=await request(f.lead.token,path,{version:closed.body.version,action:'review',reason:'Verified with site supervisor'});expect(reviewed.status).toBe(200);expect(reviewed.body.reviewedAt).toBeTruthy();
  const log=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/operations`);expect(log.status).toBe(200);expect(log.body.presence[0].reviewNote).toBe('Verified with site supervisor');
  expect(JSON.stringify(log.body)).not.toMatch(/private-|iban|qid|password|email/i);
  await context.db.update(schema.workforceGrants).set({endAt:new Date(Date.now()+30*60000)}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/operations`)).status).toBe(404);
});
test('a privileged employee cannot review their own arrival even after account relinking',async()=>{
  const f=await setup(),a=await liveAssignment(f);
  await context.db.update(schema.users).set({role:'super_admin'}).where(eq(schema.users.id,f.alice.id));
  const auth=await authService.login('alice',password),token=auth.accessToken;
  const arrived=await request(token,`/workforce/assignments/${a.id}/arrival`,{});expect(arrived.status).toBe(200);
  const path=`/workforce/presence/${arrived.body.id}/review`,input={version:1,action:'close',reason:'Closing recorded visit'};
  expect((await request(token,path,input)).status).toBe(403);
  await context.db.update(schema.employees).set({userId:null}).where(eq(schema.employees.id,f.a.id));
  expect((await request(token,path,input)).status).toBe(403);
  expect((await request(f.lead.token,path,input)).status).toBe(200);
});
test('incident reports stay scoped to the reporter and scheduling leads and preserve retry identity',async()=>{
  const f=await setup(2),a=await liveAssignment(f);
  const [b]=await context.db.insert(schema.workforceAssignments).values({shiftId:f.shiftId,employeeId:f.b.id,status:'accepted',createdBy:f.lead.id}).returning();
  const path=`/workforce/shifts/${f.shiftId}/incidents`,body={requestKey:randomUUID(),occurredAt:new Date(Date.now()-5*60000).toISOString(),title:'Equipment unavailable',details:'Ticket scanner stopped; switched to manual guest count.',severity:'medium'};
  const report=await request(f.alice.token,path,body);expect(report.status).toBe(201);expect((await request(f.alice.token,path,body)).body.id).toBe(report.body.id);
  expect((await request(f.alice.token,path,{...body,title:'Changed report details'})).status).toBe(409);
  const own=await request(f.alice.token,`/workforce/shifts/${f.shiftId}/operations`);expect(own.body.incidents).toHaveLength(1);expect(own.body.canManage).toBe(false);
  expect((await request(f.bob.token,`/workforce/shifts/${f.shiftId}/operations`)).body.incidents).toEqual([]);
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/operations`)).body.incidents).toHaveLength(1);
  expect((await request(f.bob.token,`/workforce/incidents/${report.body.id}/status`,{version:1,status:'resolved',note:'Closing another report'})).status).toBe(404);
  expect((await request(f.alice.token,path,{...body,requestKey:randomUUID(),occurredAt:instant(1)})).status).toBe(400);
  expect((await request(f.alice.token,path,{...body,requestKey:randomUUID(),occurredAt:instant(-1)})).status).toBe(400);
  const logs=await context.db.select().from(schema.activityLogs);expect(JSON.stringify(logs)).not.toContain(body.details);
  await context.db.update(schema.workforceGrants).set({permission:'view'}).where(eq(schema.workforceGrants.id,f.grantId));
  expect((await request(f.lead.token,`/workforce/shifts/${f.shiftId}/operations`)).status).toBe(404);
});
test('incident ownership, resolution and reopening append notes and reject stale decisions',async()=>{
  const f=await setup(),a=await liveAssignment(f);
  const report=await request(f.alice.token,`/workforce/shifts/${f.shiftId}/incidents`,{requestKey:randomUUID(),occurredAt:new Date(Date.now()-5*60000).toISOString(),title:'Station needs repair',details:'Scanner unavailable and queue building at station.',severity:'high'});
  const path=`/workforce/incidents/${report.body.id}/status`;
  expect((await request(f.lead.token,path,{version:1,status:'in_progress',note:'Taking ownership of repairs'})).status).toBe(200);
  expect((await request(f.admin.token,path,{version:1,status:'resolved',note:'Old browser view decision'})).status).toBe(409);
  expect((await request(f.lead.token,path,{version:2,status:'resolved',note:'Replacement scanner tested successfully'})).status).toBe(200);
  expect((await request(f.lead.token,path,{version:3,status:'in_progress',note:'Cannot edit a closed report'})).status).toBe(409);
  expect((await request(f.admin.token,path,{version:3,status:'open',note:'Scanner failure recurred after repair'})).status).toBe(200);
  const log=await request(f.alice.token,`/workforce/shifts/${f.shiftId}/operations`);expect(log.body.incidents[0].history.map((h:any)=>h.status)).toEqual(['in_progress','resolved','open']);expect(log.body.incidents[0].ownerName).toBeNull();
});

const dayDate=(days:number)=>instant(days).slice(0,10);
function weeklyPattern(from=2,to=4){return {timezone:'UTC',startDate:dayDate(from),endDate:dayDate(to),weekdays:[0,1,2,3,4,5,6],startTime:'08:00',endTime:'16:00',endDayOffset:0,note:'private weekly commitment'};}
async function expiryCredential(f:Awaited<ReturnType<typeof setup>>,expires=10){
  const kind=await request(f.admin.token,'/workforce/staffing/catalog',{name:'Safety qualification'});
  const credential=await request(f.admin.token,`/workforce/staffing/employees/${f.a.id}/qualifications`,{qualificationId:kind.body.id,validFrom:'2020-01-01',validThrough:dayDate(expires),verificationReference:'Original certificate checked by HR'});
  expect(credential.status).toBe(201);return {kindId:kind.body.id,credentialId:credential.body.id};
}
const renewalEvidence=()=>({requestKey:randomUUID(),reference:'New certificate reference ABC-123',note:'Please verify the updated certificate'});
function verifyRenewal(version=1,from=11,to=100){return {version,decision:'verify',reason:'Certificate and identity verified by HR',validFrom:dayDate(from),validThrough:dayDate(to),verificationReference:'HR verified renewed certificate ABC-123'};}

test('weekly unavailability preserves local hours and overnight dates, and rejects clock gaps and oversized patterns',()=>{
  const pattern=availabilityPattern.parse({...weeklyPattern(),timezone:'America/New_York',startDate:'2027-03-07',endDate:'2027-03-21',weekdays:[0],startTime:'09:00',endTime:'17:00'});
  const rows=expandAvailability(pattern);expect(rows.map(r=>r.startAt.toISOString().slice(11,16))).toEqual(['14:00','13:00','13:00']);
  const overnight=expandAvailability(availabilityPattern.parse({...pattern,timezone:'Asia/Qatar',startDate:'2027-03-07',endDate:'2027-03-07',startTime:'23:00',endTime:'04:00',endDayOffset:1}));expect(overnight[0].endAt.toISOString()).toBe('2027-03-08T01:00:00.000Z');
  expect(()=>expandAvailability(availabilityPattern.parse({...pattern,startDate:'2027-03-14',endDate:'2027-03-14',startTime:'02:30'}))).toThrow(/skipped|repeated/);
  expect(()=>availabilityPattern.parse({...pattern,startDate:'2027-01-01',endDate:'2028-01-02'})).toThrow(/366/);
  expect(()=>availabilityPattern.parse({...pattern,startTime:'17:00',endTime:'09:00'})).toThrow(/24/);
  const allDay=expandAvailability(availabilityPattern.parse({...pattern,startDate:'2027-11-07',endDate:'2027-11-07',startTime:'00:00',endTime:'00:00',endDayOffset:1}));expect(+allDay[0].endAt-+allDay[0].startAt).toBe(25*3600000);
});
test('recurring availability previews conflicts atomically and enforces owner/HR scope',async()=>{
  const f=await setup(),path=`/workforce/staffing/employees/${f.a.id}/availability-series`,pattern=weeklyPattern();
  expect((await request(f.bob.token,path+'/preview',pattern)).status).toBe(404);expect((await request(f.lead.token,path,{requestKey:randomUUID(),pattern})).status).toBe(404);
  const offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'});
  const preview=await request(f.alice.token,path+'/preview',pattern);expect(preview.status).toBe(200);expect(preview.body.occurrences).toHaveLength(3);expect(preview.body.occurrences.filter((o:any)=>o.issue)).toHaveLength(1);
  expect((await request(f.admin.token,path,{requestKey:randomUUID(),pattern})).status).toBe(409);expect((await context.db.select().from(schema.workforceUnavailable))).toEqual([]);
});
test('saved availability patterns are retry-safe, private and block pending shift acceptance',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const path=`/workforce/staffing/employees/${f.a.id}/availability-series`,body={requestKey:randomUUID(),pattern:weeklyPattern()};
  const created=await request(f.alice.token,path,body);expect(created.status).toBe(201);expect(created.body.count).toBe(3);
  expect((await request(f.alice.token,path,body)).body.id).toBe(created.body.id);
  expect((await request(f.alice.token,path,{...body,pattern:{...body.pattern,note:'different note'}})).status).toBe(409);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(409);
  expect((await request(f.lead.token,`/workforce/staffing/availability-series/${created.body.id}`)).status).toBe(404);
  const profile=await request(f.alice.token,'/workforce/staffing/profile');expect(profile.body.unavailable).toEqual([]);
  expect(JSON.stringify((await request(f.lead.token,`/workforce/teams/${f.teamId}/dashboard`)).body)).not.toContain(body.pattern.note);
  expect(JSON.stringify(await context.db.select().from(schema.activityLogs))).not.toContain(body.pattern.note);
  const detail=await request(f.alice.token,`/workforce/staffing/availability-series/${created.body.id}`),overlap=detail.body.occurrences.find((o:any)=>o.startAt===instant(3));
  expect((await request(f.alice.token,`/workforce/staffing/unavailable/${overlap.id}/cancel`,{reason:'Available on this date'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})).status).toBe(200);
});
test('stopping a pattern cancels only unstarted dates and never erases prior occurrence history',async()=>{
  const f=await setup(),path=`/workforce/staffing/employees/${f.a.id}/availability-series`,created=await request(f.alice.token,path,{requestKey:randomUUID(),pattern:weeklyPattern()});
  const before=await request(f.alice.token,`/workforce/staffing/availability-series/${created.body.id}`),first=before.body.occurrences[0];
  await context.db.update(schema.workforceUnavailable).set({startAt:new Date(Date.now()-3600000),endAt:new Date(Date.now()+3600000)}).where(eq(schema.workforceUnavailable.id,first.id));
  const stop=`/workforce/staffing/availability-series/${created.body.id}/stop`;expect((await request(f.bob.token,stop,{reason:'Cannot stop another employee'})).status).toBe(404);
  for(let i=0;i<2;i++)expect((await request(f.alice.token,stop,{reason:'Weekly commitment ended'})).status).toBe(200);
  const after=await request(f.alice.token,`/workforce/staffing/availability-series/${created.body.id}`);expect(after.body.occurrences).toHaveLength(3);expect(after.body.occurrences[0].cancelledAt).toBeNull();expect(after.body.occurrences.slice(1).every((o:any)=>o.cancelledAt)).toBe(true);
  expect((await request(f.alice.token,path)).body.series[0].futureCount).toBe(0);
});
test('an availability pattern racing acceptance cannot leave accepted work inside an unavailable period',async()=>{
  const f=await setup(),offer=await request(f.lead.token,`/workforce/shifts/${f.shiftId}/offers`,{employeeId:f.a.id});
  const results=await Promise.all([request(f.alice.token,`/workforce/staffing/employees/${f.a.id}/availability-series`,{requestKey:randomUUID(),pattern:weeklyPattern(3,3)}),request(f.alice.token,`/workforce/assignments/${offer.body.id}/respond`,{decision:'accepted'})]);
  expect(results.filter(r=>r.status===409)).toHaveLength(1);expect(results.filter(r=>[200,201].includes(r.status))).toHaveLength(1);
});
test('renewal reminder windows are dated, configurable per qualification and employee, and scoped',async()=>{
  const f=await setup(),c=await expiryCredential(f,40),body={qualificationId:c.kindId,employeeId:null,effectiveAt:null,config:{...defaultRenewalPolicy,reminderDays:50},reason:'Allow time for annual renewal'};
  expect((await request(f.alice.token,'/workforce/renewals/due')).body.total).toBe(0);
  expect((await request(f.lead.token,'/workforce/renewal-policies',body)).status).toBe(403);
  expect((await request(f.admin.token,'/workforce/renewal-policies',body)).status).toBe(201);
  const due=await request(f.alice.token,'/workforce/renewals/due');expect(due.body.total).toBe(1);expect(due.body.rows[0].reminderDays).toBe(50);
  expect((await request(f.bob.token,'/workforce/renewals/due')).body.total).toBe(0);expect((await request(f.lead.token,'/workforce/renewals/due')).body.total).toBe(0);
  expect((await request(f.alice.token,'/workforce/renewal-policies')).status).toBe(403);
  expect((await request(f.admin.token,'/workforce/renewal-policies',{...body,employeeId:f.a.id,config:{...body.config,reminderDays:10},effectiveAt:instant(1)})).status).toBe(201);
  expect((await request(f.alice.token,'/workforce/renewals/due')).body.total).toBe(1);
  expect((await request(f.admin.token,'/workforce/renewal-policies',{...body,employeeId:f.a.id,config:{...body.config,reminderDays:10}})).status).toBe(201);
  expect((await request(f.alice.token,'/workforce/renewals/due')).body.total).toBe(0);
  expect((await request(f.admin.token,'/workforce/renewal-policies',{...body,effectiveAt:instant(-1)})).status).toBe(400);
});
test('renewal submissions enforce ownership, preserve request identity, and keep pending evidence out of eligibility',async()=>{
  const f=await setup(),c=await expiryCredential(f,-1),path=`/workforce/staffing/qualifications/${c.credentialId}/renew`,body=renewalEvidence();
  expect((await request(f.bob.token,path,body)).status).toBe(404);
  const first=await request(f.alice.token,path,body);expect(first.status).toBe(201);expect((await request(f.alice.token,path,body)).body.id).toBe(first.body.id);
  expect((await request(f.alice.token,path,{...body,note:'Changed request contents'})).status).toBe(409);
  expect((await request(f.alice.token,path,renewalEvidence())).status).toBe(409);
  const due=await request(f.alice.token,'/workforce/renewals/due');expect(due.body.rows[0].requestId).toBe(first.body.id);expect(due.body.rows[0].daysLeft).toBe(-1);
  expect((await request(f.bob.token,'/workforce/renewals?status=all')).body.rows).toEqual([]);
  expect((await request(f.bob.token,`/workforce/renewals/${first.body.id}/history`)).status).toBe(404);
  expect((await context.db.select().from(schema.employeeQualifications))).toHaveLength(1);
  expect(JSON.stringify(await context.db.select().from(schema.activityLogs))).not.toContain(body.reference);
});
test('return, resubmission and independent verification retain the old certificate and complete one linked renewal',async()=>{
  const f=await setup(),c=await expiryCredential(f),body=renewalEvidence(),created=await request(f.alice.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,body),id=created.body.id;
  expect((await request(f.admin.token,`/workforce/renewals/${id}/review`,{version:1,decision:'return',reason:'Please provide the complete certificate'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/renewals/${id}/resubmit`,{version:1,reference:'Updated evidence reference',note:'Complete certificate provided'})).status).toBe(409);
  expect((await request(f.alice.token,`/workforce/renewals/${id}/resubmit`,{version:2,reference:'Updated evidence reference',note:'Complete certificate provided'})).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,body)).body.id).toBe(id);
  const verified=await request(f.admin.token,`/workforce/renewals/${id}/review`,verifyRenewal(3));expect(verified.status).toBe(200);
  expect((await request(f.admin.token,`/workforce/renewals/${id}/review`,verifyRenewal(3))).status).toBe(409);
  const certs=await context.db.select().from(schema.employeeQualifications);expect(certs).toHaveLength(2);expect(certs[0].validThrough).toBe(dayDate(10));expect(certs[0].revokedAt).toBeNull();expect(certs[1].renewsCredentialId).toBe(c.credentialId);
  const history=await request(f.alice.token,`/workforce/renewals/${id}/history`);expect(history.body.map((h:any)=>h.action)).toEqual(['submitted','returned','resubmitted','verified']);
  expect((await request(f.alice.token,'/workforce/renewals/due')).body.total).toBe(0);
});
test('HR cannot verify its own submitted renewal and stale cancellation cannot discard verified evidence',async()=>{
  const f=await setup(),c=await expiryCredential(f),created=await request(f.admin.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,renewalEvidence()),id=created.body.id;
  expect((await request(f.admin.token,`/workforce/renewals/${id}/review`,verifyRenewal())).status).toBe(403);
  expect((await request(f.lead.token,`/workforce/renewals/${id}/review`,verifyRenewal())).status).toBe(403);
  const other=await account('second_hr','hr');expect((await request(other.token,`/workforce/renewals/${id}/review`,verifyRenewal())).status).toBe(200);
  expect((await request(f.alice.token,`/workforce/renewals/${id}/cancel`,{version:1,reason:'Outdated cancellation request'})).status).toBe(409);
});
test('renewal verification rejects revoked source records, invalid extensions and unrelated overlapping evidence',async()=>{
  const f=await setup(),c=await expiryCredential(f),created=await request(f.alice.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,renewalEvidence()),path=`/workforce/renewals/${created.body.id}/review`;
  expect((await request(f.admin.token,path,verifyRenewal(1,11,9))).status).toBe(400);
  const extra=await request(f.admin.token,`/workforce/staffing/employees/${f.a.id}/qualifications`,{qualificationId:c.kindId,validFrom:dayDate(15),validThrough:dayDate(20),verificationReference:'Another verified period'});expect(extra.status).toBe(201);
  expect((await request(f.admin.token,path,verifyRenewal())).status).toBe(409);
  await request(f.admin.token,`/workforce/staffing/qualifications/${c.credentialId}/revoke`,{reason:'Original record withdrawn'});
  expect((await request(f.admin.token,path,verifyRenewal())).status).toBe(409);
  expect((await request(f.admin.token,path,{version:1,decision:'return',reason:'Source verification was revoked; contact HR'})).status).toBe(200);
});
test('continuous verified periods cover overnight shifts but gaps or revocation remain ineligible',()=>{
  const shift={startAt:new Date('2027-10-01T20:00:00Z'),endAt:new Date('2027-10-02T01:00:00Z'),requiredQualifications:[{id:1,name:'Safety'}]},old={qualificationId:1,validFrom:'2027-01-01',validThrough:'2027-10-01',revokedAt:null},renewed={qualificationId:1,validFrom:'2027-10-02',validThrough:'2028-01-01',revokedAt:null};
  expect(missingQualifications(shift,'Asia/Qatar',[old,renewed])).toEqual([]);
  expect(missingQualifications(shift,'Asia/Qatar',[old,{...renewed,validFrom:'2027-10-03'}])).toEqual(['Safety']);
  expect(missingQualifications(shift,'Asia/Qatar',[old,{...renewed,revokedAt:new Date()}])).toEqual(['Safety']);
});
test('a future renewal with a validity gap keeps the expiry reminder visible',async()=>{
  const f=await setup(),c=await expiryCredential(f,-1),created=await request(f.alice.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,renewalEvidence());
  expect((await request(f.admin.token,`/workforce/renewals/${created.body.id}/review`,verifyRenewal(1,2,100))).status).toBe(200);
  const due=await request(f.alice.token,'/workforce/renewals/due');expect(due.body.total).toBe(1);expect(due.body.rows[0].renewedFrom).toBe(dayDate(2));
});
test('renewal history failure rolls back both verification and the new credential',async()=>{
  const f=await setup(),c=await expiryCredential(f),created=await request(f.alice.token,`/workforce/staffing/qualifications/${c.credentialId}/renew`,renewalEvidence());
  await pg.exec("CREATE FUNCTION reject_renewal_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_renewal_history BEFORE INSERT ON workforce_renewal_history FOR EACH ROW EXECUTE FUNCTION reject_renewal_history();");
  try{expect((await request(f.admin.token,`/workforce/renewals/${created.body.id}/review`,verifyRenewal())).status).toBe(500);expect((await context.db.select().from(schema.employeeQualifications))).toHaveLength(1);const [row]=await context.db.select().from(schema.workforceRenewals);expect(row.status).toBe('submitted');expect(row.version).toBe(1);}
  finally{await pg.exec('DROP TRIGGER reject_renewal_history ON workforce_renewal_history; DROP FUNCTION reject_renewal_history();');}
});
