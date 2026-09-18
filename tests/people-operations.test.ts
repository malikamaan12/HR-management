import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/peopleOperations';
import {authService} from '../server/services/auth';
import {qatarToday} from '../server/services/workplaceRecords';
let pg:PGlite,server:Server,base:string;
const reason='Checked supporting evidence';
const day=(offset=0)=>new Date(Date.parse(qatarToday())+offset*86400000).toISOString().slice(0,10);
const hours={low:168,medium:72,high:24};
async function req(token:string,path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function user(name:string,role:schema.UserRole='employee'){
 const [u]=await ctx.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('TestOperations123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();
 const [e]=await ctx.db.insert(schema.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'private-'+name,primaryMobile:'private',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'temporary',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01'}).returning();
 return {...u,employee:e,token:(await authService.login(name,'TestOperations123!')).accessToken};
}
async function fixture(){return {admin:await user('admin','super_admin'),hr:await user('hr','hr'),alice:await user('alice'),bob:await user('bob')};}
async function probation(f:any,extra:any={}){const r=await req(f.admin.token,'/probation',{employeeId:f.alice.employee.id,reviewerId:f.hr.id,startDate:day(-30),dueDate:day(1),objectives:'Complete induction and customer service objectives',reason,...extra});expect(r.status).toBe(201);return r.body;}
async function transfer(f:any,extra:any={}){const r=await req(f.admin.token,'/transfers',{employeeId:f.alice.employee.id,employeeVersion:f.alice.employee.recordVersion,target:{department:'FEC',position:'Team host',location:'Main mall',reportingManagerId:f.bob.employee.id},effectiveDate:day(),reason,...extra});expect(r.status).toBe(201);return r.body;}
async function incident(f:any,extra:any={}){const r=await req(f.alice.token,'/incidents',{teamId:null,title:'Tablet unavailable',location:'Main mall',occurredAt:new Date(Date.now()-60000).toISOString(),category:'equipment',severity:'high',description:'Tablet failed startup; spare device used',...extra});expect(r.status).toBe(201);return r.body;}
beforeAll(async()=>{
 process.env.JWT_SECRET='test-operations-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-operations-refresh-secret-32-characters';
 pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,workforce_sites,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('admin policies validate priorities, reject stale edits and pin limits to cases',async()=>{
 const f=await fixture(),body={version:0,rules:{maxExtensionDays:30,maxExtensions:1,incidentHours:hours},reason};
 expect((await req(f.hr.token,'/policy',body)).status).toBe(403);
 expect((await req(f.admin.token,'/policy',{...body,rules:{...body.rules,incidentHours:{...hours,high:200}}})).status).toBe(400);
 expect((await req(f.admin.token,'/policy',body)).status).toBe(201);
 const p=await probation(f),i=await incident(f);
 expect((await req(f.admin.token,'/policy',body)).status).toBe(409);
 expect((await req(f.admin.token,'/policy',{...body,version:1,rules:{...body.rules,maxExtensionDays:0,maxExtensions:0}})).status).toBe(201);
 expect(p.policy_snapshot.rules.maxExtensionDays).toBe(30);expect(i.policy_snapshot.version).toBe(1);
 expect((Date.parse(i.due_at)-Date.parse(i.created_at))/3600000).toBeCloseTo(24,1);
 expect((await req(f.admin.token,'/policy-history')).body).toHaveLength(2);
 expect((await req(f.alice.token,'/people?q=admin')).status).toBe(403);
});
test('probation requires independent evidence and decision, publishes to the employee and records acknowledgement',async()=>{
 const f=await fixture(),p=await probation(f),path=`/probation/${p.id}/actions`;
 expect((await req(f.alice.token,'/probation')).body.items).toHaveLength(0);
 expect((await req(f.bob.token,`/probation/${p.id}/history`)).status).toBe(404);
 expect((await req(f.admin.token,path,{version:1,action:'confirm',reason})).status).toBe(409);
 expect((await req(f.hr.token,path,{version:1,action:'review',recommendation:'confirm',reason})).body.status).toBe('submitted');
 expect((await req(f.hr.token,path,{version:2,action:'confirm',reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:1,action:'confirm',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,action:'confirm',reason})).body.status).toBe('confirmed');
 expect((await req(f.alice.token,'/probation')).body.items).toHaveLength(1);
 expect((await req(f.alice.token,`/probation/${p.id}/history`)).status).toBe(403);
 expect((await req(f.alice.token,path,{version:3,action:'acknowledge',reason:'Received decision and discussed objectives'})).body.acknowledged_at).toBeTruthy();
 expect((await req(f.alice.token,path,{version:4,action:'acknowledge',reason})).status).toBe(409);
 const e=await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id));expect(e[0].status).toBe('active');
 const events=await ctx.db.select().from(schema.employeeLifecycleEvents);expect(events.map((e:any)=>e.eventType)).toEqual(['probation_completed']);
 expect((await req(f.admin.token,`/probation/${p.id}/history`)).body).toHaveLength(4);
});
test('probation limits, return and reassignment preserve evidence history and enforce current manager access',async()=>{
 const f=await fixture();await ctx.db.update(schema.employees).set({reportingManagerId:f.bob.employee.id}).where(eq(schema.employees.id,f.alice.employee.id));
 const p=await probation(f,{reviewerId:f.bob.id}),path=`/probation/${p.id}/actions`;
 expect((await req(f.bob.token,'/probation')).body.items).toHaveLength(1);
 expect((await req(f.bob.token,path,{version:1,action:'review',recommendation:'extend',reason})).status).toBe(200);
 expect((await req(f.admin.token,path,{version:2,action:'extend',dueDate:day(7),reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:2,action:'return',reason:'Add examples of completed tasks'})).body.status).toBe('open');
 await ctx.db.update(schema.employees).set({reportingManagerId:null}).where(eq(schema.employees.id,f.alice.employee.id));
 expect((await req(f.bob.token,'/probation')).body.items).toHaveLength(0);
 expect((await req(f.bob.token,path,{version:3,action:'review',recommendation:'confirm',reason})).status).toBe(404);
 expect((await req(f.admin.token,path,{version:3,action:'reassign',reviewerId:f.alice.id,reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:3,action:'reassign',reviewerId:f.hr.id,reason})).body.reviewer_id).toBe(f.hr.id);
 expect((await req(f.admin.token,`/probation/${p.id}/history`)).body.some((h:any)=>h.snapshot.review_evidence===reason)).toBe(true);
});
test('saved probation extension allowance remains effective after policy changes and cannot be exceeded',async()=>{
 const f=await fixture();await req(f.admin.token,'/policy',{version:0,rules:{maxExtensionDays:30,maxExtensions:1,incidentHours:hours},reason});const p=await probation(f),path=`/probation/${p.id}/actions`;
 await req(f.admin.token,'/policy',{version:1,rules:{maxExtensionDays:0,maxExtensions:0,incidentHours:hours},reason});
 await req(f.hr.token,path,{version:1,action:'review',recommendation:'extend',reason});
 expect((await req(f.admin.token,path,{version:2,action:'extend',dueDate:day(40),reason})).status).toBe(400);
 const extended=await req(f.admin.token,path,{version:2,action:'extend',dueDate:day(10),reason});expect(extended.body).toMatchObject({status:'open',extension_count:1,review_evidence:null});
 await req(f.hr.token,path,{version:3,action:'review',recommendation:'extend',reason});
 expect((await req(f.admin.token,path,{version:4,action:'extend',dueDate:day(20),reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:4,action:'follow_up',reason})).body.status).toBe('follow_up');
 expect((await ctx.db.select().from(schema.employeeLifecycleEvents))).toHaveLength(0);
});
test('transfer approval and application are independent, atomic and restricted to professional fields',async()=>{
 const f=await fixture(),t=await transfer(f),path=`/transfers/${t.id}/actions`;
 expect((await req(f.alice.token,'/transfers')).body.items).toHaveLength(0);
 expect((await req(f.admin.token,path,{version:1,action:'approve',reason})).status).toBe(403);
 expect((await req(f.alice.token,path,{version:1,action:'approve',reason})).status).toBe(403);
 expect((await req(f.hr.token,path,{version:1,action:'approve',reason})).body.status).toBe('approved');
 expect((await req(f.alice.token,'/transfers')).body.items).toHaveLength(1);
 const applied=await req(f.admin.token,path,{version:2,action:'apply',reason});expect(applied.body.status).toBe('applied');
 const [e]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id));expect(e).toMatchObject({department:'FEC',position:'Team host',location:'Main mall',reportingManagerId:f.bob.employee.id,qidNumber:'private-alice',type:'temporary'});expect(e.recordVersion).toBe(f.alice.employee.recordVersion+1);
 expect((await req(f.admin.token,path,{version:3,action:'apply',reason})).status).toBe(409);
 const h=await req(f.admin.token,`/transfers/${t.id}/history`);expect(h.body).toHaveLength(3);expect(JSON.stringify(h.body)).not.toContain('private-alice');
 expect((await ctx.db.select().from(schema.employeeLifecycleEvents))[0].eventType).toBe('transfer');
});
test('future transfers and stale employee proposals cannot overwrite newer profile changes',async()=>{
 const f=await fixture(),t=await transfer(f,{effectiveDate:day(10)}),path=`/transfers/${t.id}/actions`;
 await req(f.hr.token,path,{version:1,action:'approve',reason});expect((await req(f.admin.token,path,{version:2,action:'apply',reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:2,action:'cancel',reason})).body.status).toBe('cancelled');
 const next=await transfer(f),nextPath=`/transfers/${next.id}/actions`;await req(f.hr.token,nextPath,{version:1,action:'approve',reason});
 await ctx.db.update(schema.employees).set({position:'Senior Host'}).where(eq(schema.employees.id,f.alice.employee.id));
 expect((await req(f.admin.token,nextPath,{version:2,action:'apply',reason})).status).toBe(409);
 expect((await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id)))[0].position).toBe('Senior Host');
});
test('transfer hierarchy checks run again on application and duplicate active proposals are blocked',async()=>{
 const f=await fixture(),t=await transfer(f),path=`/transfers/${t.id}/actions`;
 const duplicate=await req(f.admin.token,'/transfers',{employeeId:f.alice.employee.id,employeeVersion:1,target:t.to_snapshot,effectiveDate:day(),reason});expect(duplicate.status).toBe(409);
 await req(f.hr.token,path,{version:1,action:'approve',reason});
 await ctx.db.update(schema.employees).set({secondaryManagerId:f.alice.employee.id}).where(eq(schema.employees.id,f.bob.employee.id));
 expect((await req(f.admin.token,path,{version:2,action:'apply',reason})).status).toBe(400);
 expect((await ctx.db.select().from(schema.employeeLifecycleEvents))).toHaveLength(0);
});
test('incident reporter, eligible handler and independent HR complete and reopen a case without employment effects',async()=>{
 const f=await fixture(),i=await incident(f),path=`/incidents/${i.id}/actions`;
 expect((await req(f.bob.token,'/incidents')).body.items).toHaveLength(0);expect((await req(f.bob.token,`/incidents/${i.id}/history`)).status).toBe(404);
 expect((await req(f.alice.token,path,{version:1,action:'assign',handlerId:f.hr.id,correctiveAction:reason,reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:1,action:'assign',handlerId:f.bob.id,correctiveAction:reason,reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:1,action:'assign',handlerId:f.hr.id,correctiveAction:'Replace tablet and verify charging',reason})).body.status).toBe('in_progress');
 expect((await req(f.admin.token,path,{version:2,action:'resolve',reason})).status).toBe(403);
 expect((await req(f.hr.token,path,{version:2,action:'resolve',reason})).body.status).toBe('resolved');
 expect((await req(f.hr.token,path,{version:3,action:'close',reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:3,action:'close',reason})).body.status).toBe('closed');
 expect((await req(f.alice.token,`/incidents/${i.id}/history`)).body).toHaveLength(4);
 expect((await req(f.admin.token,path,{version:4,action:'reopen',reason})).body).toMatchObject({status:'open',handler_id:null,resolution:null});
 expect((await ctx.db.select().from(schema.employeeLifecycleEvents))).toHaveLength(0);
});
test('incident team selection and handler access respect active membership and revoked grants',async()=>{
 const f=await fixture();const [site]=await ctx.db.insert(schema.workforceSites).values({name:'Main mall',timezone:'Asia/Qatar'}).returning();const [team]=await ctx.db.insert(schema.workforceTeams).values({name:'FEC team',kind:'fec',siteId:site.id}).returning();
 const startAt=new Date(Date.now()-86400000),endAt=new Date(Date.now()+86400000);
 await ctx.db.insert(schema.workforceMembers).values({teamId:team.id,employeeId:f.alice.employee.id,startAt,endAt});
 const [grant]=await ctx.db.insert(schema.workforceGrants).values({teamId:team.id,userId:f.bob.id,permission:'schedule',startAt,endAt}).returning();
 const i=await incident(f,{teamId:team.id}),path=`/incidents/${i.id}/actions`;
 expect((await req(f.bob.token,'/incidents')).body.items).toHaveLength(0);
 await req(f.admin.token,path,{version:1,action:'assign',handlerId:f.bob.id,correctiveAction:reason,reason});
 expect((await req(f.bob.token,'/incidents')).body.items).toHaveLength(1);
 await ctx.db.update(schema.workforceGrants).set({revokedAt:new Date()}).where(eq(schema.workforceGrants.id,grant.id));
 expect((await req(f.bob.token,'/incidents')).body.items).toHaveLength(0);
 expect((await req(f.bob.token,path,{version:2,action:'resolve',reason})).status).toBe(404);
 expect((await req(f.bob.token,'/incidents',{teamId:team.id,title:'Invalid team incident',location:'Main mall',occurredAt:startAt.toISOString(),category:'service',severity:'low',description:reason})).status).toBe(403);
});
test('audit failure rolls back transfer profile changes and incident state changes',async()=>{
 const f=await fixture(),t=await transfer(f),path=`/transfers/${t.id}/actions`;await req(f.hr.token,path,{version:1,action:'approve',reason});const i=await incident(f);
 await pg.exec("CREATE FUNCTION fail_people_audit() RETURNS trigger AS $$ BEGIN IF NEW.kind IN ('people_transfers','people_incidents') THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_people_audit BEFORE INSERT ON lifecycle_history FOR EACH ROW EXECUTE FUNCTION fail_people_audit();");
 try{
  expect((await req(f.admin.token,path,{version:2,action:'apply',reason})).status).toBe(500);
  expect((await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id)))[0].department).toBe('Operations');
  expect((await ctx.db.select().from(schema.employeeLifecycleEvents))).toHaveLength(0);
  expect((await req(f.admin.token,`/incidents/${i.id}/actions`,{version:1,action:'assign',handlerId:f.hr.id,correctiveAction:reason,reason})).status).toBe(500);
  expect((await req(f.alice.token,'/incidents')).body.items[0].status).toBe('open');
 }finally{await pg.exec('DROP TRIGGER fail_people_audit ON lifecycle_history; DROP FUNCTION fail_people_audit();');}
});
