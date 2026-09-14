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
beforeEach(async()=>{await pg.exec('TRUNCATE workforce_sites, users, employees RESTART IDENTITY CASCADE');});
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
