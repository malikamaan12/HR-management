import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/lifecycle';
import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
import {authService} from '../server/services/auth';
import {businessToday} from '../server/services/hr-rules';
let pg:PGlite,server:Server,base:string;const note='Verified checklist evidence';
async function req(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function account(name:string,role:s.UserRole='employee',department='Operations'){
  const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('LifecycleTest123!',4),firstName:name,lastName:'Tester',role,department,isActive:true,approvalStatus:'approved'}).returning();
  const [employee]=await ctx.db.insert(s.employees).values({employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'TEST-'+name,primaryMobile:'Test',residentialAddress:'Test',emergencyContactName:'Test',emergencyContactNumber:'Test',department,position:'Host',location:'Doha',type:'temporary',joiningDate:'2020-01-01',userId:u.id}).returning();
  return {...u,employee,token:(await authService.login(name,'LifecycleTest123!')).accessToken};
}
async function fixture(){return {admin:await account('admin','super_admin'),hr:await account('hr','hr'),dept:await account('dept','hr_manager'),outside:await account('outside','hr_manager','Sales'),alice:await account('alice'),bob:await account('bob')};}
const definition=(extra={})=>({title:'Employee orientation',kind:'general',required:true,offsetDays:0,...extra});
async function start(f:any,defs=[definition()],owner=f.alice){
  const t=await req(f.admin.token,'/templates',{name:'New employee',kind:'onboarding',tasks:defs,reason:note});expect(t.status,t.body.message).toBe(201);
  const c=await req(f.admin.token,'/',{employeeId:f.alice.employee.id,templateId:t.body.id,templateVersion:t.body.version,ownerId:owner.id,startDate:businessToday(),reason:note});expect(c.status,c.body.message).toBe(201);
  const detail=await req(f.admin.token,'/'+c.body.id);return {template:t.body,record:c.body,task:detail.body.tasks[0],tasks:detail.body.tasks};
}
const patch=(f:any,c:any,body:any,who=f.alice)=>req(who.token,`/${c.record.id}/tasks/${c.task.id}`,{version:1,status:'completed',evidence:note,...body},'PATCH');
const review=(f:any,c:any,body={},who=f.hr)=>req(who.token,`/${c.record.id}/tasks/${c.task.id}/review`,{version:2,decision:'approve',reason:note,...body});
beforeAll(async()=>{process.env.JWT_SECRET='lifecycle-access-secret-at-least32';process.env.JWT_REFRESH_SECRET='lifecycle-refresh-secret-at-least32';process.env.APP_TIMEZONE='Asia/Qatar';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/api',authenticate,moduleAccess);app.use('/api/lifecycle',router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port+'/api/lifecycle';});
beforeEach(async()=>{await pg.exec('TRUNCATE users, employees RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('template revisions and archive preserve running checklists and reject stale selection',async()=>{
  const f=await fixture(),c=await start(f);const revision={name:'Revised orientation',kind:'onboarding',tasks:[definition({title:'New task',reviewRequired:true})],version:1,active:true,reason:note};
  expect((await req(f.admin.token,`/templates/${c.template.id}`,revision,'PATCH')).body.version).toBe(2);
  expect((await req(f.admin.token,`/templates/${c.template.id}`,revision,'PATCH')).status).toBe(409);
  const existing=(await req(f.admin.token,'/'+c.record.id)).body;expect(existing.record.templateSnapshot.version).toBe(1);expect(existing.tasks[0].title).toBe('Employee orientation');expect(existing.tasks[0].reviewRequired).toBe(false);
  const body={employeeId:f.bob.employee.id,templateId:c.template.id,templateVersion:1,ownerId:f.bob.id,startDate:businessToday(),reason:note};expect((await req(f.admin.token,'/',body)).status).toBe(409);
  expect((await req(f.admin.token,`/templates/${c.template.id}`,{...revision,version:2,active:false},'PATCH')).status).toBe(200);
  expect((await req(f.admin.token,'/',{...body,templateVersion:3})).status).toBe(409);
  expect((await req(f.admin.token,`/templates/${c.template.id}/history`)).body.map((h:any)=>h.version)).toEqual([3,2,1]);
  expect((await req(f.alice.token,'/templates')).status).toBe(403);
});
test('only administrators publish rules and existing cases retain their pinned policy',async()=>{
  const f=await fixture(),old=await start(f);const policy={version:0,taskKinds:['general'],reviewDays:3,reason:note};
  expect((await req(f.hr.token,'/review-policy',policy)).status).toBe(403);expect((await req(f.admin.token,'/review-policy',policy)).status).toBe(201);expect((await req(f.admin.token,'/review-policy',policy)).status).toBe(409);
  expect((await req(f.admin.token,'/'+old.record.id)).body.tasks[0].reviewRequired).toBe(false);
  await req(f.admin.token,`/${old.record.id}/cancel`,{version:1,reason:note});const current=await start(f);
  expect(current.task.reviewRequired).toBe(true);expect(current.record.reviewPolicySnapshot.version).toBe(1);
  await req(f.admin.token,'/review-policy',{...policy,version:1,taskKinds:[],reviewDays:30});const submitted=await patch(f,current,{});expect(submitted.body.reviewState).toBe('pending');expect(submitted.body.reviewDueDate).toBe(new Date(Date.parse(businessToday())+3*86400000).toISOString().slice(0,10));
});
test('assigned owner submits, independent scoped HR returns and approves, and completion waits',async()=>{
  const f=await fixture(),c=await start(f,[definition({reviewRequired:true})]);
  expect((await patch(f,c,{},f.admin)).status).toBe(403);expect((await patch(f,c,{})).body.reviewState).toBe('pending');
  expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:2,reason:note,confirmed:true})).status).toBe(409);
  expect((await review(f,c,{},f.outside)).status).toBe(404);expect((await review(f,c,{},f.alice)).status).toBe(404);
  expect((await review(f,c,{decision:'return'})).body.reviewState).toBe('returned');
  expect((await patch(f,c,{version:3,evidence:'Corrected orientation evidence'})).body.reviewState).toBe('pending');
  const approved=await review(f,c,{version:4},f.dept);expect(approved.status,approved.body.message).toBe(200);expect(approved.body.status).toBe('completed');
  expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:5,reason:note,confirmed:true})).status).toBe(200);
  expect((await patch(f,c,{version:6,status:'pending'},f.admin)).status).toBe(409);
});
test('an HR task owner cannot approve their own submission or edit completed evidence without reopening',async()=>{
  const f=await fixture(),c=await start(f,[definition({reviewRequired:true})],f.hr);expect((await patch(f,c,{},f.hr)).status).toBe(200);
  expect((await review(f,c,{},f.hr)).status).toBe(403);expect((await review(f,c,{},f.admin)).status).toBe(200);
  expect((await patch(f,c,{version:3},f.admin)).status).toBe(409);
  expect((await patch(f,c,{version:3,status:'pending'},f.admin)).body.reviewState).toBe('required');
  expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:4,reason:note,confirmed:true})).status).toBe(409);
});
test('subject HR cannot approve onboarding evidence submitted by another owner',async()=>{
  const f=await fixture();await ctx.db.update(s.users).set({role:'hr'}).where(eq(s.users.id,f.alice.id));f.alice.token=(await authService.login('alice','LifecycleTest123!')).accessToken;
  const c=await start(f,[definition({reviewRequired:true})],f.bob);expect((await patch(f,c,{},f.bob)).status).toBe(200);expect((await review(f,c,{},f.alice)).status).toBe(403);
});
test('assignment changes require management and clear any pending review evidence',async()=>{
  const f=await fixture(),c=await start(f,[definition({reviewRequired:true})]);await patch(f,c,{});
  expect((await patch(f,c,{version:2,status:'pending',ownerId:f.bob.id})).status).toBe(403);
  const reset=await patch(f,c,{version:2,status:'pending',ownerId:f.bob.id},f.admin);expect(reset.body.submittedBy).toBe(null);expect(reset.body.reviewDueDate).toBe(null);
  expect((await patch(f,c,{version:3})).status).toBe(404);expect((await patch(f,c,{version:3},f.bob)).status).toBe(200);
  expect((await review(f,c,{version:2})).status).toBe(409);
});
test('private document evidence is checked by type, date, employee and current saved version',async()=>{
  const f=await fixture(),c=await start(f,[definition({kind:'document',documentType:'Passport',reviewRequired:true})]);
  const [doc]=await ctx.db.insert(s.documents).values({employeeId:f.alice.employee.id,documentType:'Passport',documentNumber:'PRIVATE-REF',documentFile:`documents/${f.alice.employee.id}/1234-abcd.pdf`,issueDate:'2020-01-01',expiryDate:'2099-01-01',status:'valid'}).returning();
  await ctx.db.update(s.documents).set({expiryDate:'2020-02-01'}).where(eq(s.documents.id,doc.id));expect((await patch(f,c,{documentId:doc.id})).status).toBe(409);
  await ctx.db.update(s.documents).set({expiryDate:'2099-01-01',documentType:'Visa'}).where(eq(s.documents.id,doc.id));expect((await patch(f,c,{documentId:doc.id})).status).toBe(400);
  await ctx.db.update(s.documents).set({documentType:'Passport',employeeId:f.bob.employee.id}).where(eq(s.documents.id,doc.id));expect((await patch(f,c,{documentId:doc.id})).status).toBe(400);
  await ctx.db.update(s.documents).set({employeeId:f.alice.employee.id}).where(eq(s.documents.id,doc.id));const submit=await patch(f,c,{documentId:doc.id});expect(submit.status,submit.body.message).toBe(200);expect(JSON.stringify(submit.body)).not.toContain('documents/');expect(JSON.stringify(submit.body)).not.toContain('PRIVATE-REF');
  await ctx.db.update(s.documents).set({documentFile:`documents/${f.alice.employee.id}/5678-abcd.pdf`}).where(eq(s.documents.id,doc.id));expect((await review(f,c)).status).toBe(409);
  await review(f,c,{decision:'return'});await patch(f,c,{version:3,documentId:doc.id});expect((await review(f,c,{version:4})).status).toBe(200);
  await ctx.db.update(s.documents).set({expiryDate:'2020-01-02'}).where(eq(s.documents.id,doc.id));expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:5,reason:note,confirmed:true})).status).toBe(409);
});
test('task queues and histories obey owner and department scope',async()=>{
  const f=await fixture(),c=await start(f,[definition({reviewRequired:true}),definition({title:'HR private task'})],f.bob);
  await req(f.admin.token,`/${c.record.id}/tasks/${c.tasks[1].id}`,{version:1,status:'pending',ownerId:f.hr.id,evidence:'Private HR evidence'},'PATCH');
  expect((await patch(f,c,{version:2},f.bob)).status).toBe(200);
  expect((await req(f.outside.token,'/tasks/queue?view=review')).body.items).toHaveLength(0);
  expect((await req(f.dept.token,'/tasks/queue?view=review')).body.items).toHaveLength(1);
  expect((await req(f.bob.token,'/tasks/queue?view=mine')).body.items).toHaveLength(1);
  expect((await req(f.bob.token,'/'+c.record.id)).body.tasks).toHaveLength(1);
  const listed=(await req(f.bob.token,'/')).body[0].record;expect(listed.reason).toBeUndefined();expect(listed.templateSnapshot).toBeUndefined();
  expect(JSON.stringify((await req(f.bob.token,`/${c.record.id}/history`)).body)).not.toContain('Private HR evidence');
  expect((await req(f.outside.token,`/${c.record.id}/history`)).status).toBe(404);
  await pg.exec(`UPDATE lifecycle_tasks SET review_due_date='2020-01-01' WHERE id=${c.task.id}`);expect((await req(f.dept.token,'/tasks/queue?view=overdue')).body.items).toHaveLength(1);
});
test('competing submissions change the checklist once and failed audit rolls back the task',async()=>{
  const f=await fixture(),c=await start(f,[definition({reviewRequired:true})]);const results=await Promise.all([patch(f,c,{}),patch(f,c,{})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  await pg.exec("CREATE FUNCTION reject_review_history() RETURNS trigger AS $$ BEGIN IF NEW.kind='lifecycle_task' THEN RAISE EXCEPTION 'test history failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_review_history BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION reject_review_history();");
  try{expect((await review(f,c)).status).toBe(500);const after=(await req(f.admin.token,'/'+c.record.id)).body;expect(after.record.version).toBe(2);expect(after.tasks[0].reviewState).toBe('pending');}finally{await pg.exec('DROP TRIGGER reject_review_history ON hr_workflow_history; DROP FUNCTION reject_review_history();');}
});
test('optional pending reviews cannot be silently discarded by final completion',async()=>{
  const f=await fixture(),c=await start(f,[definition({required:false,reviewRequired:true})]);await patch(f,c,{});expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:2,reason:note,confirmed:true})).status).toBe(409);
  await patch(f,c,{version:2,status:'pending'});expect((await req(f.admin.token,`/${c.record.id}/complete`,{version:3,reason:note,confirmed:true})).status).toBe(200);
});
