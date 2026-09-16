import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import type {Server} from 'node:http';
import * as schema from '../shared/schema';
const context=vi.hoisted(()=>({db:null as any,uploaded:[] as string[],deleted:[] as string[]}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
vi.mock('../server/services/r2',()=>({privateStorageConfigured:()=>true,validateDocumentFile:(f:any)=>{if(!f.buffer.toString().startsWith('%PDF-'))throw Error('Invalid file');return 'pdf';},uploadServiceFile:async(kind:string,id:number)=>{const key=`employee-services/${kind}/${id}/${context.uploaded.length}.pdf`;context.uploaded.push(key);return key;},deleteServiceFile:async(key:string)=>{context.deleted.push(key);},serviceFileUrl:async(key:string)=>'https://private.example.test/'+key}));
import learning from '../server/routes/learning';
import employeeServices from '../server/routes/employee-services';
import {authService} from '../server/services/auth';
import {businessToday} from '../server/services/hr-rules';
import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
let pg:PGlite,server:Server,base:string;
const password='EmployeeServicesTest9!';
async function account(name:string,role:schema.UserRole='employee'){const [u]=await context.db.insert(schema.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,password)).accessToken};}
async function person(u:any,name:string){return (await context.db.insert(schema.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Employee',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'PRIVATE-'+name,primaryMobile:'private-phone',residentialAddress:'private-address',emergencyContactName:'private',emergencyContactNumber:'private',type:'permanent',department:'Operations',position:'Host',location:'Test',joiningDate:'2020-01-01'}).returning())[0];}
async function request(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json() as any};}
async function attachment(token:string,path:string,version:number,contents='%PDF-synthetic receipt'){const f=new FormData();f.set('version',String(version));f.set('file',new Blob([contents],{type:'application/pdf'}),'receipt.pdf');const r=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:f});return {status:r.status,body:await r.json() as any};}
async function fixture(){const admin=await account('admin','super_admin'),reviewer=await account('reviewer','admin'),finance=await account('finance','finance'),alice=await account('alice'),bob=await account('bob'),e=await person(alice,'Alice'),other=await person(bob,'Bob');return {admin,reviewer,finance,alice,bob,e,other};}
const rule=(approverId:number,patch={})=>({enabled:true,employeeTypes:['permanent'],departments:[],minServiceDays:0,annualLimit:'100.00',perRequestLimit:'80.00',unit:'QAR',receiptRequired:false,submissionDays:30,approverId,...patch});
async function policy(f:Awaited<ReturnType<typeof fixture>>,kind='benefit',patch={}){return request(f.admin.token,`/${kind==='expense'?'expenses':'benefits'}/policies`,{kind,key:'wellbeing',name:'Wellbeing',employeeId:null,effectiveFrom:businessToday(),config:rule(f.reviewer.id,kind==='expense'?{receiptRequired:true}:{}),reason:'Approved company policy',...patch});}
async function draft(f:Awaited<ReturnType<typeof fixture>>,kind='benefit',patch={}){return request(f.alice.token,`/${kind==='expense'?'expenses':'benefits'}/requests`,{employeeId:f.e.id,policyKey:'wellbeing',requestDate:businessToday(),title:'Synthetic request',details:'Approved test business purpose',...(kind==='expense'?{items:[{description:'Travel receipt',amount:'40.05'},{description:'Local taxi',amount:'9.95'}]}:{quantity:'60.00'}),...patch});}
async function action(token:string,path:string,action:string,extra={}){const d=await request(token,path);expect(d.status).toBe(200);return request(token,path+'/actions',{version:d.body.row.version,action,reason:'Recorded synthetic decision',...extra});}
const course=(approverId:number,patch={})=>({title:'Safety induction',description:'Learn the site safety procedure',provider:'Internal training',format:'online',url:'https://example.test/course',durationMinutes:60,capacity:2,passScore:70,requiresEvidence:true,validMonths:12,approverId,status:'published',...patch});
async function enrollment(f:Awaited<ReturnType<typeof fixture>>,patch={}){const c=await request(f.admin.token,'/learning/courses',course(f.reviewer.id));expect(c.status).toBe(201);const e=await request(f.alice.token,'/learning/enrollments',{employeeId:f.e.id,courseId:c.body.id,dueDate:null,reason:'Required role training',...patch});expect(e.status).toBe(201);return {course:c.body,row:e.body,path:'/learning/enrollments/'+e.body.id};}
beforeAll(async()=>{process.env.JWT_SECRET='services-test-access-key-32-characters';process.env.JWT_REFRESH_SECRET='services-test-refresh-key-32-characters';process.env.APP_TIMEZONE='Asia/Qatar';pg=new PGlite();for(const file of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));context.db=drizzle(pg);const app=express();app.use(express.json());app.use(authenticate,moduleAccess);app.use('/learning',learning);app.use('/benefits',employeeServices('benefit'));app.use('/expenses',employeeServices('expense'));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as {port:number}).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE users RESTART IDENTITY CASCADE');context.uploaded=[];context.deleted=[];});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await pg.close();});

