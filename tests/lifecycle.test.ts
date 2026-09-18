import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/lifecycle';
import controls from '../server/routes/workflowControls';
import {authService} from '../server/services/auth';
import {startOnboarding,changeOnboardingTask} from '../server/services/onboarding-workflow';
let pg:PGlite,server:Server,base:string;
async function req(token:string,path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function user(name:string,role:schema.UserRole='employee'){const [u]=await ctx.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('TestLifecycle123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();const [e]=await ctx.db.insert(schema.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'qid-'+name,primaryMobile:'private',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'temporary',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01'}).returning();return {...u,employee:e,token:(await authService.login(name,'TestLifecycle123!')).accessToken};}
const reason='Verified supporting evidence';
async function fixture(){return {admin:await user('admin','super_admin'),reviewer:await user('reviewer','hr'),alice:await user('alice'),bob:await user('bob')};}
async function cycle(f:any){const r=await req(f.admin.token,'/cycles',{title:'Quarterly review',startDate:'2026-01-01',endDate:'2026-03-31',dueDate:'2026-04-15',rubric:[{title:'Quality',weight:60},{title:'Teamwork',weight:40}],reason});expect(r.status).toBe(201);return r.body;}
async function assessment(f:any){const c=await cycle(f),a=await req(f.admin.token,'/assessments',{cycleId:c.id,employeeId:f.alice.employee.id,reviewerId:f.reviewer.employee.id,reason});expect(a.status).toBe(201);return {c,a:a.body};}
async function training(f:any){const c=await req(f.admin.token,'/courses',{title:'Safety orientation',description:'Internal safety course',provider:'Internal trainer',reason});expect(c.status).toBe(201);const r=await req(f.admin.token,'/learning',{courseId:c.body.id,employeeId:f.alice.employee.id,dueDate:'2026-10-01',reason});expect(r.status).toBe(201);return {c:c.body,r:r.body};}
beforeAll(async()=>{process.env.JWT_SECRET='test-lifecycle-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-lifecycle-refresh-secret-32-characters';pg=new PGlite();for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/controls',controls);app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,training_courses,onboarding_checklists,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});
test('reviewer submission, independent publication, employee acknowledgement and cycle closure preserve history',async()=>{
 const f=await fixture(),{c,a}=await assessment(f),path=`/assessments/${a.id}/actions`;
 expect((await req(f.alice.token,'/assessments')).body.items).toEqual([]);
 expect((await req(f.admin.token,`/cycles/${c.id}/close`,{version:1,reason})).status).toBe(409);
 const body={version:1,action:'submit',ratings:[{score:4,evidence:reason},{score:3,evidence:reason}],developmentPlan:'Complete advanced host training by October',reason};
 const submitted=await req(f.reviewer.token,path,body);expect(submitted.body).toMatchObject({status:'submitted',version:2});expect(Number(submitted.body.score)).toBe(3.6);
 expect((await req(f.reviewer.token,path,{version:2,action:'publish',reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:1,action:'publish',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,action:'publish',reason})).body.status).toBe('published');
 expect((await req(f.bob.token,'/assessments')).body.items).toEqual([]);
 expect((await req(f.bob.token,`/history/assessment/${a.id}`)).status).toBe(404);
 expect((await req(f.alice.token,`/history/assessment/${a.id}`)).body).toHaveLength(1);
 expect((await req(f.alice.token,path,{version:3,action:'acknowledge',reason})).body.acknowledged_at).toBeTruthy();
 expect((await req(f.admin.token,`/cycles/${c.id}/close`,{version:1,reason})).body.status).toBe('closed');
 expect((await req(f.admin.token,`/history/assessment/${a.id}`)).body).toHaveLength(4);
});
test('cycle validation and reviewer assignment reject self review, duplicates and ineligible reviewers',async()=>{
 const f=await fixture(),c=await cycle(f);const base={cycleId:c.id,employeeId:f.alice.employee.id,reason};
 expect((await req(f.alice.token,'/cycles',{title:'Own cycle'})).status).toBe(403);
 expect((await req(f.admin.token,'/cycles',{title:'Bad weights',startDate:'2026-01-01',endDate:'2026-03-31',dueDate:'2026-04-15',rubric:[{title:'Quality',weight:90}],reason})).status).toBe(400);
 expect((await req(f.admin.token,'/assessments',{...base,reviewerId:f.alice.employee.id})).status).toBe(403);
 expect((await req(f.admin.token,'/assessments',{...base,reviewerId:f.bob.employee.id})).status).toBe(404);
 expect((await req(f.admin.token,'/assessments',{...base,reviewerId:f.reviewer.employee.id})).status).toBe(201);
 expect((await req(f.admin.token,'/assessments',{...base,reviewerId:f.reviewer.employee.id})).status).toBe(409);
});
test('returning a submitted assessment preserves its earlier evidence and permits resubmission',async()=>{
 const f=await fixture(),{a}=await assessment(f),path=`/assessments/${a.id}/actions`,body={version:1,action:'submit',ratings:[{score:4,evidence:reason},{score:3,evidence:reason}],developmentPlan:reason,reason};
 expect((await req(f.reviewer.token,path,{...body,ratings:[]})).status).toBe(400);
 await req(f.reviewer.token,path,body);expect((await req(f.admin.token,path,{version:2,action:'return',reason:'Add measurable objectives'})).body.status).toBe('draft');
 expect((await req(f.reviewer.token,path,{...body,version:3})).body.version).toBe(4);
});
test('learning completion requires independent verification and final evidence cannot be rewritten',async()=>{
 const f=await fixture(),{r,c}=await training(f),path=`/learning/${r.id}/actions`;
 expect((await req(f.admin.token,'/learning',{courseId:c.id,employeeId:f.alice.employee.id,dueDate:'2026-10-01',reason})).status).toBe(409);
 expect((await req(f.bob.token,path,{version:1,action:'submit',evidence:reason,reason})).status).toBe(404);
 expect((await req(f.alice.token,path,{version:1,action:'submit',evidence:'Completed induction certificate A1',reason})).body.status).toBe('submitted');
 expect((await req(f.alice.token,path,{version:2,action:'verify',evidence:reason,completionDate:'2026-01-02',reason})).status).toBe(403);
 const verified=await req(f.admin.token,path,{version:2,action:'verify',evidence:'Checked certificate A1 with trainer',completionDate:'2026-01-02',expiryDate:'2027-01-02',reason});expect(verified.body).toMatchObject({status:'completed',version:3});
 expect((await req(f.admin.token,path,{version:3,action:'withdraw',reason})).status).toBe(409);
 expect((await req(f.bob.token,'/learning')).body.items).toEqual([]);
 expect((await req(f.alice.token,`/history/learning/${r.id}`)).body).toHaveLength(3);
});
test('learning return, withdrawal and renewal retain previous records',async()=>{
 const f=await fixture(),{r,c}=await training(f),path=`/learning/${r.id}/actions`;
 await req(f.alice.token,path,{version:1,action:'submit',evidence:reason,reason});
 expect((await req(f.admin.token,path,{version:2,action:'return',reason})).body.status).toBe('assigned');
 expect((await req(f.alice.token,path,{version:3,action:'withdraw',reason})).body.status).toBe('withdrawn');
 expect((await req(f.admin.token,'/learning',{courseId:c.id,employeeId:f.alice.employee.id,dueDate:'2026-11-01',reason})).status).toBe(201);
 expect((await req(f.admin.token,'/learning')).body.items).toHaveLength(2);
});
test('failed audit rolls back verification and its version',async()=>{
 const f=await fixture(),{r}=await training(f);await pg.exec("CREATE FUNCTION fail_lifecycle_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_lifecycle_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_audit();");
 try{expect((await req(f.admin.token,`/learning/${r.id}/actions`,{version:1,action:'verify',evidence:reason,completionDate:'2026-01-02',reason})).status).toBe(500);expect((await req(f.admin.token,'/learning')).body.items[0]).toMatchObject({version:1,status:'assigned'});}finally{await pg.exec('DROP TRIGGER fail_lifecycle_audit ON activity_logs; DROP FUNCTION fail_lifecycle_audit();');}
});
test('required documents gate the final task and stale file verification cannot complete onboarding',async()=>{
 const f=await fixture();const [template]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Starter'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:template.id,taskName:'Welcome',category:'first_day',assignedTo:'hr',daysFromStart:0});
 const parent=await startOnboarding({employeeId:f.alice.employee.id,checklistId:template.id,startDate:'2026-01-01'},f.admin.id);
 const c=await req(f.admin.token,'/document-checks',{onboardingId:parent.id,documentType:'passport',reason});expect(c.status).toBe(201);
 const tasks=await pg.query<any>('SELECT * FROM onboarding_tasks WHERE onboarding_id=$1',[parent.id]);const taskId=tasks.rows[0].id,body={expectedVersion:1,status:'completed',comments:reason,assigneeId:f.admin.employee.id,dueDate:'2026-01-01'};
 await expect(changeOnboardingTask(taskId,body,f.admin.id)).rejects.toThrow('Verify every required');
 const [doc]=await ctx.db.insert(schema.documents).values({employeeId:f.alice.employee.id,documentType:'passport',documentNumber:'Private',issueDate:'2025-01-01',expiryDate:'2030-01-01',status:'valid',documentFile:'private/file'}).returning();
 expect((await req(f.admin.token,`/document-checks/${c.body.id}/verify`,{version:1,documentId:doc.id,reason})).status).toBe(200);
 await pg.query('UPDATE documents SET updated_at=updated_at+interval \'1 second\' WHERE id=$1',[doc.id]);
 await expect(changeOnboardingTask(taskId,body,f.admin.id)).rejects.toThrow('Verify every required');
 expect((await req(f.admin.token,`/document-checks/${c.body.id}/verify`,{version:2,documentId:doc.id,reason})).status).toBe(200);
 expect((await changeOnboardingTask(taskId,body,f.admin.id)).status).toBe('completed');
 expect((await req(f.admin.token,'/document-checks',{onboardingId:parent.id,documentType:'visa',reason})).status).toBe(409);
});
test('hiring stages reject skipped steps and stale updates; offer stage requires an interview',async()=>{
 const f=await fixture();const [candidate]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Applicant',email:'applicant@example.test',phone:'test',source:'other'}).returning();const [job]=await ctx.db.insert(schema.jobRequisitions).values({requisitionId:'REQ1',jobTitle:'Host',department:'Operations',location:'Mall',positionType:'temporary',numberOfVacancies:1,jobDescription:'Host',qualifications:'Experience',responsibilities:'Support',requiredSkills:'Service',requestedBy:f.admin.employee.id}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:candidate.id,requisitionId:job.id,applicationDate:'2026-01-01'}).returning();const path=`/applications/${a.id}/stage`;
 expect((await req(f.alice.token,'/applications')).status).toBe(403);
 expect((await req(f.admin.token,path,{version:1,status:'offer',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:1,status:'screening',reason})).body.version).toBe(2);
 expect((await req(f.admin.token,path,{version:1,status:'shortlisted',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,status:'shortlisted',reason})).body.version).toBe(3);
 expect((await req(f.admin.token,path,{version:3,status:'interview',reason})).body.version).toBe(4);
 expect((await req(f.admin.token,path,{version:4,status:'offer',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:4,status:'rejected',reason})).body.status).toBe('rejected');
 expect((await req(f.admin.token,`/history/application/${a.id}`)).body).toHaveLength(4);
});
test('exit dashboard keeps employee access private and snapshots existing checklist changes',async()=>{
 const f=await fixture();await pg.query("INSERT INTO offboarding_cases(employee_id,tasks,reason,created_by) VALUES ($1,'[]'::jsonb,'Verified exit',$2)",[f.alice.employee.id,f.admin.id]);
 const list=await req(f.admin.token,'/exits');expect(list.status).toBe(200);expect(list.body.items[0]).toMatchObject({status:'open',settlements:[],pendingPayroll:[]});
 expect((await req(f.alice.token,'/exits')).status).toBe(403);
 expect((await req(f.admin.token,`/history/exit/${list.body.items[0].id}`)).body).toHaveLength(1);
});
test('goal completion and reopening preserve evidence, reject stale updates and enforce employee scope',async()=>{
 const f=await fixture();const [g]=await ctx.db.insert(schema.employeeGoals).values({employeeId:f.alice.employee.id,title:'Learn host duties',description:'Complete mentored sessions',category:'development',startDate:'2026-01-01',dueDate:'2026-10-01'}).returning();const path=`/goals/${g.id}/progress`,body={version:1,status:'completed',progress:100,dueDate:'2026-10-01',reason};
 expect((await req(f.bob.token,path,body)).status).toBe(404);
 expect((await req(f.alice.token,path,{...body,progress:75})).status).toBe(400);
 expect((await req(f.alice.token,path,body)).body).toMatchObject({status:'completed',progress:100,version:2});
 expect((await req(f.admin.token,path,body)).status).toBe(409);
 expect((await req(f.admin.token,path,{...body,version:2,status:'in_progress',progress:50})).body).toMatchObject({completion_date:null,version:3});
 expect((await req(f.alice.token,`/history/goal/${g.id}`)).body).toHaveLength(2);
});
test('administrator rating scales and rounding are pinned to each cycle',async()=>{
 const f=await fixture();const c=await req(f.admin.token,'/cycles',{title:'Ten point cycle',startDate:'2026-01-01',endDate:'2026-03-31',dueDate:'2026-04-15',ratingMax:10,scoreDecimals:0,rubric:[{title:'Quality',weight:60},{title:'Teamwork',weight:40}],reason});expect(c.status).toBe(201);
 const a=await req(f.admin.token,'/assessments',{cycleId:c.body.id,employeeId:f.alice.employee.id,reviewerId:f.reviewer.employee.id,reason});expect(a.status).toBe(201);
 const r=await req(f.reviewer.token,`/assessments/${a.body.id}/actions`,{version:1,action:'submit',ratings:[{score:9,evidence:reason},{score:7,evidence:reason}],developmentPlan:reason,reason});expect(r.status).toBe(200);expect(Number(r.body.score)).toBe(8);
});
async function jobFixture(f:any){const [job]=await ctx.db.insert(schema.jobRequisitions).values({requisitionId:'REQ-CONTROL',jobTitle:'Host',department:'Operations',location:'Mall',positionType:'temporary',numberOfVacancies:1,jobDescription:'Host activities',qualifications:'Experience',responsibilities:'Support',requiredSkills:'Service',requestedBy:f.admin.employee.id}).returning();return job;}
test('requisition approvals are independent, conflict-safe and preserve draft edits',async()=>{
 const f=await fixture(),job=await jobFixture(f),path=`/controls/requisitions/${job.id}/actions`;
 expect((await req(f.alice.token,path,{version:1,action:'submit',reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:1,action:'submit',reason})).body.status).toBe('pending_approval');
 expect((await req(f.admin.token,path,{version:2,action:'approve',reason})).status).toBe(403);
 expect((await req(f.reviewer.token,path,{version:1,action:'approve',reason})).status).toBe(409);
 expect((await req(f.reviewer.token,path,{version:2,action:'return',reason})).body.status).toBe('draft');
 const fields={jobTitle:'Senior host',department:'Operations',location:'Mall',numberOfVacancies:2,jobDescription:'Lead host activities'};
 expect((await req(f.reviewer.token,path,{version:3,action:'edit',fields,reason})).body.job_title).toBe('Senior host');
 await req(f.admin.token,path,{version:4,action:'submit',reason});
 expect((await req(f.reviewer.token,path,{version:5,action:'approve',reason})).status).toBe(403);
 const boss=await user('boss','hr');expect((await req(boss.token,path,{version:5,action:'approve',reason})).body.status).toBe('approved');
 expect((await req(f.admin.token,path,{version:6,action:'open',reason})).body.status).toBe('open');
 expect((await req(f.admin.token,`/controls/history/requisition/${job.id}`)).body).toHaveLength(6);
});
test('offers require independent approval and enforce acceptance dates and vacancy capacity',async()=>{
 const f=await fixture(),job=await jobFixture(f);await pg.query("UPDATE job_requisitions SET status='open' WHERE id=$1",[job.id]);
 const [candidate]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Applicant',email:'candidate@example.test',phone:'test',source:'other'}).returning();
 const [app]=await ctx.db.insert(schema.jobApplications).values({candidateId:candidate.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'offer'}).returning();
 const data={applicationId:app.id,offerDate:'2026-01-02',salary:2000,expiryDate:'2030-01-01',status:'draft',createdBy:f.admin.employee.id};
 const [offer]=await ctx.db.insert(schema.jobOffers).values(data).returning();const path=`/controls/offers/${offer.id}/actions`;
 expect((await req(f.admin.token,path,{version:1,action:'accept',acceptanceDate:'2026-01-03',reason})).status).toBe(409);
 await req(f.admin.token,path,{version:1,action:'submit',reason});expect((await req(f.admin.token,path,{version:2,action:'approve',reason})).status).toBe(403);
 expect((await req(f.reviewer.token,path,{version:2,action:'approve',reason})).body.status).toBe('pending');
 expect((await req(f.admin.token,path,{version:3,action:'accept',acceptanceDate:'2025-12-31',reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:3,action:'accept',acceptanceDate:'2026-01-03',reason})).body.status).toBe('accepted');
 const [second]=await ctx.db.insert(schema.jobOffers).values({...data,status:'pending'}).returning();await pg.query('UPDATE job_offers SET approved_by_user=$1 WHERE id=$2',[f.reviewer.id,second.id]);
 expect((await req(f.admin.token,`/controls/offers/${second.id}/actions`,{version:2,action:'accept',acceptanceDate:'2026-01-03',reason})).status).toBe(409);
 expect((await req(f.admin.token,`/controls/requisitions/${job.id}/actions`,{version:2,action:'close',reason})).status).toBe(409);
});
test('required document template versions copy into new cases without changing existing onboarding',async()=>{
 const f=await fixture();const [template]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Starter requirements'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:template.id,taskName:'Welcome',category:'first_day',assignedTo:'hr',daysFromStart:0});const path=`/controls/requirements/${template.id}`;
 expect((await req(f.admin.token,path,{version:0,documentTypes:['passport','passport'],reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:0,documentTypes:['passport'],reason})).status).toBe(201);
 const first=await startOnboarding({employeeId:f.alice.employee.id,checklistId:template.id,startDate:'2026-01-01'},f.admin.id);
 expect((await req(f.admin.token,path,{version:0,documentTypes:['visa'],reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:1,documentTypes:['passport','visa'],reason})).status).toBe(201);
 const second=await startOnboarding({employeeId:f.bob.employee.id,checklistId:template.id,startDate:'2026-01-01'},f.admin.id);
 expect((await pg.query('SELECT * FROM onboarding_document_checks WHERE onboarding_id=$1',[first.id])).rows).toHaveLength(1);
 expect((await pg.query('SELECT * FROM onboarding_document_checks WHERE onboarding_id=$1',[second.id])).rows).toHaveLength(2);
});
test('course archival prevents new learning assignments while preserving existing titles and evidence',async()=>{
 const f=await fixture(),{r,c}=await training(f);const data={version:1,title:'Updated title',description:'Updated learning description',provider:'Internal trainer',active:false,reason};
 expect((await req(f.alice.token,`/controls/courses/${c.id}`,data)).status).toBe(403);
 expect((await req(f.admin.token,`/controls/courses/${c.id}`,data)).body).toMatchObject({version:2,active:false});
 expect((await req(f.admin.token,`/controls/courses/${c.id}`,data)).status).toBe(409);
 expect((await req(f.admin.token,'/learning',{employeeId:f.bob.employee.id,courseId:c.id,dueDate:'2026-10-01',reason})).status).toBe(400);
 expect((await req(f.alice.token,'/learning')).body.items[0].course_title).toBe(r.course_title);
 expect((await req(f.admin.token,`/controls/history/course/${c.id}`)).body).toHaveLength(2);
});
test('reviewer reassignment retains prior evidence, resets the draft and removes the old reviewer write authority',async()=>{
 const f=await fixture(),{a}=await assessment(f);await req(f.reviewer.token,`/assessments/${a.id}/actions`,{version:1,action:'submit',ratings:[{score:4,evidence:reason},{score:3,evidence:reason}],developmentPlan:reason,reason});const boss=await user('boss','hr');const path=`/controls/assessments/${a.id}/reassign`;
 expect((await req(f.admin.token,path,{version:2,reviewerId:f.alice.employee.id,reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:2,reviewerId:boss.employee.id,reason})).body).toMatchObject({status:'draft',version:3,ratings:[],score:null});
 expect((await req(f.reviewer.token,`/assessments/${a.id}/actions`,{version:3,action:'submit',ratings:[{score:4,evidence:reason},{score:3,evidence:reason}],developmentPlan:reason,reason})).status).toBe(403);
 const history=await req(f.admin.token,`/history/assessment/${a.id}`);expect(history.body).toHaveLength(3);expect(history.body[1].snapshot.ratings).toHaveLength(2);
});

test('interviews serialize candidate and interviewer overlaps, allow adjacency and guard rescheduling',async()=>{
 const f=await fixture(),job=await jobFixture(f);await pg.query("UPDATE job_requisitions SET status='open' WHERE id=$1",[job.id]);const [c]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Candidate',email:'booking@example.test',phone:'test',source:'other'}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'interview'}).returning();const data={applicationId:a.id,interviewerId:f.reviewer.employee.id,startsAt:'2030-01-02T09:00:00+03:00',durationMinutes:60,interviewType:'video',interviewRound:'first',reason};
 expect((await req(f.alice.token,'/controls/interviews',data)).status).toBe(403);
 const results=await Promise.all([req(f.admin.token,'/controls/interviews',data),req(f.admin.token,'/controls/interviews',data)]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);const row=results.find(r=>r.status===201)!.body;
 expect((await req(f.admin.token,'/controls/interviews',{...data,interviewerId:f.bob.employee.id})).status).toBe(409);
 const adjacent=await req(f.admin.token,'/controls/interviews',{...data,startsAt:'2030-01-02T10:00:00+03:00'});expect(adjacent.status).toBe(201);
 expect((await req(f.admin.token,`/controls/interviews/${row.id}/reschedule`,{...data,version:1,startsAt:'2030-01-02T10:30:00+03:00'})).status).toBe(409);
 expect((await req(f.admin.token,`/controls/interviews/${row.id}/reschedule`,{...data,version:1,startsAt:'2030-01-02T08:00:00+03:00'})).body.version).toBe(2);
 expect((await req(f.admin.token,`/controls/interviews/${row.id}/decision`,{version:1,action:'cancelled',reason})).status).toBe(409);
 expect((await req(f.admin.token,`/controls/interviews/${row.id}/decision`,{version:2,action:'completed',rating:4,recommendation:'hire',reason})).status).toBe(409);
 expect((await req(f.admin.token,`/controls/interviews/${row.id}/decision`,{version:2,action:'cancelled',reason})).body.status).toBe('cancelled');
 expect((await req(f.admin.token,`/controls/history/interview/${row.id}`)).body).toHaveLength(3);
});
test('completed interviews require feedback and become final',async()=>{
 const f=await fixture(),job=await jobFixture(f);const [c]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Candidate',email:'outcome@example.test',phone:'test',source:'other'}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'interview'}).returning();const [i]=await ctx.db.insert(schema.interviews).values({applicationId:a.id,interviewerId:f.reviewer.employee.id,interviewDate:new Date('2026-01-01'),interviewType:'video',interviewRound:'first',status:'scheduled'}).returning();const path=`/controls/interviews/${i.id}/decision`;
 expect((await req(f.admin.token,path,{version:1,action:'completed',reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:1,action:'completed',rating:4,recommendation:'hire',reason})).body).toMatchObject({status:'completed',rating:4});
 expect((await req(f.admin.token,path,{version:2,action:'cancelled',reason})).status).toBe(409);
});
test('offer term editors cannot approve their edits and approved offers cannot be rewritten',async()=>{
 const f=await fixture(),job=await jobFixture(f);await pg.query("UPDATE job_requisitions SET status='open' WHERE id=$1",[job.id]);const [c]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Candidate',email:'terms@example.test',phone:'test',source:'other'}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'offer'}).returning();const [o]=await ctx.db.insert(schema.jobOffers).values({applicationId:a.id,offerDate:'2026-01-01',expiryDate:'2030-01-01',salary:2000,status:'draft',createdBy:f.admin.employee.id,offerLetter:'old-letter'}).returning();const data={version:1,offerDate:'2026-01-01',expiryDate:'2030-01-01',startDate:'2026-10-01',salary:2500,benefits:'Transport allowance',reason},path=`/controls/offers/${o.id}`;
 expect((await req(f.reviewer.token,path+'/terms',data)).body).toMatchObject({version:2,salary:2500,offer_letter:null});
 expect((await req(f.admin.token,path+'/terms',data)).status).toBe(409);
 await req(f.admin.token,path+'/actions',{version:2,action:'submit',reason});expect((await req(f.reviewer.token,path+'/actions',{version:3,action:'approve',reason})).status).toBe(403);
 const boss=await user('boss','hr');expect((await req(boss.token,path+'/actions',{version:3,action:'approve',reason})).status).toBe(200);
 expect((await req(f.admin.token,path+'/terms',{...data,version:4})).status).toBe(409);
});
test('new-hire tasks assign automatically and only the current owner can update progress',async()=>{
 const f=await fixture();const [c]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Self tasks'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:c.id,taskName:'Read welcome pack',category:'first_day',assignedTo:'new_hire',daysFromStart:0});const parent=await startOnboarding({employeeId:f.alice.employee.id,checklistId:c.id,startDate:'2026-01-01'},f.admin.id);const list=await req(f.alice.token,'/controls/my-tasks');expect(list.body.items).toHaveLength(1);const t=list.body.items[0],path=`/controls/my-tasks/${t.id}`,data={version:1,status:'completed',comments:reason};
 expect((await req(f.bob.token,path,data)).status).toBe(404);
 expect((await req(f.alice.token,path,{...data,assigneeId:f.bob.employee.id})).status).toBe(400);
 expect((await req(f.alice.token,path,data)).body.status).toBe('completed');
 expect((await req(f.alice.token,path,{...data,version:2,status:'in_progress'})).status).toBe(409);
 expect((await pg.query('SELECT status FROM employee_onboarding WHERE id=$1',[parent.id])).rows[0].status).toBe('completed');
});
test('document waivers require enabled policy and independent administrator and retain completion gates',async()=>{
 const f=await fixture();const [c]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Waiver checklist'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:c.id,taskName:'Orientation',category:'first_day',assignedTo:'new_hire',daysFromStart:0});const parent=await startOnboarding({employeeId:f.alice.employee.id,checklistId:c.id,startDate:'2026-01-01'},f.admin.id);const d=await req(f.admin.token,'/document-checks',{onboardingId:parent.id,documentType:'education',reason});const path=`/controls/documents/${d.body.id}/waiver`,data={version:1,action:'waive',reason};
 expect((await req(f.admin.token,path,data)).status).toBe(409);
 expect((await req(f.reviewer.token,'/controls/waiver-policy',{version:0,documentTypes:['education'],reason})).status).toBe(403);
 expect((await req(f.admin.token,'/controls/waiver-policy',{version:0,documentTypes:['education'],reason})).status).toBe(201);
 expect((await req(f.admin.token,'/controls/waiver-policy',{version:0,documentTypes:[],reason})).status).toBe(409);
 expect((await req(f.admin.token,path,data)).body.status).toBe('waived');
 expect((await req(f.admin.token,path,{version:2,action:'revoke',reason})).body.status).toBe('required');
 const t=(await req(f.alice.token,'/controls/my-tasks')).body.items[0];expect((await req(f.alice.token,`/controls/my-tasks/${t.id}`,{version:1,status:'completed',comments:reason})).status).toBe(409);
 await req(f.admin.token,path,{version:3,action:'waive',reason});expect((await req(f.alice.token,`/controls/my-tasks/${t.id}`,{version:1,status:'completed',comments:reason})).status).toBe(200);
 expect((await req(f.admin.token,path,{version:4,action:'revoke',reason})).status).toBe(409);
 expect((await req(f.admin.token,`/history/document/${d.body.id}`)).body).toHaveLength(4);
});

test('onboarding review policy pins new tasks and requires independent review with correction history',async()=>{
 const f=await fixture();const [c]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Reviewed onboarding'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:c.id,taskName:'Submit orientation evidence',category:'first_day',assignedTo:'new_hire',daysFromStart:0});
 const old=await startOnboarding({employeeId:f.bob.employee.id,checklistId:c.id,startDate:'2026-01-01'},f.admin.id);
 expect((await req(f.reviewer.token,'/controls/task-review-policy',{version:0,ownerGroups:['new_hire'],reason})).status).toBe(403);
 expect((await req(f.admin.token,'/controls/task-review-policy',{version:0,ownerGroups:['new_hire'],reason})).status).toBe(201);
 expect((await req(f.admin.token,'/controls/task-review-policy',{version:0,ownerGroups:[],reason})).status).toBe(409);
 const parent=await startOnboarding({employeeId:f.alice.employee.id,checklistId:c.id,startDate:'2026-01-01'},f.admin.id);
 const task=(await req(f.alice.token,'/controls/my-tasks')).body.items[0];expect(task.review_required).toBe(true);expect((await req(f.bob.token,'/controls/my-tasks')).body.items[0].review_required).toBe(false);
 const path=`/controls/my-tasks/${task.id}`,review=`/controls/task-reviews/${task.id}`;
 expect((await req(f.alice.token,path,{version:1,status:'completed',comments:reason})).body).toMatchObject({status:'in_progress',reviewState:'pending'});
 expect((await pg.query('SELECT status FROM employee_onboarding WHERE id=$1',[parent.id])).rows[0].status).toBe('in_progress');
 await expect(changeOnboardingTask(task.id,{expectedVersion:2,status:'completed',comments:reason,assigneeId:f.alice.employee.id,dueDate:'2026-01-01'},f.admin.id)).rejects.toThrow('Review or return');
 expect((await req(f.alice.token,path,{version:2,status:'completed',comments:reason})).status).toBe(409);
 expect((await req(f.alice.token,review,{version:2,action:'approve',reason})).status).toBe(403);
 expect((await req(f.admin.token,review,{version:2,action:'return',reason:'Please attach completion evidence'})).body.reviewState).toBe('returned');
 expect((await req(f.alice.token,path,{version:3,status:'completed',comments:'Corrected orientation evidence'})).body.reviewState).toBe('pending');
 expect((await req(f.admin.token,review,{version:3,action:'approve',reason})).status).toBe(409);
 expect((await req(f.admin.token,review,{version:4,action:'approve',reason})).body).toMatchObject({status:'completed',reviewState:'approved'});
 expect((await pg.query('SELECT status FROM employee_onboarding WHERE id=$1',[parent.id])).rows[0].status).toBe('completed');
 const history=await req(f.admin.token,`/controls/history/onboarding_task/${task.id}`);expect(history.body).toHaveLength(5);expect(history.body.some((h:any)=>h.snapshot.comments==='Corrected orientation evidence')).toBe(true);
 expect((await req(f.admin.token,'/controls/policy-history/task_review_policy')).body).toHaveLength(1);expect((await req(f.admin.token,'/controls/task-reviews?includeCompleted=true')).body.items.some((r:any)=>r.id===task.id&&r.review_state==='approved')).toBe(true);
});
test('even an administrator cannot approve their own task and failed audit rolls back review',async()=>{
 const f=await fixture();await req(f.admin.token,'/controls/task-review-policy',{version:0,ownerGroups:['new_hire'],reason});const [c]=await ctx.db.insert(schema.onboardingChecklists).values({name:'Admin onboarding'}).returning();await ctx.db.insert(schema.checklistTasks).values({checklistId:c.id,taskName:'Provide evidence',category:'first_day',assignedTo:'new_hire',daysFromStart:0});await startOnboarding({employeeId:f.admin.employee.id,checklistId:c.id,startDate:'2026-01-01'},f.admin.id);const t=(await req(f.admin.token,'/controls/my-tasks')).body.items[0];await req(f.admin.token,`/controls/my-tasks/${t.id}`,{version:1,status:'completed',comments:reason});const path=`/controls/task-reviews/${t.id}`,input={version:2,action:'approve',reason};
 expect((await req(f.admin.token,path,input)).status).toBe(403);
 await pg.exec("CREATE FUNCTION fail_task_review_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_task_review_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_task_review_audit();");
 try{expect((await req(f.reviewer.token,path,input)).status).toBe(500);expect((await pg.query('SELECT version,review_state FROM onboarding_tasks WHERE id=$1',[t.id])).rows[0]).toMatchObject({version:2,review_state:'pending'});}finally{await pg.exec('DROP TRIGGER fail_task_review_audit ON activity_logs; DROP FUNCTION fail_task_review_audit();');}
 expect((await req(f.reviewer.token,path,input)).body.reviewState).toBe('approved');
});
test('issued offer revision preserves terms, clears approval and requires another independent decision',async()=>{
 const f=await fixture(),job=await jobFixture(f);await pg.query("UPDATE job_requisitions SET status='open' WHERE id=$1",[job.id]);const [c]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Revision candidate',email:'revision@example.test',phone:'test',source:'other'}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'offer'}).returning();const [o]=await ctx.db.insert(schema.jobOffers).values({applicationId:a.id,offerDate:'2026-01-01',expiryDate:'2030-01-01',salary:2000,status:'pending',createdBy:f.admin.employee.id,offerLetter:'old-approved-letter'}).returning();await pg.query('UPDATE job_offers SET approved_by_user=$1 WHERE id=$2',[f.reviewer.id,o.id]);const path=`/controls/offers/${o.id}`;
 expect((await req(f.reviewer.token,path+'/actions',{version:2,action:'revise',reason})).body).toMatchObject({status:'draft',version:3,approved_by_user:null,offer_letter:null});
 expect((await req(f.admin.token,path+'/actions',{version:3,action:'accept',acceptanceDate:'2026-01-02',reason})).status).toBe(409);
 await req(f.admin.token,path+'/terms',{version:3,offerDate:'2026-01-01',expiryDate:'2030-01-01',startDate:'2026-10-01',salary:2200,benefits:'Transport',reason});await req(f.admin.token,path+'/actions',{version:4,action:'submit',reason});
 expect((await req(f.reviewer.token,path+'/actions',{version:5,action:'approve',reason})).status).toBe(403);
 const boss=await user('boss','hr');expect((await req(boss.token,path+'/actions',{version:5,action:'approve',reason})).body.status).toBe('pending');await req(f.admin.token,path+'/actions',{version:6,action:'accept',acceptanceDate:'2026-01-02',reason});expect((await req(f.admin.token,path+'/actions',{version:7,action:'revise',reason})).status).toBe(409);
 const history=(await req(f.admin.token,`/controls/history/offer/${o.id}`)).body;expect(history.some((h:any)=>h.snapshot.salary===2000&&h.snapshot.offer_letter==='old-approved-letter')).toBe(true);
});
test('interview availability blocks approved leave and workforce shifts and protects reverse scheduling',async()=>{
 const f=await fixture(),job=await jobFixture(f);await pg.query("UPDATE job_requisitions SET status='open' WHERE id=$1",[job.id]);const [c]=await ctx.db.insert(schema.candidates).values({fullNameEn:'Availability candidate',email:'availability@example.test',phone:'test',source:'other'}).returning();const [a]=await ctx.db.insert(schema.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01',status:'interview'}).returning();const data={applicationId:a.id,interviewerId:f.reviewer.employee.id,startsAt:'2030-01-02T09:00:00+03:00',durationMinutes:60,interviewType:'video',interviewRound:'first',reason};
 await ctx.db.insert(schema.leaves).values({employeeId:f.reviewer.employee.id,leaveType:'annual',startDate:'2030-01-02',endDate:'2030-01-02',totalDays:1,reason,status:'approved'});
 expect((await req(f.admin.token,'/controls/interviews',data)).status).toBe(409);await pg.query("UPDATE leaves SET status='rejected'");
 const [site]=await ctx.db.insert(schema.workforceSites).values({name:'Test site',timezone:'Asia/Qatar'}).returning();const [team]=await ctx.db.insert(schema.workforceTeams).values({name:'Test team',kind:'fec',siteId:site.id}).returning();const start=new Date('2030-01-02T06:00:00Z'),end=new Date('2030-01-02T07:00:00Z');const [shift]=await ctx.db.insert(schema.workforceShifts).values({teamId:team.id,role:'Host',headcount:1,startAt:start,endAt:end,createdBy:f.admin.id}).returning();await ctx.db.insert(schema.workforceAssignments).values({shiftId:shift.id,employeeId:f.reviewer.employee.id,status:'accepted',createdBy:f.admin.id});
 expect((await req(f.admin.token,'/controls/interviews',data)).status).toBe(409);await pg.query("UPDATE workforce_assignments SET status='cancelled'");
 const r=await req(f.admin.token,'/controls/interviews',data);expect(r.status).toBe(201);
 const {assertNoWorkforceConflict,assertLeaveCompatible}=await import('../server/services/workforce');
 await expect(ctx.db.transaction((tx:any)=>assertNoWorkforceConflict(tx,f.reviewer.employee.id,start,end))).rejects.toThrow('scheduled interview');
 await expect(ctx.db.transaction((tx:any)=>assertLeaveCompatible(tx,f.reviewer.employee.id,'2030-01-02','2030-01-02'))).rejects.toThrow('Reschedule or cancel');
 await req(f.admin.token,`/controls/interviews/${r.body.id}/decision`,{version:1,action:'cancelled',reason});
 await expect(ctx.db.transaction((tx:any)=>assertNoWorkforceConflict(tx,f.reviewer.employee.id,start,end))).resolves.toBeUndefined();
});
