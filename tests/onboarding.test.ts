import offboardingRouter from '../server/routes/offboarding';
import handoffRouter from '../server/routes/recruitmentHandoff';
import {jobOffers,jobApplications,candidates,jobRequisitions} from '../shared/schema';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import {employees,users,onboardingChecklists,checklistTasks,onboardingTasks,employeeOnboarding,type InsertEmployee} from '../shared/schema';
const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import router from '../server/routes/onboarding';
import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string,token:string,employeeToken:string;
const input = (index = 1): InsertEmployee => ({ employeeId: `EMP-${String(index).padStart(4, '0')}`, firstName: 'Person', lastName: String(index).padStart(4, '0'),
  gender: 'female', dateOfBirth: '1990-05-13', nationality: 'Test', qidNumber: String(10000000000 + index), primaryMobile: 'private-phone',
  residentialAddress: 'private-address', emergencyContactName: 'private-contact', emergencyContactNumber: 'private-emergency', personalEmail: 'private@example.test',
  religion: 'other', bloodGroup: 'a_positive', ibanNumber: 'private-bank', type: 'permanent', department: 'Operations', position: 'Host', location: 'Mall FEC', joiningDate: '2026-05-01' });

async function request(path:string,method='GET',body?:unknown,auth=token){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json() as any};}
beforeAll(async()=>{
 process.env.JWT_SECRET='onboarding-test-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='onboarding-test-refresh-secret-32-characters';
 pg=new PGlite();for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 context.db=drizzle(pg);const app=express();app.use(express.json());app.use('/offboarding',offboardingRouter);app.use(authenticate,moduleAccess,handoffRouter,router);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('TRUNCATE users, employees, onboarding_checklists RESTART IDENTITY CASCADE');for(const role of ['super_admin','employee']){await context.db.insert(users).values({username:role,email:role+'@example.test',password:await bcrypt.hash('OnboardingTest8!',4),firstName:role,lastName:'Test',role,isActive:true,approvalStatus:'approved'});const auth=(await authService.login(role,'OnboardingTest8!')).accessToken;if(role==='super_admin')token=auth;else employeeToken=auth;}});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();});
