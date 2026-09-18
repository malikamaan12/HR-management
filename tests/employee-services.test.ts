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
beforeAll(async()=>{process.env.JWT_SECRET='test-services-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='test-services-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/services',services);app.use('/ops',operations);app.use('/keys',eosAdmin);app.use('/eos',eosApi);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,workforce_sites,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});
test('expense submission, independent approval and external payment retain history and reject self decisions',async()=>{
 const f=await fixture(),p=await policy(f),c=await claim(f,p);expect(c.status).toBe(201);const path=`/services/requests/${c.body.id}/actions`;
 expect((await req(f.alice.token,path,{version:1,action:'approve',reason})).status).toBe(403);
 expect((await req(f.bob.token,`/services/requests/${c.body.id}/history`)).status).toBe(404);
 expect((await req(f.admin.token,path,{version:1,action:'approve',reason})).body.status).toBe('approved');
 expect((await req(f.admin.token,path,{version:1,action:'pay',reason,paymentReference:'BANK-001'})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,action:'pay',reason})).status).toBe(409);
 expect((await req(f.admin.token,path,{version:2,action:'pay',reason,paymentReference:'BANK-001'})).body.status).toBe('paid');
 expect((await req(f.admin.token,path,{version:3,action:'reject',reason})).status).toBe(409);
 expect((await req(f.alice.token,`/services/requests/${c.body.id}/history`)).body).toHaveLength(3);
});
test('annual limits include pending requests and policy versions do not silently rewrite reservations',async()=>{
 const f=await fixture(),p=await policy(f);const c=await claim(f,p);expect(c.status).toBe(201);
 expect((await claim(f,p,{reference:'RECEIPT-002'})).status).toBe(409);
 expect((await req(f.admin.token,'/services/policies',{kind:'expense',name:p.name,expectedVersion:0,enabled:true,rules,reason})).status).toBe(409);
 expect((await req(f.alice.token,`/services/requests/${c.body.id}/actions`,{version:1,action:'withdraw',reason})).body.status).toBe('withdrawn');
 expect((await claim(f,p,{reference:'RECEIPT-002'})).status).toBe(201);
 const next=await req(f.admin.token,'/services/policies',{kind:'expense',name:p.name,expectedVersion:1,enabled:false,rules,reason});expect(next.status).toBe(201);
 expect((await claim(f,p,{amountCents:100,reference:'RECEIPT-003'})).status).toBe(409);
 expect((await req(f.admin.token,'/services/requests?kind=expense')).body.items[0].policy_rules).toEqual(rules);
});
test('benefit periods, role eligibility and independent enrollment decisions are enforced',async()=>{
 const f=await fixture(),p=await policy(f,'benefit');
 expect((await claim(f,p,{endDate:'2027-01-01'})).status).toBe(400);
 const c=await claim(f,p,{amountCents:5000});expect(c.status).toBe(201);
 expect((await claim(f,p,{amountCents:5000,reference:'BENEFIT-002'})).status).toBe(409);
 expect((await req(f.admin.token,`/services/requests/${c.body.id}/actions`,{version:1,action:'approve',reason})).body.status).toBe('approved');
 expect((await req(f.admin.token,`/services/requests/${c.body.id}/actions`,{version:2,action:'end',reason})).body.status).toBe('ended');
 const temp=await user('temp','temporary_staff');expect((await req(temp.token,'/services/policies?kind=benefit')).status).toBe(403);
});
test('request auditing failures roll back payment and version',async()=>{
 const f=await fixture(),p=await policy(f),c=await claim(f,p),path=`/services/requests/${c.body.id}/actions`;await req(f.admin.token,path,{version:1,action:'approve',reason});
 await pg.exec("CREATE FUNCTION fail_service_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_service_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_service_audit();");
 try{expect((await req(f.admin.token,path,{version:2,action:'pay',reason,paymentReference:'BANK-001'})).status).toBe(500);expect((await req(f.alice.token,'/services/requests?kind=expense')).body.items[0]).toMatchObject({status:'approved',version:2,payment_reference:null});}finally{await pg.exec('DROP TRIGGER fail_service_audit ON activity_logs; DROP FUNCTION fail_service_audit();');}
});
test('reports reconcile status totals, enforce scope and neutralize spreadsheet formulas',async()=>{
 const f=await fixture(),p=await policy(f);await claim(f,p);const r=await req(f.admin.token,'/ops/report?kind=expenses&from=2026-01-01&to=2026-12-31');expect(r.status).toBe(200);expect(r.body.totalsCents).toEqual({submitted:10000});
 const report=await req(f.bob.token,'/ops/report?kind=expenses&from=2026-01-01&to=2026-12-31');expect(report.status).toBe(200);expect(report.body.count).toBe(0);
 await pg.query("UPDATE employees SET employee_id='=unsafe' WHERE id=$1",[f.alice.employee.id]);const csv=await req(f.admin.token,'/ops/report?kind=expenses&from=2026-01-01&to=2026-12-31&format=csv');expect(csv.body).toContain("'=unsafe");expect(csv.body).not.toContain('private-');
 expect((await req(f.admin.token,'/ops/report?kind=expenses&from=2020-01-01&to=2026-12-31')).status).toBe(400);
});
test('helpdesk reminders are idempotent, escalate once and remain private',async()=>{
 const f=await fixture(),due=new Date(Date.now()-3600000);const [c]=await ctx.db.insert(schema.helpdeskCases).values({title:'Private issue',category:'other',requesterId:f.alice.id,assigneeId:f.admin.id,confidential:true,responseDueAt:due,resolutionDueAt:due}).returning();
 expect(await sweepHelpdeskReminders()).toEqual({processed:0,created:0});
 expect((await req(f.admin.token,'/ops/reminder-policy',{version:0,enabled:true,escalate:true,reason})).status).toBe(200);
 expect((await sweepHelpdeskReminders()).created).toBe(4);expect((await sweepHelpdeskReminders()).created).toBe(0);
 const own=await req(f.alice.token,'/ops/reminders');expect(own.body).toHaveLength(2);expect(JSON.stringify(own.body)).not.toContain('Private issue');
 expect((await req(f.bob.token,'/ops/reminders')).body).toEqual([]);
 const row=(await pg.query<any>('SELECT version,escalated_at FROM helpdesk_cases WHERE id=$1',[c.id])).rows[0];expect(row.version).toBe(2);expect(row.escalated_at).toBeTruthy();
 expect((await req(f.alice.token,`/ops/reminders/${own.body[0].id}/read`,{})).status).toBe(200);
 expect((await req(f.alice.token,'/ops/reminders')).body[0].readAt).toBeTruthy();
});
async function eosFixture(){const f=await fixture();const [site]=await ctx.db.insert(schema.workforceSites).values({name:'Test mall',timezone:'Asia/Qatar'}).returning();const teams=await ctx.db.insert(schema.workforceTeams).values([{name:'Allowed',kind:'event',siteId:site.id},{name:'Other',kind:'event',siteId:site.id}]).returning();for(const t of teams){const [s]=await ctx.db.insert(schema.workforceShifts).values({teamId:t.id,role:'Host',headcount:1,startAt:new Date('2026-12-01T08:00:00Z'),endAt:new Date('2026-12-01T16:00:00Z'),createdBy:f.admin.id}).returning();await ctx.db.insert(schema.workforceAssignments).values({shiftId:s.id,employeeId:f.alice.employee.id,createdBy:f.admin.id});}const key=await req(f.admin.token,'/keys',{name:'EOS test',teamId:teams[0].id,expiresAt:new Date(Date.now()+86400000).toISOString()});expect(key.status).toBe(201);return {...f,key:key.body,teams};}
test('EOS credentials restrict assignment snapshots and change feed to one team and revoke immediately',async()=>{
 const f=await eosFixture();expect((await req(f.admin.token,'/eos/assignments')).status).toBe(401);const list=await req(f.key.secret,'/eos/assignments');expect(list.status).toBe(200);expect(list.body.items).toHaveLength(1);expect(JSON.stringify(list.body)).not.toMatch(/private|salary|qid/i);
 const changes=await req(f.key.secret,'/eos/changes');expect(changes.body.items).toHaveLength(1);await pg.exec("UPDATE workforce_assignments SET status='cancelled' WHERE id=1");const next=await req(f.key.secret,'/eos/changes?after='+changes.body.nextCursor);expect(next.body.items[0].payload.status).toBe('cancelled');
 expect(JSON.stringify((await req(f.admin.token,'/keys')).body)).not.toContain(f.key.secret);
 await req(f.admin.token,`/keys/${f.key.id}/revoke`,{});expect((await req(f.key.secret,'/eos/assignments')).status).toBe(401);
});
test('EOS activation links replay identical idempotency keys and reject changed payloads',async()=>{
 const f=await eosFixture(),headers={'Idempotency-Key':'eos-request-0000001'},body={externalId:'EOS-A001',label:'Mall activation'};
 const first=await req(f.key.secret,'/eos/activations',body,headers);expect(first.status).toBe(201);expect((await req(f.key.secret,'/eos/activations',body,headers)).body).toEqual(first.body);
 expect((await req(f.key.secret,'/eos/activations',{...body,label:'Changed'},headers)).status).toBe(409);
 expect((await req(f.key.secret,'/eos/activations',body)).status).toBe(400);
 expect((await req(f.alice.token,'/keys')).status).toBe(403);
});
