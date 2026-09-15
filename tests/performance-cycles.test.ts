import { readFileSync,readdirSync } from 'node:fs';
import { beforeAll,beforeEach,afterAll,test,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import type { Server } from 'node:http';
import * as schema from '../shared/schema';
const context=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
import router from '../server/routes/performance-cycles';
import { authService } from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const password='ReviewCycleTestPass9!';
async function account(name:string,role:schema.UserRole='employee'){
  const [user]=await context.db.insert(schema.users).values({username:name,email:name+'@example.test',firstName:name,lastName:'Test',password:await bcrypt.hash(password,4),role,isActive:true,approvalStatus:'approved'}).returning();
  return {...user,token:(await authService.login(name,password)).accessToken};
}
async function employee(userId:number,name:string){
  const [row]=await context.db.insert(schema.employees).values({userId,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'secret-'+name,primaryMobile:'private-phone',residentialAddress:'private-address',emergencyContactName:'Private',emergencyContactNumber:'private-number',type:'permanent',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01',ibanNumber:'private-bank'}).returning();return row;
}
async function request(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};
}
const definition={name:'Quarterly growth review',periodStart:'2026-01-01',periodEnd:'2026-03-31',dueDate:'2026-04-15',selfRequired:true,rubric:[{key:'results',label:'Results',weight:70},{key:'growth',label:'Growth',weight:30}],ratingLabels:['One','Two','Three','Four','Five']};
const scores=[{key:'results',score:5,comment:'Recorded results'},{key:'growth',score:3,comment:'Development evidence'}];
async function fixture(open=true){
  const admin=await account('admin','super_admin'),hr=await account('hr','hr_director'),alice=await account('alice'),bob=await account('bob');
  const e=await employee(alice.id,'Alice');await employee(bob.id,'Bob');
  const cycle=await request(admin.token,'/',definition);expect(cycle.status).toBe(201);
  const review=await request(admin.token,`/${cycle.body.id}/participants`,{version:1,employeeId:e.id,reviewerId:admin.id,dueDate:'2026-04-20',selfRequired:true});expect(review.status).toBe(201);
  if(open)expect((await request(admin.token,`/${cycle.body.id}/actions`,{version:2,action:'open'})).status).toBe(200);
  return {admin,hr,alice,bob,e,cycleId:cycle.body.id,reviewId:review.body.id};
}
async function detail(token:string,id:number){const r=await request(token,`/assessments/${id}`);expect(r.status).toBe(200);return r.body;}
async function action(token:string,reviewId:number,action:string,extra:Record<string,unknown>={}){
  const d=await detail(token,reviewId);return request(token,`/assessments/${reviewId}/actions`,{version:d.review.version,action,...extra});
}
beforeAll(async()=>{
  process.env.JWT_SECRET='test-performance-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-performance-refresh-secret-32-characters';
  pg=new PGlite();for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('DROP TRIGGER IF EXISTS reject_performance_history ON performance_history; TRUNCATE users RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pg.close();});

test('cycle progresses through employee, manager, independent calibration, acknowledgement and closure',async()=>{
  const f=await fixture();const self={scores,summary:'My recorded achievements this quarter.'};
  expect((await action(f.alice.token,f.reviewId,'submit_self',self)).status).toBe(200);
  expect((await action(f.admin.token,f.reviewId,'submit_manager',{scores,summary:'Manager evidence and development feedback.'})).status).toBe(200);
  expect((await detail(f.alice.token,f.reviewId)).review.managerSummary).toBeNull();
  expect((await action(f.admin.token,f.reviewId,'publish',{scores,summary:'Calibration reviewed with evidence.',reason:'Independent review completed'})).status).toBe(403);
  const final=[{...scores[0],score:4},scores[1]];
  expect((await action(f.hr.token,f.reviewId,'publish',{scores:final,summary:'Calibrated after discussing the evidence.',reason:'Adjusted results based on documented scope'})).status).toBe(200);
  const published=await detail(f.alice.token,f.reviewId);expect(Number(published.review.finalRating)).toBe(3.7);expect(published.review.managerSummary).toContain('Manager evidence');
  expect((await action(f.hr.token,f.reviewId,'acknowledge')).status).toBe(403);
  expect((await action(f.alice.token,f.reviewId,'acknowledge',{reason:'Read and discussed with my reviewer.'})).status).toBe(200);
  const cycle=await request(f.admin.token,`/${f.cycleId}`);expect(cycle.body.report).toMatchObject({published:1,acknowledged:1,sampleCount:1,averageRating:3.7});
  expect((await request(f.admin.token,`/${f.cycleId}/actions`,{version:cycle.body.cycle.version,action:'close'})).status).toBe(200);
  expect((await action(f.hr.token,f.reviewId,'publish',{scores,summary:'Attempted overwrite of published rating.',reason:'Overwrite attempt'})).status).toBe(409);
});
test('scoped lists and details hide unrelated employees and private fields; stale and forged writes fail',async()=>{
  const f=await fixture();expect((await request('','/')).status).toBe(401);expect((await request(f.bob.token,'/')).body.total).toBe(0);
  expect((await request(f.bob.token,`/${f.cycleId}`)).status).toBe(404);expect((await request(f.bob.token,`/assessments/${f.reviewId}`)).status).toBe(404);
  expect(JSON.stringify(await detail(f.alice.token,f.reviewId))).not.toMatch(/secret-|private-bank|qidNumber|iban|password/);
  expect((await request(f.alice.token,'/',definition)).status).toBe(403);
  const before=await detail(f.alice.token,f.reviewId);expect((await action(f.alice.token,f.reviewId,'save_self',{scores,summary:'Private employee draft for the review.'})).status).toBe(200);
  expect((await detail(f.admin.token,f.reviewId)).review.selfSummary).toBeNull();
  expect((await request(f.alice.token,`/assessments/${f.reviewId}/actions`,{version:before.review.version,action:'submit_self',scores,summary:'Stale self assessment submission.'})).status).toBe(409);
  expect((await action(f.alice.token,f.reviewId,'submit_self',{scores:[scores[0],scores[0]],summary:'Duplicate scores must be rejected.'})).status).toBe(400);
  expect((await action(f.alice.token,f.reviewId,'submit_manager',{scores,summary:'Cannot impersonate assigned reviewer.'})).status).toBe(403);
});
test('draft settings and per-employee requirements are configurable and freeze at opening',async()=>{
  const f=await fixture(false);
  expect((await request(f.admin.token,`/assessments/${f.reviewId}`,{version:1,reviewerId:f.alice.id,dueDate:'2026-04-10',selfRequired:false},'PATCH')).status).toBe(400);
  expect((await request(f.admin.token,`/assessments/${f.reviewId}`,{version:1,reviewerId:f.hr.id,dueDate:'2026-04-10',selfRequired:false},'PATCH')).status).toBe(200);
  const cycle=await request(f.admin.token,`/${f.cycleId}`);expect((await request(f.admin.token,`/${f.cycleId}/actions`,{version:cycle.body.cycle.version,action:'open'})).status).toBe(200);
  const review=await detail(f.hr.token,f.reviewId);expect(review.review.status).toBe('manager_review');
  expect((await request(f.admin.token,`/assessments/${f.reviewId}`,{version:review.review.version,reviewerId:f.admin.id,dueDate:'2026-04-12',selfRequired:true},'PATCH')).status).toBe(409);
  expect((await request(f.admin.token,`/${f.cycleId}`,{version:cycle.body.cycle.version+1,cycle:definition},'PATCH')).status).toBe(409);
});
test('development actions track evidence and reject stale completion or unauthorized updates',async()=>{
  const f=await fixture();const goal=await request(f.alice.token,`/assessments/${f.reviewId}/objectives`,{kind:'development',title:'Complete leadership coaching',measure:'Complete four sessions and demonstrate feedback skills',dueDate:'2026-07-01'});expect(goal.status).toBe(201);
  expect((await request(f.bob.token,`/objectives/${goal.body.id}/progress`,{version:1,progress:100,status:'completed',note:'Unauthorized update'})).status).toBe(404);
  expect((await request(f.alice.token,`/objectives/${goal.body.id}/progress`,{version:1,progress:50,status:'completed',note:'Not actually complete'})).status).toBe(400);
  expect((await request(f.alice.token,`/objectives/${goal.body.id}/progress`,{version:1,progress:100,status:'completed',note:'Four sessions completed; reflection recorded.'})).status).toBe(200);
  expect((await request(f.admin.token,`/objectives/${goal.body.id}/progress`,{version:1,progress:50,status:'active',note:'Stale reviewer update'})).status).toBe(409);
  const result=await detail(f.alice.token,f.reviewId);expect(result.objectives[0].progress).toBe(100);expect(result.history.some((h:any)=>h.reason?.includes('Four sessions'))).toBe(true);
});
test('revoked reviewer permissions remove assigned access and history failure rolls back an objective',async()=>{
  const f=await fixture();const manager=await account('manager','manager'),m=await employee(manager.id,'Manager');
  await context.db.update(schema.employees).set({reportingManagerId:m.id}).where(eq(schema.employees.id,f.e.id));
  expect((await action(f.admin.token,f.reviewId,'reassign',{reviewerId:manager.id,reason:'Assigned to current reporting manager'})).status).toBe(200);
  expect((await request(manager.token,'/')).body.total).toBe(1);
  await context.db.update(schema.employees).set({reportingManagerId:null}).where(eq(schema.employees.id,f.e.id));
  expect((await request(manager.token,'/')).body.total).toBe(0);expect((await request(manager.token,`/assessments/${f.reviewId}`)).status).toBe(404);
  await pg.exec("CREATE FUNCTION reject_performance_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$; CREATE TRIGGER reject_performance_history BEFORE INSERT ON performance_history FOR EACH ROW EXECUTE FUNCTION reject_performance_history();");
  expect((await request(f.alice.token,`/assessments/${f.reviewId}/objectives`,{kind:'objective',title:'Atomic objective',measure:'Must commit with its history',dueDate:'2026-05-01'})).status).toBe(500);
  expect(await context.db.select().from(schema.performanceObjectives)).toHaveLength(0);
});