async function setup(){const [employee]=await context.db.insert(employees).values(input()).returning();const [checklist]=await context.db.insert(onboardingChecklists).values({name:'Starter checklist'}).returning();await context.db.insert(checklistTasks).values([{checklistId:checklist.id,taskName:'Equipment',category:'first_day',assignedTo:'it',daysFromStart:0},{checklistId:checklist.id,taskName:'Welcome',category:'pre_joining',assignedTo:'hr',daysFromStart:-1}]);return {employee,checklist,payload:{employeeId:employee.id,checklistId:checklist.id,startDate:'2026-10-01',status:'in_progress'}};}
test('offboarding gates completion on asset evidence and atomically disables the linked account',async()=>{
 const [departing]=await context.db.insert(employees).values({...input(),userId:2}).returning();
 const [owner]=await context.db.insert(employees).values(input(2)).returning();
 const task={title:'Return laptop A001',kind:'asset',ownerId:owner.id,dueDate:'2026-10-01',status:'pending',notes:''};
 const inputCase={employeeId:departing.id,reason:'Approved exit checklist',tasks:[task]};
 expect((await request('/offboarding','POST',inputCase,employeeToken)).status).toBe(403);
 const created=await request('/offboarding','POST',inputCase);expect(created.status).toBe(201);const path='/offboarding/'+created.body.id+'/actions';
 expect((await request('/offboarding','POST',inputCase)).status).toBe(409);
 expect((await request(path,'POST',{action:'complete',version:1,deactivateAccount:true,reason:'Clearance completed'})).status).toBe(409);
 expect((await request(path,'POST',{action:'task',version:1,index:0,task:{...task,status:'done'}})).status).toBe(400);
 expect((await request(path,'POST',{action:'task',version:1,index:0,task:{...task,status:'done',notes:'Received by IT in good condition'}})).status).toBe(200);
 expect((await request(path,'POST',{action:'complete',version:1,deactivateAccount:true,reason:'Clearance completed'})).status).toBe(409);
 const completed=await request(path,'POST',{action:'complete',version:2,deactivateAccount:true,reason:'Clearance completed'});expect(completed.body).toMatchObject({status:'completed',account_deactivated:true});
 expect((await pg.query('SELECT is_active FROM users WHERE id=2')).rows[0].is_active).toBe(false);
 expect((await pg.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id=2 AND is_active=true')).rows[0].n).toBe(0);
 expect((await request(path,'POST',{action:'cancel',version:3,reason:'Late cancellation'})).status).toBe(409);
});
test('offboarding audit failure preserves account access and open case; self-offboarding is denied',async()=>{
 const [departing]=await context.db.insert(employees).values({...input(),userId:2}).returning();
 const [owner]=await context.db.insert(employees).values({...input(2),userId:1}).returning();
 const task={title:'Clear access inventory',kind:'checklist',ownerId:owner.id,dueDate:'2026-10-01',status:'pending',notes:''};
 expect((await request('/offboarding','POST',{employeeId:owner.id,reason:'My own exit',tasks:[{...task,ownerId:departing.id}]})).status).toBe(403);
 const created=await request('/offboarding','POST',{employeeId:departing.id,reason:'Approved exit',tasks:[task]});const path='/offboarding/'+created.body.id+'/actions';
 await request(path,'POST',{action:'task',version:1,index:0,task:{...task,status:'done',notes:'Reviewed inventory with IT'}});
 await pg.exec("CREATE FUNCTION fail_exit_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_exit_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_exit_audit();");
 try{expect((await request(path,'POST',{action:'complete',version:2,deactivateAccount:true,reason:'Exit approved'})).status).toBe(500);expect((await pg.query('SELECT is_active FROM users WHERE id=2')).rows[0].is_active).toBe(true);expect((await request('/offboarding')).body.items[0]).toMatchObject({status:'open',version:2});}finally{await pg.exec('DROP TRIGGER fail_exit_audit ON activity_logs; DROP FUNCTION fail_exit_audit();');}
 expect((await request(path,'POST',{action:'cancel',version:2,reason:'Exit postponed by HR'})).body.status).toBe('cancelled');
});
async function hiringFixture(){
 const {employee}=await setup();
 const [candidate]=await context.db.insert(candidates).values({fullNameEn:'Person 0001',email:'person@example.test',phone:'test',qidNumber:employee.qidNumber,source:'other'}).returning();
 const [requisition]=await context.db.insert(jobRequisitions).values({requisitionId:'REQ-1',jobTitle:'Host',department:'Operations',location:'Mall',positionType:'permanent',numberOfVacancies:1,jobDescription:'Host',qualifications:'Experience',responsibilities:'Support',requiredSkills:'Service',requestedBy:employee.id}).returning();
 const [application]=await context.db.insert(jobApplications).values({candidateId:candidate.id,requisitionId:requisition.id,applicationDate:'2026-09-01',status:'offer'}).returning();
 const [offer]=await context.db.insert(jobOffers).values({applicationId:application.id,offerDate:'2026-09-02',salary:1000,expiryDate:'2026-10-01',status:'accepted',acceptanceDate:'2026-09-03',createdBy:employee.id}).returning();
 return {offer,employee,payload:{employeeId:employee.id,expectedEmployeeVersion:employee.recordVersion,offerUpdatedAt:offer.updatedAt.toISOString(),applicationUpdatedAt:application.updatedAt.toISOString(),reason:'Identity and accepted offer verified'}};
}
test('accepted hiring handoff is audited, retry-safe and rejects identity mismatch',async()=>{
 const {offer,employee,payload}=await hiringFixture();const path='/job-offers/'+offer.id+'/handoff';
 expect((await request(path,'POST',payload,employeeToken)).status).toBe(403);
 const [other]=await context.db.insert(employees).values(input(2)).returning();
 expect((await request(path,'POST',{...payload,employeeId:other.id,expectedEmployeeVersion:other.recordVersion})).status).toBe(400);
 expect((await request(path,'POST',{...payload,expectedEmployeeVersion:999})).status).toBe(409);
 expect((await request(path,'POST',payload)).body).toMatchObject({employeeId:employee.id,alreadyLinked:false});
 expect((await request(path,'POST',payload)).body.alreadyLinked).toBe(true);
 expect((await request(path)).body.handoff.employeeId).toBe(employee.id);
 expect((await context.db.select().from(jobApplications))[0].status).toBe('hired');
 expect((await pg.query('SELECT * FROM recruitment_handoffs')).rows).toHaveLength(1);
 await expect(pg.exec("UPDATE job_offers SET status='declined'")).rejects.toThrow();
});
test('hiring handoff requires acceptance and rolls back application status on audit failure',async()=>{
 const {offer,payload}=await hiringFixture();const path='/job-offers/'+offer.id+'/handoff';
 await pg.exec("UPDATE job_offers SET status='pending'");
 expect((await request(path,'POST',payload)).status).toBe(409);
 await pg.exec("UPDATE job_offers SET status='accepted'");
 await pg.exec("CREATE FUNCTION fail_handoff_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_handoff_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_handoff_audit();");
 try{expect((await request(path,'POST',payload)).status).toBe(500);expect((await pg.query('SELECT * FROM recruitment_handoffs')).rows).toHaveLength(0);expect((await context.db.select().from(jobApplications))[0].status).toBe('offer');}finally{await pg.exec('DROP TRIGGER fail_handoff_audit ON activity_logs; DROP FUNCTION fail_handoff_audit();');}
});
test('template edits preserve existing employee tasks and apply only to new onboarding',async()=>{
 const {payload,checklist}=await setup();const original=await request('/employee-onboarding','POST',payload);
 const change={name:'Updated template',description:'New starter process',departmentSpecific:'',employeeTypeSpecific:'',expectedVersion:1,reason:'Revised starter process',tasks:[{taskName:'Security induction',description:'Introduction',category:'first_day',assignedTo:'hr',daysFromStart:2,isRequired:true}]};
 expect((await request('/onboarding-checklists/'+checklist.id,'PUT',change,employeeToken)).status).toBe(403);
 expect((await request('/onboarding-checklists/'+checklist.id,'PUT',change)).status).toBe(200);
 expect((await request('/onboarding-checklists/'+checklist.id,'PUT',change)).status).toBe(409);
 const old=await request('/employee-onboarding/'+original.body.id);expect(old.body.tasks.map((t:any)=>t.taskName).sort()).toEqual(['Equipment','Welcome']);
 expect((await request('/onboarding-checklists/'+checklist.id)).body.tasks.map((t:any)=>t.taskName)).toEqual(['Security induction']);
 const [second]=await context.db.insert(employees).values(input(2)).returning();const next=await request('/employee-onboarding','POST',{...payload,employeeId:second.id});
 const detail=await request('/employee-onboarding/'+next.body.id);expect(detail.body.tasks[0]).toMatchObject({taskName:'Security induction',dueDate:'2026-10-03'});
 expect((await request('/onboarding-checklists/'+checklist.id+'/history')).body.map((v:any)=>v.version)).toEqual([2,1]);
 expect((await request('/checklist-tasks','POST',{checklistId:checklist.id})).status).toBe(409);
});
test('template and all tasks save together and roll back if version history fails',async()=>{
 const data={name:'Atomic starter',description:'Starter tasks',departmentSpecific:'',employeeTypeSpecific:'',expectedVersion:0,reason:'Initial process approved',tasks:[{taskName:'Welcome',description:'Introduction',category:'first_day',assignedTo:'hr',daysFromStart:0,isRequired:true}]};
 expect((await request('/onboarding-checklists','POST',{...data,tasks:[]})).status).toBe(400);
 const made=await request('/onboarding-checklists','POST',data);expect(made.status).toBe(201);
 expect((await request('/onboarding-checklists/'+made.body.id)).body.tasks).toHaveLength(1);
 await pg.exec("CREATE FUNCTION fail_template_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_template_history BEFORE INSERT ON onboarding_template_versions FOR EACH ROW EXECUTE FUNCTION fail_template_history();");
 try{expect((await request('/onboarding-checklists/'+made.body.id,'PUT',{...data,expectedVersion:1,name:'Changed name'})).status).toBe(500);const unchanged=(await request('/onboarding-checklists/'+made.body.id)).body;expect(unchanged).toMatchObject({version:1,name:'Atomic starter'});expect(unchanged.tasks).toHaveLength(1);}finally{await pg.exec('DROP TRIGGER fail_template_history ON onboarding_template_versions; DROP FUNCTION fail_template_history();');}
});
test('onboarding starts atomically with real identities and rejects duplicate, empty and forged requests',async()=>{
 const {payload,employee,checklist}=await setup();
 expect((await request('/employee-onboarding','POST',payload,employeeToken)).status).toBe(403);
 expect((await request('/employee-onboarding','POST',{...payload,startDate:'2026-02-30'})).status).toBe(400);
 expect((await request('/employee-onboarding','POST',{...payload,progress:100})).status).toBe(400);
 const made=await request('/employee-onboarding','POST',payload);expect(made.status).toBe(201);
 expect((await request('/employee-onboarding','POST',payload)).status).toBe(409);
 const detail=await request('/employee-onboarding/'+made.body.id);expect(detail.body.employeeName).toBe(employee.firstName+' '+employee.lastName);expect(detail.body.employeeEmail).toBeNull();expect(detail.body.tasks.map((t:any)=>t.dueDate).sort()).toEqual(['2026-09-30','2026-10-01']);
});
test('task updates reconcile progress, clear completion on reopen and reject stale or unauthorized changes',async()=>{
 const {payload}=await setup();const made=await request('/employee-onboarding','POST',payload);let tasks=(await request('/onboarding-tasks')).body;
 const update={expectedVersion:1,status:'completed',comments:'Checked by HR',assigneeId:null,dueDate:'2026-10-01'};
 expect((await request('/onboarding-tasks/'+tasks[0].id,'PUT',update,employeeToken)).status).toBe(403);
 expect((await request('/onboarding-tasks/'+tasks[0].id,'PUT',{...update,assigneeId:999})).status).toBe(400);
 expect((await request('/onboarding-tasks/'+tasks[0].id,'PUT',update)).status).toBe(200);
 expect((await request('/onboarding-tasks/'+tasks[0].id,'PUT',update)).status).toBe(409);
 expect((await request('/employee-onboarding/'+made.body.id)).body.progress).toBe(50);
 expect((await request('/onboarding-tasks/'+tasks[1].id,'PUT',update)).status).toBe(200);
 expect((await request('/employee-onboarding/'+made.body.id)).body.status).toBe('completed');
 const reopened=await request('/onboarding-tasks/'+tasks[0].id,'PUT',{...update,expectedVersion:2,status:'in_progress'});expect(reopened.body.completedDate).toBeNull();
 expect((await request('/employee-onboarding/'+made.body.id)).body).toMatchObject({progress:50,status:'in_progress',endDate:null});
});
test('failed audit rolls back checklist creation and task progress together',async()=>{
 const {payload}=await setup();
 await pg.exec("CREATE FUNCTION fail_onboard_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_onboard_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_onboard_audit();");
 try{expect((await request('/employee-onboarding','POST',payload)).status).toBe(500);expect(await context.db.select().from(employeeOnboarding)).toHaveLength(0);expect(await context.db.select().from(onboardingTasks)).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER fail_onboard_audit ON activity_logs; DROP FUNCTION fail_onboard_audit();');}
 const made=await request('/employee-onboarding','POST',payload),tasks=(await request('/onboarding-tasks')).body;
 await pg.exec("CREATE FUNCTION fail_onboard_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_onboard_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_onboard_audit();");
 try{expect((await request('/onboarding-tasks/'+tasks[0].id,'PUT',{expectedVersion:1,status:'completed',comments:'Done',assigneeId:null,dueDate:'2026-10-01'})).status).toBe(500);expect((await request('/employee-onboarding/'+made.body.id)).body.progress).toBe(0);expect((await request('/onboarding-tasks')).body[0].version).toBe(1);}finally{await pg.exec('DROP TRIGGER fail_onboard_audit ON activity_logs; DROP FUNCTION fail_onboard_audit();');}
});
