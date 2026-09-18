import equipment from '../server/routes/equipment';
import handbook from '../server/routes/handbook';
import offboarding from '../server/routes/offboarding';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import services from '../server/routes/employeeServices';
import operations from '../server/routes/operationsCenter';
import {eosAdmin,eosApi} from '../server/routes/eos';
import {sweepHelpdeskReminders} from '../server/services/helpdeskReminders';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
async function req(token:string,path:string,body?:unknown,headers:Record<string,string>={}){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text()};}
async function user(name:string,role:schema.UserRole='employee'){const [u]=await ctx.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('TestServices123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();const [e]=await ctx.db.insert(schema.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'private-'+name,primaryMobile:'private',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'permanent',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01'}).returning();return {...u,employee:e,token:(await authService.login(name,'TestServices123!')).accessToken};}
const reason='Checked supporting evidence';
async function fixture(){return {admin:await user('admin','super_admin'),alice:await user('alice'),bob:await user('bob')};}
const rules={perRequestCents:10000,annualCapCents:15000,employeeTypes:['permanent']};
async function policy(f:any,kind='expense'){const r=await req(f.admin.token,'/services/policies',{kind,name:'Travel support',expectedVersion:0,enabled:true,rules,reason});expect(r.status).toBe(201);return r.body;}
async function claim(f:any,p:any,extra:any={}){return req(f.alice.token,'/services/requests',{kind:p.kind,policyId:p.id,title:'Verified request',amountCents:10000,serviceDate:'2026-01-02',endDate:p.kind==='benefit'?'2026-06-30':null,evidence:reason,reference:'RECEIPT-001',...extra});}
beforeAll(async()=>{process.env.JWT_SECRET='test-services-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-services-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/equipment',equipment);app.use('/handbook',handbook);app.use('/offboarding',offboarding);app.use('/services',services);app.use('/ops',operations);app.use('/keys',eosAdmin);app.use('/eos',eosApi);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,workforce_sites,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

async function asset(f:any){const r=await req(f.admin.token,'/equipment/assets',{assetTag:'KIT-001',name:'FEC tablet',category:'Event kit',serialNumber:'SERIAL-001',location:'Main store',reason});expect(r.status).toBe(201);return r.body;}
async function issue(f:any,a:any,employeeId=f.alice.employee.id){return req(f.admin.token,'/equipment/custody',{assetId:a.id,assetVersion:a.version,employeeId,issuedDate:'2026-01-02',dueDate:'2030-01-01',reason});}
async function handbookDraft(f:any){const r=await req(f.admin.token,'/handbook/policies',{title:'Equipment care policy',body:'Report missing equipment to HR and return all issued items after the assignment.',employeeTypes:['permanent'],department:'Operations',dueDate:'2030-01-01',reason});expect(r.status).toBe(201);return r.body;}
test('inventory authorization, duplicate custody and employee privacy are enforced',async()=>{
 const f=await fixture(),a=await asset(f);expect((await req(f.alice.token,'/equipment/assets')).status).toBe(403);
 const attempts=await Promise.all([issue(f,a),issue(f,a,f.bob.employee.id)]);expect(attempts.map(r=>r.status).sort()).toEqual([201,409]);const r=attempts.find(r=>r.status===201)!.body;
 const owner=r.employee_id===f.alice.employee.id?f.alice:f.bob,other=owner.id===f.alice.id?f.bob:f.alice;
 expect((await req(owner.token,'/equipment/custody')).body.items).toHaveLength(1);expect((await req(other.token,'/equipment/custody')).body.items).toHaveLength(0);
 expect((await req(other.token,`/equipment/history/equipment_custody/${r.id}`)).status).toBe(404);
 expect((await issue(f,a,f.admin.employee.id)).status).toBe(403);
 expect((await req(f.admin.token,`/equipment/assets/${a.id}`,{assetTag:a.asset_tag,name:a.name,category:a.category,serialNumber:a.serial_number,location:a.location,reason,version:a.version,status:'retired'})).status).toBe(409);
});
test('employee receipt and inspected return preserve history and release equipment',async()=>{
 const f=await fixture(),a=await asset(f),r=await issue(f,a),path=`/equipment/custody/${r.body.id}/actions`;
 expect((await req(f.admin.token,path,{version:1,action:'receipt',reason})).status).toBe(404);
 expect((await req(f.alice.token,path,{version:1,action:'receipt',reason})).body.receipt_at).toBeTruthy();
 expect((await req(f.alice.token,path,{version:1,action:'request_return',reason})).status).toBe(409);
 expect((await req(f.alice.token,path,{version:2,action:'request_return',reason})).body.status).toBe('return_requested');
 expect((await req(f.alice.token,path,{version:3,action:'close',returnedDate:'2026-01-03',disposition:'available',reason})).status).toBe(403);
 expect((await req(f.admin.token,path,{version:3,action:'close',returnedDate:'2026-01-01',disposition:'available',reason})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:3,action:'close',returnedDate:'2026-01-03',disposition:'available',reason})).body.status).toBe('closed');
 expect((await req(f.alice.token,`/equipment/history/equipment_custody/${r.body.id}`)).body).toHaveLength(4);
 expect((await issue(f,{...a,version:2},f.bob.employee.id)).status).toBe(201);
});
test('outstanding equipment blocks offboarding even when checklist tasks are done',async()=>{
 const f=await fixture(),a=await asset(f),r=await issue(f,a);const task={title:'Return kit',kind:'asset',ownerId:f.admin.employee.id,dueDate:'2026-01-03',status:'pending',notes:''};const c=await req(f.admin.token,'/offboarding',{employeeId:f.alice.employee.id,reason,tasks:[task]});expect(c.status).toBe(201);
 await req(f.admin.token,`/offboarding/${c.body.id}/actions`,{version:1,action:'task',index:0,task:{...task,status:'done',notes:reason}});
 const done={version:2,action:'complete',deactivateAccount:false,reason};expect((await req(f.admin.token,`/offboarding/${c.body.id}/actions`,done)).status).toBe(409);
 expect((await req(f.admin.token,'/offboarding')).body.items[0].outstanding_assets).toBe(1);
 await req(f.admin.token,`/equipment/custody/${r.body.id}/actions`,{version:1,action:'close',returnedDate:'2026-01-03',disposition:'maintenance',reason});expect((await req(f.admin.token,`/offboarding/${c.body.id}/actions`,done)).body.status).toBe('completed');
});
test('equipment closure rolls back custody, inventory and history on audit failure',async()=>{
 const f=await fixture(),a=await asset(f),r=await issue(f,a);await pg.exec("CREATE FUNCTION fail_workplace_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_workplace_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_workplace_audit();");
 try{expect((await req(f.admin.token,`/equipment/custody/${r.body.id}/actions`,{version:1,action:'close',returnedDate:'2026-01-03',disposition:'lost',reason})).status).toBe(500);expect((await pg.query('SELECT status,version FROM equipment_custody WHERE id=$1',[r.body.id])).rows[0]).toMatchObject({status:'issued',version:1});expect((await pg.query('SELECT status,version FROM equipment_assets WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'available',version:1});}finally{await pg.exec('DROP TRIGGER fail_workplace_audit ON activity_logs; DROP FUNCTION fail_workplace_audit();');}
});
test('policy publication targets eligible employees and freezes acknowledged versions across revisions',async()=>{
 const f=await fixture(),p=await handbookDraft(f);await pg.query("UPDATE employees SET department='Finance' WHERE id=$1",[f.bob.employee.id]);const path=`/handbook/policies/${p.id}/actions`;
 expect((await req(f.alice.token,'/handbook/mine')).body.items).toHaveLength(0);
 expect((await req(f.admin.token,path,{version:1,action:'publish',reason})).body.assigned).toBe(2);
 const original=(await req(f.alice.token,'/handbook/mine')).body.items[0];expect(original.body).toBe(p.body);expect((await req(f.bob.token,'/handbook/mine')).body.items).toHaveLength(0);
 expect((await req(f.alice.token,`/handbook/acknowledgements/${original.id}`,{confirmed:true})).status).toBe(200);
 await req(f.admin.token,path,{version:2,action:'revise',reason});const revisedBody='Revised policy: report equipment incidents promptly and return all items to the designated custodian.';
 await req(f.admin.token,`/handbook/policies/${p.id}`,{version:3,title:p.title,body:revisedBody,employeeTypes:['permanent'],department:'Operations',dueDate:'2030-01-01',reason});expect((await req(f.admin.token,path,{version:4,action:'publish',reason})).body.assigned).toBe(2);
 const assigned=(await req(f.alice.token,'/handbook/mine')).body.items;expect(assigned).toHaveLength(2);expect(assigned.find((a:any)=>a.id===original.id)).toMatchObject({body:p.body,acknowledged_at:expect.any(String)});expect(assigned.find((a:any)=>a.id!==original.id)).toMatchObject({body:revisedBody,acknowledged_at:null});
 expect((await req(f.admin.token,`/handbook/policies/${p.id}/history`)).body).toHaveLength(5);
});
test('acknowledgements cannot be forged and withdrawal closes only outstanding requests',async()=>{
 const f=await fixture(),p=await handbookDraft(f),path=`/handbook/policies/${p.id}/actions`;expect((await req(f.alice.token,path,{version:1,action:'publish',reason})).status).toBe(403);await req(f.admin.token,path,{version:1,action:'publish',reason});const a=(await req(f.alice.token,'/handbook/mine')).body.items[0];
 expect((await req(f.bob.token,`/handbook/acknowledgements/${a.id}`,{confirmed:true})).status).toBe(404);expect((await req(f.alice.token,`/handbook/acknowledgements/${a.id}`,{confirmed:false})).status).toBe(400);
 expect((await req(f.admin.token,path,{version:2,action:'assign',reason})).body.assigned).toBe(0);
 await req(f.admin.token,path,{version:2,action:'withdraw',reason});expect((await req(f.alice.token,`/handbook/acknowledgements/${a.id}`,{confirmed:true})).status).toBe(409);expect((await req(f.alice.token,`/handbook/policies/${p.id}/recipients`)).status).toBe(403);
});
test('failed publication audit leaves the draft unpublished and creates no assignments',async()=>{
 const f=await fixture(),p=await handbookDraft(f);await pg.exec("CREATE FUNCTION fail_policy_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_policy_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_policy_audit();");
 try{expect((await req(f.admin.token,`/handbook/policies/${p.id}/actions`,{version:1,action:'publish',reason})).status).toBe(500);expect((await pg.query('SELECT status,version FROM handbook_policies WHERE id=$1',[p.id])).rows[0]).toMatchObject({status:'draft',version:1});expect((await pg.query('SELECT * FROM handbook_assignments')).rows).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER fail_policy_audit ON activity_logs; DROP FUNCTION fail_policy_audit();');}
});
