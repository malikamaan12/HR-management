import {readFileSync,readdirSync} from 'node:fs';
import type {Server} from 'node:http';
import {beforeAll,beforeEach,afterAll,expect,test,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
import {canOpenPage} from '../shared/page-access';
const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import {registerRoutes} from '../server/routes';
import {authService} from '../server/services/auth';

let pg:PGlite,server:Server,base:string;
const tokens:Record<string,string>={};
const roles=['super_admin','event_manager','temporary_staff','employee','manager'] as const;
const person=(id:number,userId?:number,type:'permanent'|'temporary'='permanent')=>({id,userId,employeeId:`REL-${id}`,firstName:'Review',lastName:String(id),gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:String(10000000000+id),primaryMobile:'test',residentialAddress:'private address',emergencyContactName:'private name',emergencyContactNumber:'test',type,department:'Operations',position:'Host',location:'Mall',joiningDate:'2026-01-01'});
async function request(path:string,role='super_admin',method='GET',body?:unknown){
 const response=await fetch(base+'/api'+path,{method,headers:{...(role?{Authorization:'Bearer '+tokens[role]}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,headers:response.headers};
}
beforeAll(async()=>{
 process.env.JWT_SECRET='release-access-test-secret-32-characters';process.env.JWT_REFRESH_SECRET='release-refresh-test-secret-32-characters';
 pg=new PGlite();for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 context.db=drizzle(pg);const app=express();app.use(express.json());server=await registerRoutes(app);server.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{
 await pg.exec('TRUNCATE users, employees, onboarding_checklists RESTART IDENTITY CASCADE');
 const password=await bcrypt.hash('ReleaseTest8!',4);
 for(const role of roles){await context.db.insert(schema.users).values({username:role,email:role+'@example.test',password,firstName:role,lastName:'Test',role,isActive:true,approvalStatus:'approved',department:'Operations'});tokens[role]=(await authService.login(role,'ReleaseTest8!')).accessToken;}
 await context.db.insert(schema.employees).values([person(10,1),person(20,2),person(30,3,'temporary'),person(40,4),person(50,5),{...person(60),reportingManagerId:50},person(70,undefined,'temporary')]);
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();});

async function eventFixture(){
 const [event]=await context.db.insert(schema.events).values({name:'Release test event',startDate:'2026-10-01',endDate:'2026-10-01',location:'Mall',createdBy:1}).returning();
 const [roster]=await context.db.insert(schema.eventRosters).values({eventId:event.id,rosterName:'Opening roster'}).returning();
 const [message]=await context.db.insert(schema.eventCommunications).values({eventId:event.id,senderId:1,messageType:'announcement',subject:'Briefing',content:'Private briefing'}).returning();
 const assignments:any[]=[];
 for(const employeeId of [30,40]){
  await context.db.insert(schema.eventStaffProfiles).values({employeeId,availability:{},notes:'Private profile '+employeeId});
  const [assignment]=await context.db.insert(schema.eventStaffAssignments).values({eventId:event.id,employeeId,role:'Host',startTime:new Date('2026-10-01T09:00:00Z'),endTime:new Date('2026-10-01T17:00:00Z'),status:'assigned'}).returning();assignments.push(assignment);
  await context.db.insert(schema.eventStaffPerformance).values({assignmentId:assignment.id,ratedBy:10,rating:'good',punctualityRating:4,attitudeRating:4,skillRating:4});
  await context.db.insert(schema.eventCommunicationRecipients).values({communicationId:message.id,recipientId:employeeId});
 }
 return {event,roster,message,assignments};
}
async function onboardingFixture(){
 const [checklist]=await context.db.insert(schema.onboardingChecklists).values({name:'Release checklist'}).returning();
 await context.db.insert(schema.checklistTasks).values({checklistId:checklist.id,taskName:'Collect evidence',category:'first_day',assignedTo:'hr',daysFromStart:0});
 const created=await request('/employee-onboarding','super_admin','POST',{employeeId:40,checklistId:checklist.id,startDate:'2026-10-01'});expect(created.status).toBe(201);
 return {checklist,row:created.body};
}

test('real route registration rejects anonymous requests and prevents caching of denied HR responses',async()=>{
 const r=await request('/event-staff-profiles','');expect(r.status).toBe(401);expect(r.headers.get('cache-control')).toBe('no-store');
 const denied=await request('/events','employee');expect(denied.status).toBe(403);expect(denied.headers.get('cache-control')).toBe('no-store');
});

test('case variations and HEAD cannot bypass management permission checks',async()=>{
 for(const path of ['/EVENTS','/Candidates','/Dashboard-Stats','/ONBOARDING-STATS','/ACTIVITY-LOGS/recent','/Reporting/dashboard/stats']){
  expect((await request(path,'employee')).status,path).toBe(403);
  expect((await request(path,'employee','HEAD')).status,path+' HEAD').toBe(403);
 }
});

test('employee subresources enforce self and actual reporting relationships for decoded IDs',async()=>{
 for(const suffix of ['leaves','leave-balances','shift-schedules']){
  expect((await request(`/EMPLOYEES/%34%30/${suffix}`,'employee')).status,suffix).toBe(200);
  expect((await request(`/employees/%36%30/${suffix}`,'employee')).status,suffix).toBe(404);
  expect((await request(`/employees/60/${suffix}`,'manager')).status,suffix).toBe(200);
  expect((await request(`/employees/40/${suffix}`,'manager')).status,suffix).toBe(404);
  expect((await request(`/employees/60junk/${suffix}`,'employee')).status,suffix).toBe(400);
  expect((await request(`/employees/60%2Fextra/${suffix}`,'employee')).status,suffix).toBe(400);
 }
});

test('event employee profile aliases protect self, other employees and out-of-scope permanent staff',async()=>{
 await eventFixture();
 expect((await request('/employees/%33%30/event-staff-profile','temporary_staff')).body.employeeId).toBe(30);
 expect((await request('/employees/%34%30/EVENT-STAFF-PROFILE','temporary_staff')).status).toBe(404);
 expect((await request('/employees/40/event-staff-profile','event_manager')).status).toBe(404);
 expect((await request('/employees/30/event-staff-profile','employee')).status).toBe(404);
 expect((await request('/employees/30junk/event-staff-profile','temporary_staff')).status).toBe(400);
});

test('event collections apply employee scope to profiles, assignments, rosters, ratings and recipients',async()=>{
 const f=await eventFixture();
 for(const path of ['/event-staff-profiles','/event-staff-assignments',`/events/${f.event.id}/staff`,`/event-rosters/${f.roster.id}/assignments`,'/event-staff-performance',`/event-communications/${f.message.id}/recipients`]){
  const scoped=await request(path,'event_manager');expect(scoped.status,path).toBe(200);expect(scoped.body,path).toHaveLength(1);
  const all=await request(path);expect(all.status,path).toBe(200);expect(all.body,path).toHaveLength(2);
 }
 expect((await request('/event-staff-performance?employeeId=40','event_manager')).body).toEqual([]);
});

test('event manager cannot create records for a permanent employee outside event scope',async()=>{
 const f=await eventFixture();
 expect((await request('/event-staff-profiles','event_manager','POST',{employeeId:40,availability:{}})).status).toBe(404);
 expect((await request('/event-staff-assignments','event_manager','POST',{employeeId:40,eventId:f.event.id,role:'Host',startTime:'2026-10-02T09:00:00Z',endTime:'2026-10-02T17:00:00Z',status:'assigned'})).status).toBe(404);
 expect((await request('/event-communication-recipients','event_manager','POST',{recipientId:40,communicationId:f.message.id})).status).toBe(404);
 expect((await request('/event-staff-performance','event_manager','POST',{assignmentId:f.assignments[1].id,ratedBy:10,rating:'good',punctualityRating:4,attitudeRating:4,skillRating:4})).status).toBe(404);
});

test('ratings identify the signed-in reviewer, validate scores and reject self-review',async()=>{
 const f=await eventFixture(),input={assignmentId:f.assignments[0].id,ratedBy:10,rating:'good',punctualityRating:4,attitudeRating:4,skillRating:4};
 const rated=await request('/event-staff-performance','event_manager','POST',input);expect(rated.status).toBe(201);expect(rated.body.ratedBy).toBe(20);
 expect((await request('/event-staff-performance','event_manager','POST',{...input,skillRating:99})).status).toBe(400);
 await context.db.update(schema.employees).set({type:'temporary'}).where(eq(schema.employees.id,20));
 await context.db.update(schema.eventStaffAssignments).set({employeeId:20}).where(eq(schema.eventStaffAssignments.id,input.assignmentId));
 expect((await request('/event-staff-performance','event_manager','POST',input)).status).toBe(403);
});

test('event records cannot spoof authors, creators or recipient acknowledgements',async()=>{
 const f=await eventFixture();
 const message=await request('/event-communications','event_manager','POST',{eventId:f.event.id,senderId:1,messageType:'announcement',subject:'Test',content:'Saved in app only'});
 expect(message.status).toBe(201);expect(message.body.senderId).toBe(2);
 const recipient=await request('/event-communication-recipients','event_manager','POST',{communicationId:message.body.id,recipientId:30,isRead:true,readAt:'2026-10-01T10:00:00Z'});
 expect(recipient.status).toBe(201);expect(recipient.body).toMatchObject({isRead:false,readAt:null});
 expect((await request('/events/'+f.event.id,'event_manager','PATCH',{createdBy:2})).status).toBe(400);
 expect((await request('/events/'+f.event.id)).body.createdBy).toBe(1);
});

test('unversioned recruitment and approval endpoints no longer reach legacy storage writes',async()=>{
 for(const path of ['/job-applications/1','/JOB-APPLICATIONS/%31','/checklist-tasks/1','/candidates/1'])expect((await request(path,'super_admin','PUT',{status:'completed',approvedBy:10,version:900})).status,path).toBe(409);
 expect((await request('/leave-approvals','super_admin','POST',{leaveId:1,approverId:10,status:'approved'})).status).toBe(409);
 const unknown=await request('/not-a-real-endpoint');expect(unknown.status).toBe(404);expect(unknown.headers.get('content-type')).toContain('application/json');
});

test('onboarding notes preserve employee, template, progress and dates with current revision and private history',async()=>{
 const {row}=await onboardingFixture(),path='/employee-onboarding/'+row.id;
 const input={expectedUpdatedAt:row.updatedAt,action:'notes',notes:'Private onboarding notes',reason:'Clarify the handover owner'};
 const changed=await request(path,'super_admin','PUT',input);expect(changed.status).toBe(200);expect(changed.body).toMatchObject({employeeId:40,checklistId:row.checklistId,status:'in_progress',progress:0,startDate:'2026-10-01',notes:input.notes});
 expect((await request(path,'super_admin','PUT',input)).status).toBe(409);
 const list=await request('/employee-onboarding');expect(list.body[0].updatedAt).toBe(changed.body.updatedAt);expect(list.body[0].checklistId).toBe(row.checklistId);
 const history=await request(path+'/history');expect(history.body[0]).toMatchObject({actor_id:1,reason:input.reason,snapshot:{before:{notes:null},after:{notes:input.notes}}});
 expect((await request(path+'/history','employee')).status).toBe(403);
});

test('onboarding cannot be completed or reassigned through the old editor; cancellation closes task changes',async()=>{
 const {row}=await onboardingFixture(),path='/employee-onboarding/'+row.id;
 const input={expectedUpdatedAt:row.updatedAt,action:'cancel',notes:'Process paused',reason:'Offer no longer going ahead'};
 for(const extra of [{status:'completed'},{employeeId:30},{checklistId:999},{progress:100},{startDate:'2026-11-01'}])expect((await request(path,'super_admin','PUT',{...input,...extra})).status).toBe(400);
 expect((await request(path,'employee','PUT',input)).status).toBe(403);
 expect((await request(path,'super_admin','PUT',{...input,reason:''})).status).toBe(400);
 const cancelled=await request(path,'super_admin','PUT',input);expect(cancelled.status).toBe(200);expect(cancelled.body.status).toBe('cancelled');
 const detail=await request(path),task=detail.body.tasks[0];
 expect((await request('/onboarding-tasks/'+task.id,'super_admin','PUT',{expectedVersion:task.version,status:'completed',comments:'Attempt after cancellation',assigneeId:null,dueDate:task.dueDate})).status).toBe(409);
 expect((await request(path,'super_admin','PUT',{...input,expectedUpdatedAt:cancelled.body.updatedAt,action:'notes'})).status).toBe(409);
});

test('onboarding note changes roll back when audit evidence cannot be saved',async()=>{
 const {row}=await onboardingFixture(),path='/employee-onboarding/'+row.id;
 await pg.exec("CREATE FUNCTION reject_onboarding_edit() RETURNS trigger AS $$ BEGIN IF NEW.kind='onboarding_edit' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_onboarding_edit BEFORE INSERT ON lifecycle_history FOR EACH ROW EXECUTE FUNCTION reject_onboarding_edit();");
 try{
  expect((await request(path,'super_admin','PUT',{expectedUpdatedAt:row.updatedAt,action:'cancel',notes:'Do not persist',reason:'Audit failure regression'})).status).toBe(500);
  expect((await request(path)).body).toMatchObject({status:'in_progress',notes:null,updatedAt:row.updatedAt});
 }finally{await pg.exec('DROP TRIGGER reject_onboarding_edit ON lifecycle_history; DROP FUNCTION reject_onboarding_edit();');}
});

test('page affordances preserve self-service and hide organization-only tools from restricted roles',()=>{
 for(const role of ['employee','temporary_staff','manager','event_manager'] as const){
  for(const page of ['/settings','/user-management','/bulk-import','/recruitment','/onboarding','/reports','/return-to-work','/exit-templates'])expect(canOpenPage(role,page),role+page).toBe(false);
  for(const page of ['/','/workforce','/helpdesk/12','/account','/timesheets','/contracts'])expect(canOpenPage(role,page),role+page).toBe(true);
 }
 expect(canOpenPage('event_manager','/event-staff')).toBe(true);expect(canOpenPage('temporary_staff','/event-staff')).toBe(false);
 expect(canOpenPage('hr','/bulk-import')).toBe(false);expect(canOpenPage('hr','/onboarding')).toBe(true);
 for(const page of ['/settings','/bulk-import','/onboarding','/reports','/return-to-work'])expect(canOpenPage('super_admin',page)).toBe(true);
 expect(canOpenPage(undefined,'/')).toBe(false);
});
