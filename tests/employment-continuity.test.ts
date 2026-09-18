import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/employmentContinuity';
import offboarding from '../server/routes/offboarding';
import equipment from '../server/routes/equipment';
import {authService} from '../server/services/auth';
import {qatarToday} from '../server/services/workplaceRecords';
let pg:PGlite,server:Server,base:string;
const reason='Verified supporting employment evidence';
const day=(n=0)=>new Date(Date.parse(qatarToday())+n*86400000).toISOString().slice(0,10);
async function req(token:string,path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
async function user(name:string,role:schema.UserRole='employee'){
 const [u]=await ctx.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('TestContinuity123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();
 const [e]=await ctx.db.insert(schema.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'private-'+name,primaryMobile:'private',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'temporary',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01',contractEndDate:day(10)}).returning();
 return {...u,employee:e,token:(await authService.login(name,'TestContinuity123!')).accessToken};
}
async function fixture(){return {admin:await user('admin','super_admin'),hr:await user('hr','hr'),alice:await user('alice'),bob:await user('bob')};}
async function renewal(f:any,extra:any={}){const r=await req(f.admin.token,'/work/renewals',{employeeId:f.alice.employee.id,employeeVersion:f.alice.employee.recordVersion,newEndDate:day(180),effectiveDate:day(),agreementReference:'AGREEMENT-VERIFIED-001',reason,...extra});expect(r.status).toBe(201);return r.body;}
const templateBody={name:'Event employee exit',employeeTypes:['temporary'],enabled:true,tasks:[{key:'kit',title:'Return event kit',kind:'asset',daysFromExit:0},{key:'handover',title:'Brief replacement lead',kind:'checklist',daysFromExit:-2}],reason};
async function template(f:any){const r=await req(f.admin.token,'/work/exit-templates',templateBody);expect(r.status).toBe(201);return r.body;}
async function startExit(f:any,t:any,extra:any={}){return req(f.admin.token,'/offboarding',{employeeId:f.alice.employee.id,templateId:t.id,templateVersion:t.version,targetExitDate:day(),owners:t.tasks.map((t:any)=>({key:t.key,ownerId:f.hr.employee.id})),reason,...extra});}
async function completedExit(f:any,deactivate=false){
 const t=await template(f),opened=await startExit(f,t);expect(opened.status).toBe(201);let row=opened.body;
 for(let index=0;index<row.tasks.length;index++){const r=await req(f.admin.token,`/offboarding/${row.id}/actions`,{action:'task',version:row.version,index,task:{...row.tasks[index],status:'done',notes:'PRIVATE-HR-COMPLETION-EVIDENCE'}});expect(r.status).toBe(200);row=r.body;}
 const r=await req(f.admin.token,`/offboarding/${row.id}/actions`,{action:'complete',version:row.version,deactivateAccount:deactivate,reason:'PRIVATE-HR-EXIT-DECISION'});expect(r.status).toBe(200);return r.body;
}
async function clearance(f:any,extra:any={}){const r=await req(f.admin.token,'/work/clearances',{employeeId:f.alice.employee.id,employeeVersion:f.alice.employee.recordVersion,returnDate:day(),reference:'RETURN-APPROVAL-001',reason,...extra});expect(r.status).toBe(201);return r.body;}
async function asset(f:any){const r=await req(f.admin.token,'/equipment/assets',{assetTag:'KIT-RETURN-001',name:'Event tablet',category:'FEC kit',serialNumber:'TEST-001',location:'Store',reason});expect(r.status).toBe(201);return r.body;}
async function issue(f:any,a:any,date=day()){return req(f.admin.token,'/equipment/custody',{assetId:a.id,assetVersion:a.version,employeeId:f.alice.employee.id,issuedDate:date,dueDate:day(5),reason});}
beforeAll(async()=>{process.env.JWT_SECRET='test-continuity-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-continuity-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/work',router);app.use('/offboarding',offboarding);app.use('/equipment',equipment);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,workforce_sites,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('expiry policy is admin editable, includes overdue contracts, and the queue is private',async()=>{
 const f=await fixture();expect((await req(f.alice.token,'/work/expiring')).status).toBe(403);expect((await req(f.hr.token,'/work/policy',{version:0,watchDays:5,reason})).status).toBe(403);
 expect((await req(f.admin.token,'/work/expiring')).body.items).toHaveLength(4);
 expect((await req(f.admin.token,'/work/policy',{version:0,watchDays:5,reason})).status).toBe(201);
 expect((await req(f.admin.token,'/work/policy',{version:0,watchDays:10,reason})).status).toBe(409);
 await ctx.db.update(schema.employees).set({contractEndDate:day(-2)}).where(eq(schema.employees.id,f.alice.employee.id));
 const q=await req(f.admin.token,'/work/expiring');expect(q.body.items).toHaveLength(1);expect(q.body.items[0].days_remaining).toBe(-2);expect(JSON.stringify(q.body)).not.toContain('private-');
 expect((await req(f.admin.token,'/work/policy-history')).body).toHaveLength(1);
});
test('contract renewal requires independent approval and application updates only the contract and lifecycle history',async()=>{
 const f=await fixture(),r=await renewal(f),path=`/work/renewals/${r.id}/actions`;
 expect((await req(f.alice.token,'/work/renewals')).body.items).toHaveLength(0);
 expect((await req(f.admin.token,path,{action:'approve',version:1,reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{action:'apply',version:1,reason})).status).toBe(409);
 const attempts=await Promise.all([req(f.hr.token,path,{action:'approve',version:1,reason}),req(f.hr.token,path,{action:'approve',version:1,reason})]);expect(attempts.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await req(f.alice.token,'/work/renewals')).body.items).toHaveLength(1);expect((await req(f.bob.token,'/work/renewals')).body.items).toHaveLength(0);
 expect((await req(f.alice.token,`/work/renewals/${r.id}/history`)).status).toBe(403);
 expect((await req(f.admin.token,path,{action:'apply',version:2,reason})).body.status).toBe('applied');
 const [e]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id));expect(e).toMatchObject({contractEndDate:day(180),type:'temporary',joiningDate:'2020-01-01',qidNumber:'private-alice',recordVersion:2});
 const events=await ctx.db.select().from(schema.employeeLifecycleEvents);expect(events.map((e:any)=>e.eventType)).toEqual(['contract_renewal']);
 expect((await req(f.admin.token,`/work/renewals/${r.id}/history`)).body).toHaveLength(3);
});
test('renewals reject future application, duplicate proposals and stale employee versions',async()=>{
 const f=await fixture(),r=await renewal(f,{effectiveDate:day(5)}),path=`/work/renewals/${r.id}/actions`;
 expect((await req(f.admin.token,'/work/renewals',{employeeId:f.alice.employee.id,employeeVersion:1,newEndDate:day(180),effectiveDate:day(),agreementReference:'SECOND',reason})).status).toBe(409);
 await req(f.hr.token,path,{version:1,action:'approve',reason});expect((await req(f.admin.token,path,{version:2,action:'apply',reason})).status).toBe(400);
 await req(f.admin.token,path,{version:2,action:'cancel',reason});const next=await renewal(f),nextPath=`/work/renewals/${next.id}/actions`;await req(f.hr.token,nextPath,{version:1,action:'approve',reason});
 await ctx.db.update(schema.employees).set({position:'Senior host'}).where(eq(schema.employees.id,f.alice.employee.id));
 expect((await req(f.admin.token,nextPath,{version:2,action:'apply',reason})).status).toBe(409);
 expect((await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id)))[0].contractEndDate).toBe(day(10));
});
test('open exits block renewal creation and are rechecked before applying an approved renewal',async()=>{
 const f=await fixture(),r=await renewal(f);await req(f.hr.token,`/work/renewals/${r.id}/actions`,{version:1,action:'approve',reason});const t=await template(f),exit=await startExit(f,t);expect(exit.status).toBe(201);
 expect((await req(f.admin.token,`/work/renewals/${r.id}/actions`,{version:2,action:'apply',reason})).status).toBe(409);
 await req(f.admin.token,`/work/renewals/${r.id}/actions`,{version:2,action:'cancel',reason});
 expect((await req(f.admin.token,'/work/renewals',{employeeId:f.alice.employee.id,employeeVersion:1,newEndDate:day(180),effectiveDate:day(),agreementReference:'NEW',reason})).status).toBe(409);
});
test('template versions preserve old cases, compute due dates, and enforce selected owners and employment types',async()=>{
 const f=await fixture();expect((await req(f.hr.token,'/work/exit-templates',templateBody)).status).toBe(403);const t=await template(f),r=await startExit(f,t);expect(r.status).toBe(201);
 expect(r.body.tasks.map((t:any)=>t.dueDate)).toEqual([day(),day(-2)]);expect(r.body.template_snapshot.version).toBe(1);
 expect((await req(f.admin.token,`/work/exit-templates/${t.id}`,{...templateBody,version:1,tasks:[{key:'new',title:'New clearance task',kind:'checklist',daysFromExit:3}]})).status).toBe(200);
 expect((await startExit(f,t,{employeeId:f.bob.employee.id})).status).toBe(409);
 const [old]=(await req(f.admin.token,'/offboarding')).body.items;expect(old.tasks[0].title).toBe('Return event kit');expect(old.template_snapshot.version).toBe(1);
 const newer=(await req(f.admin.token,'/work/exit-templates')).body.items[0];
 expect((await startExit(f,newer,{employeeId:f.bob.employee.id,owners:[{key:'new',ownerId:f.bob.employee.id}]})).status).toBe(400);
 await ctx.db.update(schema.employees).set({type:'permanent'}).where(eq(schema.employees.id,f.bob.employee.id));expect((await startExit(f,newer,{employeeId:f.bob.employee.id})).status).toBe(400);
 expect((await req(f.admin.token,`/work/exit-templates/${t.id}/history`)).body).toHaveLength(2);
});
test('disabled templates, forged task overrides and missing or duplicate task owners are rejected',async()=>{
 const f=await fixture(),t=await template(f);
 expect((await startExit(f,t,{tasks:[]})).status).toBe(400);
 expect((await startExit(f,t,{owners:[{key:'kit',ownerId:f.hr.employee.id},{key:'kit',ownerId:f.hr.employee.id}]})).status).toBe(400);
 expect((await startExit(f,t,{owners:[{key:'kit',ownerId:f.hr.employee.id}]})).status).toBe(400);
 await req(f.admin.token,`/work/exit-templates/${t.id}`,{...templateBody,version:1,enabled:false});
 expect((await startExit(f,{...t,version:2})).status).toBe(409);expect((await req(f.alice.token,'/work/exit-templates')).status).toBe(403);
});
test('return clearance unblocks equipment only after independent approval and never activates the account',async()=>{
 const f=await fixture(),exit=await completedExit(f,true),a=await asset(f);expect((await issue(f,a)).status).toBe(409);
 const c=await clearance(f),path=`/work/clearances/${c.id}/actions`;expect(c.exit_ids).toEqual([exit.id]);expect((await issue(f,a)).status).toBe(409);
 expect((await req(f.admin.token,path,{version:1,action:'approve',reason})).status).toBe(403);
 expect((await req(f.hr.token,path,{version:1,action:'approve',reason})).body.status).toBe('approved');
 // A transaction can begin before the exit it waits on completes. Its start
 // timestamp must not invalidate an otherwise correctly reviewed exit version.
 await pg.exec(`UPDATE return_work_clearances SET created_at=created_at-interval '1 day' WHERE id=${c.id}`);
 expect((await issue(f,a,day(-1))).status).toBe(409);expect((await issue(f,a)).status).toBe(201);
 const [account]=await ctx.db.select().from(schema.users).where(eq(schema.users.id,f.alice.id));expect(account.isActive).toBe(false);
 const [e]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id));expect(e).toMatchObject({status:'active',joiningDate:'2020-01-01',recordVersion:1});
 const logs=await ctx.db.select().from(schema.activityLogs);expect(JSON.stringify(logs)).not.toContain('PRIVATE-HR-');
 const exits=(await req(f.admin.token,'/offboarding')).body.items;expect(exits[0].decision_reason).toBe('PRIVATE-HR-EXIT-DECISION');
});
test('revocation and new exit cases invalidate equipment clearance, while stale decisions are rejected',async()=>{
 const f=await fixture();await completedExit(f);const a=await asset(f),c=await clearance(f),path=`/work/clearances/${c.id}/actions`;
 await req(f.hr.token,path,{version:1,action:'approve',reason});expect((await req(f.admin.token,path,{version:1,action:'revoke',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,action:'revoke',reason})).body.status).toBe('revoked');expect((await issue(f,a)).status).toBe(409);
 const replacement=await clearance(f);await req(f.hr.token,`/work/clearances/${replacement.id}/actions`,{version:1,action:'approve',reason});
 // Later corrections to an exit version require fresh clearance too.
 await pg.exec(`UPDATE offboarding_cases SET version=version+1 WHERE id=${replacement.exit_ids[0]}`);
 expect((await issue(f,a)).status).toBe(409);
 const refreshed=await clearance(f);await req(f.hr.token,`/work/clearances/${refreshed.id}/actions`,{version:1,action:'approve',reason});
 const t=(await req(f.admin.token,'/work/exit-templates')).body.items[0];expect((await startExit(f,t)).status).toBe(201);expect((await issue(f,a)).status).toBe(409);
 expect((await req(f.bob.token,'/work/clearances')).status).toBe(403);expect((await req(f.bob.token,`/work/clearances/${c.id}/history`)).status).toBe(403);
});
test('return clearance validates dates, active employment, outstanding exits and unchanged profile',async()=>{
 const f=await fixture(),t=await template(f);await startExit(f,t);
 const body={employeeId:f.alice.employee.id,employeeVersion:1,returnDate:day(),reference:'CHECKED-001',reason};
 expect((await req(f.admin.token,'/work/clearances',body)).status).toBe(409);
 const open=(await req(f.admin.token,'/offboarding')).body.items[0];let current=open;for(let index=0;index<current.tasks.length;index++)current=(await req(f.admin.token,`/offboarding/${open.id}/actions`,{version:current.version,action:'task',index,task:{...current.tasks[index],status:'done',notes:reason}})).body;
 await req(f.admin.token,`/offboarding/${open.id}/actions`,{version:current.version,action:'complete',deactivateAccount:false,reason});
 expect((await req(f.admin.token,'/work/clearances',{...body,returnDate:day(-1)})).status).toBe(400);
 const c=await clearance(f);await ctx.db.update(schema.employees).set({status:'inactive',terminationDate:day()}).where(eq(schema.employees.id,f.alice.employee.id));
 expect((await req(f.hr.token,`/work/clearances/${c.id}/actions`,{version:1,action:'approve',reason})).status).toBe(409);
 expect((await req(f.admin.token,'/work/clearances',{...body,employeeVersion:2})).status).toBe(400);
});
test('history failures roll back renewal application, exit creation and return clearance approval',async()=>{
 const f=await fixture(),r=await renewal(f),path=`/work/renewals/${r.id}/actions`;await req(f.hr.token,path,{version:1,action:'approve',reason});const t=await template(f);
 await pg.exec("CREATE FUNCTION reject_continuity_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'history unavailable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_continuity_history BEFORE INSERT ON lifecycle_history FOR EACH ROW EXECUTE FUNCTION reject_continuity_history();");
 try{
  expect((await req(f.admin.token,path,{version:2,action:'apply',reason})).status).toBe(500);expect((await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,f.alice.employee.id)))[0].contractEndDate).toBe(day(10));expect((await ctx.db.select().from(schema.employeeLifecycleEvents))).toHaveLength(0);
  expect((await startExit(f,t)).status).toBe(500);expect((await req(f.admin.token,'/offboarding')).body.items).toHaveLength(0);
 }finally{await pg.exec('DROP TRIGGER reject_continuity_history ON lifecycle_history; DROP FUNCTION reject_continuity_history();');}
 const open=await startExit(f,t);let current=open.body;for(let index=0;index<current.tasks.length;index++)current=(await req(f.admin.token,`/offboarding/${current.id}/actions`,{version:current.version,action:'task',index,task:{...current.tasks[index],status:'done',notes:reason}})).body;
 await req(f.admin.token,`/offboarding/${current.id}/actions`,{version:current.version,action:'complete',deactivateAccount:false,reason});const c=await clearance(f);
 await pg.exec("CREATE FUNCTION reject_clearance_history() RETURNS trigger AS $$ BEGIN IF NEW.kind='return_work_clearance' THEN RAISE EXCEPTION 'history unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_clearance_history BEFORE INSERT ON lifecycle_history FOR EACH ROW EXECUTE FUNCTION reject_clearance_history();");
 try{expect((await req(f.hr.token,`/work/clearances/${c.id}/actions`,{version:1,action:'approve',reason})).status).toBe(500);expect((await req(f.admin.token,'/work/clearances')).body.items[0].status).toBe('submitted');}finally{await pg.exec('DROP TRIGGER reject_clearance_history ON lifecycle_history; DROP FUNCTION reject_clearance_history();');}
});