test('learning completes only after approval, evidence and independent verification; private files stay scoped',async()=>{
 const f=await fixture(),e=await enrollment(f);expect((await action(f.alice.token,e.path,'approve')).status).toBe(403);
 expect((await action(f.reviewer.token,e.path,'approve')).status).toBe(200);expect((await action(f.alice.token,e.path,'submit_completion')).status).toBe(409);
 let detail=await request(f.alice.token,e.path);const file=await attachment(f.alice.token,e.path+'/files',detail.body.row.version);expect(file.status).toBe(201);
 expect((await request(f.bob.token,e.path)).status).toBe(404);expect((await request(f.bob.token,e.path+'/files/'+file.body.id+'/download')).status).toBe(404);
 expect((await request(f.alice.token,e.path+'/files/'+file.body.id+'/download')).status).toBe(200);
 expect((await action(f.alice.token,e.path,'progress',{progress:50})).status).toBe(200);expect((await action(f.alice.token,e.path,'submit_completion')).status).toBe(200);
 expect((await action(f.alice.token,e.path,'verify',{score:100})).status).toBe(403);const saved=await action(f.reviewer.token,e.path,'verify',{score:85});expect(saved.status).toBe(200);expect(saved.body).toMatchObject({status:'completed',score:85,certificateNumber:'E3-LRN-'+e.row.id,progress:100});expect(saved.body.expiresOn).toMatch(/^\d{4}-/);
 expect((await action(f.reviewer.token,e.path,'verify',{score:100})).status).toBe(409);detail=await request(f.alice.token,e.path);expect(JSON.stringify(detail.body)).not.toMatch(/PRIVATE-|private-phone|objectKey|private-address/);
});
test('course capacity, saved rules, stale versions and employee override authority are enforced',async()=>{
 const f=await fixture(),c=await request(f.admin.token,'/learning/courses',course(f.reviewer.id,{capacity:1,requiresEvidence:false}));
 const input={employeeId:f.e.id,courseId:c.body.id,dueDate:null,reason:'Required role learning'};
 expect((await request(f.alice.token,'/learning/enrollments',{...input,override:{passScore:0,requiresEvidence:false,validMonths:null,reason:'Forged exemption'}})).status).toBe(403);
 const results=await Promise.all([request(f.alice.token,'/learning/enrollments',input),request(f.bob.token,'/learning/enrollments',{...input,employeeId:f.other.id})]);expect(results.map(r=>r.status).sort()).toEqual([201,409]);
 const enrolled=results.find(r=>r.status===201)!.body,path='/learning/enrollments/'+enrolled.id,owner=enrolled.employeeId===f.e.id?f.alice:f.bob;
 expect((await request(f.admin.token,'/learning/courses/'+c.body.id,{version:1,definition:course(f.reviewer.id,{capacity:1,passScore:95,requiresEvidence:true}),reason:'Stricter future requirements'},'PATCH')).status).toBe(200);
 expect((await request(f.admin.token,'/learning/courses/'+c.body.id,{version:1,definition:course(f.reviewer.id),reason:'Stale course edit'},'PATCH')).status).toBe(409);
 expect((await action(f.reviewer.token,path,'approve')).status).toBe(200);expect((await action(owner.token,path,'submit_completion')).status).toBe(200);const final=await action(f.reviewer.token,path,'verify',{score:75});expect(final.body.status).toBe('completed');expect(final.body.courseSnapshot.passScore).toBe(70);
});
test('training reviewer reassignments require an active independent scoped approver',async()=>{
 const f=await fixture(),e=await enrollment(f),manager=await account('manager','manager');await person(manager,'Manager');
 expect((await action(f.admin.token,e.path,'reassign',{approverId:manager.id})).status).toBe(400);
 expect((await action(f.alice.token,e.path,'reassign',{approverId:f.admin.id})).status).toBe(403);
 expect((await action(f.admin.token,e.path,'reassign',{approverId:f.admin.id})).status).toBe(200);
 expect((await action(f.reviewer.token,e.path,'approve')).status).toBe(403);expect((await action(f.admin.token,e.path,'approve')).status).toBe(200);
 expect((await action(f.alice.token,e.path,'withdraw')).body.status).toBe('withdrawn');
});
test('benefit requests reserve annual entitlement, release on return/cancel, and retain policy history',async()=>{
 const f=await fixture();expect((await policy(f)).status).toBe(201);const one=await draft(f),two=await draft(f);const path='/benefits/requests/'+one.body.id;
 expect((await action(f.alice.token,path,'submit')).status).toBe(200);expect((await action(f.alice.token,'/benefits/requests/'+two.body.id,'submit')).status).toBe(409);
 expect((await request(f.alice.token,'/benefits/entitlements?employeeId='+f.e.id)).body[0]).toMatchObject({reserved:'60.00',remaining:'40.00'});
 expect((await action(f.reviewer.token,path,'return')).status).toBe(200);expect((await request(f.alice.token,'/benefits/entitlements?employeeId='+f.e.id)).body[0].remaining).toBe('100.00');
 expect((await action(f.alice.token,path,'submit')).status).toBe(200);expect((await policy(f,'benefit',{config:rule(f.reviewer.id,{annualLimit:'200.00',perRequestLimit:'90.00'})})).status).toBe(201);
 expect((await action(f.reviewer.token,path,'approve')).status).toBe(200);expect((await request(f.alice.token,path)).body.row.policySnapshot.config.annualLimit).toBe('100.00');
 expect((await action(f.alice.token,path,'fulfill',{reference:'self-activation',confirmed:true})).status).toBe(403);
 const fulfilled=await action(f.reviewer.token,path,'fulfill',{reference:'BEN-TEST-1',confirmed:true});expect(fulfilled.body.status).toBe('fulfilled');expect(fulfilled.body.history.map((h:any)=>h.action)).toContain('return');
 expect((await action(f.reviewer.token,path,'cancel')).status).toBe(409);
});
test('effective employee overrides control eligibility and per-request caps with immutable policies',async()=>{
 const f=await fixture();await policy(f);await policy(f,'benefit',{employeeId:f.e.id,config:rule(f.reviewer.id,{enabled:false})});expect((await draft(f)).status).toBe(409);
 await policy(f,'benefit',{employeeId:f.e.id,config:rule(f.reviewer.id,{annualLimit:'30',perRequestLimit:'20'})});
 const claim=await draft(f,'benefit',{quantity:'21'});expect(claim.status).toBe(201);expect((await action(f.alice.token,'/benefits/requests/'+claim.body.id,'submit')).status).toBe(409);
 expect((await request(f.bob.token,'/benefits/entitlements?employeeId='+f.e.id)).status).toBe(404);expect((await request(f.alice.token,'/benefits/policies')).status).toBe(403);
 await expect(pg.exec("UPDATE service_policies SET name='tampered'")).rejects.toThrow(/immutable/);
});
test('simultaneous benefit submissions cannot overdraw an annual entitlement',async()=>{
 const f=await fixture();await policy(f);const a=await draft(f),b=await draft(f);
 const results=await Promise.all([action(f.alice.token,'/benefits/requests/'+a.body.id,'submit'),action(f.alice.token,'/benefits/requests/'+b.body.id,'submit')]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 const winning=results.find(r=>r.status===200)!.body;expect((await action(f.alice.token,'/benefits/requests/'+winning.id,'cancel')).status).toBe(200);
 const remaining=(await request(f.alice.token,'/benefits/entitlements?employeeId='+f.e.id)).body[0].remaining;expect(remaining).toBe('100.00');
});
test('expense claims sum server-side, require receipts and independent approval before finance records reimbursement',async()=>{
 const f=await fixture();await policy(f,'expense');const d=await draft(f,'expense');expect(d.body.amount).toBe('50.00');const path='/expenses/requests/'+d.body.id;
 expect((await action(f.alice.token,path,'submit')).status).toBe(409);expect((await attachment(f.alice.token,path+'/files',1,'not-a-pdf')).status).toBe(400);
 const file=await attachment(f.alice.token,path+'/files',1);expect(file.status).toBe(201);expect((await request(f.alice.token,path+'/actions',{version:1,action:'submit',reason:'Stale submit attempt'})).status).toBe(409);
 expect((await action(f.alice.token,path,'submit')).status).toBe(200);expect((await attachment(f.alice.token,path+'/files',3)).status).toBe(409);
 expect((await action(f.finance.token,path,'fulfill',{reference:'BANK-1',confirmed:true})).status).toBe(409);expect((await action(f.alice.token,path,'approve')).status).toBe(403);
 expect((await action(f.reviewer.token,path,'approve')).status).toBe(200);expect((await action(f.finance.token,path,'fulfill',{reference:'BANK-1',confirmed:false})).status).toBe(400);
 const paid=await action(f.finance.token,path,'fulfill',{reference:'BANK-1',confirmed:true});expect(paid.status).toBe(200);expect(paid.body).toMatchObject({status:'fulfilled',fulfillmentReference:'BANK-1',fulfilledBy:f.finance.id});
 expect((await action(f.finance.token,path,'fulfill',{reference:'BANK-2',confirmed:true})).status).toBe(409);
 expect((await request(f.bob.token,path+'/files/'+file.body.id+'/download')).status).toBe(404);expect((await request(f.alice.token,'/benefits/requests/'+d.body.id)).status).toBe(404);
});
test('returned claims can be corrected while audit failures roll back files and entitlement changes',async()=>{
 const f=await fixture();await policy(f,'expense');const d=await draft(f,'expense'),path='/expenses/requests/'+d.body.id;
 await pg.exec("CREATE FUNCTION reject_service_file_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='service_file' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER service_audit_test BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_service_file_audit()");
 try{expect((await attachment(f.alice.token,path+'/files',1)).status).toBe(500);expect(context.deleted).toEqual(context.uploaded);expect((await request(f.alice.token,path)).body.files).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER service_audit_test ON activity_logs; DROP FUNCTION reject_service_file_audit()');}
 expect((await attachment(f.alice.token,path+'/files',1)).status).toBe(201);await action(f.alice.token,path,'submit');await action(f.reviewer.token,path,'return');const version=(await request(f.alice.token,path)).body.row.version;
 expect((await request(f.alice.token,path,{version,employeeId:f.e.id,policyKey:'wellbeing',requestDate:businessToday(),title:'Corrected claim',details:'Corrected the submitted amounts',items:[{description:'Corrected receipt',amount:'30.03'}]},'PATCH')).body.amount).toBe('30.03');
 await pg.exec("CREATE FUNCTION reject_service_request_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='service_request' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER service_audit_test BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_service_request_audit()");try{expect((await action(f.alice.token,path,'submit')).status).toBe(500);expect((await request(f.alice.token,path)).body.row.status).toBe('draft');}finally{await pg.exec('DROP TRIGGER service_audit_test ON activity_logs; DROP FUNCTION reject_service_request_audit()');}
 expect((await request(f.alice.token,'/expenses/entitlements?employeeId='+f.e.id)).body[0].remaining).toBe('100.00');
});
test('role scopes, revoked approvers, forged amounts and future dates fail closed',async()=>{
 const f=await fixture(),manager=await account('manager','manager'),m=await person(manager,'Manager');await policy(f,'expense');
 expect((await request('','/expenses/requests')).status).toBe(401);expect((await request(f.alice.token,'/expenses/policies')).status).toBe(403);
 expect((await draft(f,'expense',{amount:'1.00'})).status).toBe(400);expect((await draft(f,'expense',{requestDate:'2200-01-01'})).status).toBe(400);
 const d=await draft(f,'expense'),path='/expenses/requests/'+d.body.id;expect((await request(manager.token,path)).status).toBe(404);
 await context.db.update(schema.employees).set({reportingManagerId:m.id}).where(eq(schema.employees.id,f.e.id));expect((await request(manager.token,path)).status).toBe(200);
 await attachment(f.alice.token,path+'/files',1);await action(f.alice.token,path,'submit');await context.db.update(schema.users).set({role:'employee'}).where(eq(schema.users.id,f.reviewer.id));expect((await request(f.reviewer.token,path+'/actions',{version:3,action:'approve',reason:'Previously assigned reviewer'})).status).toBeGreaterThanOrEqual(400);
});
