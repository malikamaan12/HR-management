import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import {defaultCompanySettings} from '../shared/settings';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
const files=vi.hoisted(()=>({upload:vi.fn(),remove:vi.fn(),download:vi.fn()}));
vi.mock('../server/services/r2',()=>({uploadDocument:files.upload,deleteDocumentObject:files.remove,documentDownloadUrl:files.download,validateDocumentFile:vi.fn(),StorageUnavailableError:class extends Error{}}));
import router from '../server/routes/documents';
import {authService} from '../server/services/auth';
import {qatarToday} from '../server/services/workflowRecords';
let pg:PGlite,server:Server,base:string;const reason='Verified document evidence';
const day=(n=0)=>new Date(Date.parse(qatarToday())+n*86400000).toISOString().slice(0,10);
async function req(token:string,path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});return {status:r.status,body:r.status===302?{}:await r.json()};}
async function user(name:string,role:s.UserRole='employee',department='Operations'){
 const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('DocumentTest123!',4),firstName:name,lastName:'Test',role,department,isActive:true,approvalStatus:'approved'}).returning();
 const [e]=await ctx.db.insert(s.employees).values({userId:u.id,employeeId:name,firstName:name,lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'PRIVATE-QID-'+name,primaryMobile:'PRIVATE-PHONE',residentialAddress:'Private',emergencyContactName:'Private',emergencyContactNumber:'Private',type:'temporary',department,position:'Host',location:'FEC',joiningDate:'2020-01-01'}).returning();
 return {...u,employee:e,token:(await authService.login(name,'DocumentTest123!')).accessToken};
}
async function fixture(){return {admin:await user('admin','super_admin'),hr:await user('hr','hr'),dept:await user('dept','hr_manager'),outsider:await user('outsider','hr_manager','Sales'),alice:await user('alice'),bob:await user('bob')};}
async function doc(u:any,type='Passport',number='OLD-123',expiry=day(20)){
 const [d]=await ctx.db.insert(s.documents).values({employeeId:u.employee.id,documentType:type,documentNumber:number,issueDate:'2020-01-01',expiryDate:expiry,status:'valid',documentFile:'private/original.pdf'}).returning();
 await ctx.db.insert(s.documentVersions).values({documentId:d.id,version:1,snapshot:d,createdBy:u.id});return d;
}
async function upload(u:any,d:any,endpoint='renewal-requests',expectedVersion=1){const data=new FormData();for(const [k,v] of Object.entries({documentNumber:'NEW-456',issueDate:day(),expiryDate:day(365),issueAuthority:'Authority',notes:'PRIVATE-PROPOSED-NOTES',reason,expectedVersion:String(expectedVersion)}))data.append(k,v);data.append('document',new Blob(['%PDF-1.4 test'],{type:'application/pdf'}),'new.pdf');const r=await fetch(base+'/'+d.id+'/'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+u.token},body:data});return {status:r.status,body:await r.json()};}
async function policy(u:any,extra:any={}){return req(u.token,'/review-policy',{version:0,replacementMode:'all',documentTypes:[],requireAssignedReviewer:true,reviewDays:5,reason,...extra});}
const path=(r:any,suffix='')=>'/renewal-requests/'+r.id+suffix;
async function submit(f:any,d:any){const r=await upload(f.alice,d);expect(r.status).toBe(201);return r.body;}
beforeAll(async()=>{process.env.JWT_SECRET='document-governance-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='document-governance-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use(authenticate,moduleAccess);app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,hr_workflow_history,app_settings RESTART IDENTITY CASCADE');files.upload.mockReset().mockResolvedValue('private/proposal.pdf');files.remove.mockReset().mockResolvedValue(undefined);files.download.mockReset().mockResolvedValue('https://files.example.test/private');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('approval policies are admin-only, versioned, validated and audited',async()=>{
 const f=await fixture();expect((await req(f.alice.token,'/review-policy')).body).toMatchObject({version:0,canEdit:false,replacementMode:'optional'});
 expect((await policy(f.hr)).status).toBe(403);expect((await policy(f.admin,{documentTypes:['Passport',' passport ']})).status).toBe(400);
 expect((await policy(f.admin,{reviewDays:0})).status).toBe(400);expect((await policy(f.admin)).status).toBe(201);expect((await policy(f.admin)).status).toBe(409);
 expect((await req(f.alice.token,'/review-policy/history')).status).toBe(403);const h=await req(f.admin.token,'/review-policy/history');expect(h.body.items).toHaveLength(1);expect(h.body.items[0].snapshot.replacement_mode).toBe('all');
});
test('replacement approval applies by document type and self-service mode, including all-role enforcement',async()=>{
 const f=await fixture(),d=await doc(f.alice);expect((await req(f.alice.token,'/'+d.id)).body.canReplace).toBe(true);
 await policy(f.admin,{replacementMode:'self_service',documentTypes:[' passport '],requireAssignedReviewer:false});
 expect((await req(f.alice.token,'/'+d.id)).body).toMatchObject({approvalRequired:true,canReplace:false,canRequestRenewal:true});
 expect((await upload(f.alice,d,'replace')).status).toBe(403);expect(files.upload).not.toHaveBeenCalled();
 expect((await upload(f.hr,d,'replace')).status).toBe(200);
 const other=await doc(f.alice,'Training certificate');expect((await upload(f.alice,other,'replace')).status).toBe(200);
 await policy(f.admin,{version:1});expect((await upload(f.admin,d,'replace',2)).status).toBe(403);
 expect((await upload(f.alice,d,'renewal-requests',2)).status).toBe(201);
});
test('a policy tightened during storage upload blocks replacement and cleans the unused object',async()=>{
 const f=await fixture(),d=await doc(f.alice);files.upload.mockImplementationOnce(async()=>{expect((await policy(f.admin)).status).toBe(201);return 'private/late.pdf';});
 expect((await upload(f.alice,d,'replace')).status).toBe(403);expect(files.remove).toHaveBeenCalledWith('private/late.pdf');expect((await req(f.admin.token,'/'+d.id)).body.documentNumber).toBe('OLD-123');
});
test('assignment requires an eligible independent reviewer and serializes decisions and reassignment',async()=>{
 const f=await fixture(),d=await doc(f.alice);await policy(f.admin);const r=await submit(f,d);
 expect((await req(f.hr.token,path(r,'/decision'),{decision:'approved',reason,version:1})).status).toBe(409);
 const candidates=await req(f.hr.token,path(r,'/reviewers'));expect(candidates.body.items.map((u:any)=>u.id)).toEqual(expect.arrayContaining([f.hr.id,f.admin.id,f.dept.id]));expect(candidates.body.items.map((u:any)=>u.id)).not.toContain(f.outsider.id);
 expect((await req(f.alice.token,path(r,'/assignment'),{version:1,reviewerId:f.hr.id,reason})).status).toBe(403);
 for(const id of [f.alice.id,f.bob.id,f.outsider.id])expect((await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:id,reason})).status).toBe(400);
 expect((await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:f.hr.id,reason})).body.version).toBe(2);
 expect((await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:f.dept.id,reason})).status).toBe(409);
 expect((await req(f.admin.token,path(r,'/decision'),{version:2,decision:'approved',reason})).status).toBe(403);
 expect((await req(f.hr.token,path(r,'/decision'),{decision:'approved',reason})).status).toBe(409);
 const list=(await req(f.hr.token,'/renewal-requests?view=assigned')).body;expect(list.items[0].canReview).toBe(true);
 const outcomes=await Promise.all([req(f.hr.token,path(r,'/decision'),{version:2,decision:'approved',reason}),req(f.admin.token,path(r,'/assignment'),{version:2,reviewerId:f.dept.id,reason})]);expect(outcomes.filter(o=>o.status===200)).toHaveLength(1);expect(outcomes.filter(o=>o.status===409)).toHaveLength(1);
 const history=(await req(f.alice.token,path(r,'/history'))).body.items;expect(history).toHaveLength(3);expect(JSON.stringify(history)).not.toContain('private/proposal');expect(JSON.stringify(history)).not.toContain('PRIVATE-PROPOSED');
});
test('request assignment rules and due date are pinned when admin changes the current policy',async()=>{
 const f=await fixture(),d=await doc(f.alice);await policy(f.admin);const r=await submit(f,d);expect(r.reviewDueDate).toBe(day(5));
 await policy(f.admin,{version:1,replacementMode:'optional',requireAssignedReviewer:false,reviewDays:20});
 expect((await req(f.hr.token,path(r,'/decision'),{version:1,decision:'approved',reason})).status).toBe(409);
 await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:f.hr.id,reason});expect((await req(f.hr.token,path(r,'/decision'),{version:2,decision:'approved',reason})).status).toBe(200);
 const r2=await upload(f.alice,d,'renewal-requests',2);expect(r2.body.reviewDueDate).toBe(day(20));await policy(f.admin,{version:2});
 expect((await req(f.hr.token,path(r2.body,'/decision'),{version:1,decision:'approved',reason})).status).toBe(200);
});
test('assignment never expands read, download or history scope and current reviewer eligibility is rechecked',async()=>{
 const f=await fixture(),d=await doc(f.alice),r=await submit(f,d);
 for(const suffix of ['/history','/download','/reviewers'])expect((await req(f.outsider.token,path(r,suffix))).status).toBe(404);
 expect((await req(f.bob.token,path(r,'/history'))).status).toBe(404);expect((await req(f.outsider.token,'/renewal-requests')).body.items).toHaveLength(0);
 await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:f.dept.id,reason});
 await ctx.db.update(s.users).set({department:'Sales'}).where(eq(s.users.id,f.dept.id));
 expect((await req(f.dept.token,'/renewal-requests?view=assigned')).body.items).toHaveLength(0);expect((await req(f.dept.token,path(r,'/decision'),{version:2,decision:'approved',reason})).status).toBe(404);
 await ctx.db.update(s.users).set({isActive:false}).where(eq(s.users.id,f.hr.id));expect((await req(f.admin.token,path(r,'/assignment'),{version:2,reviewerId:f.hr.id,reason})).status).toBe(400);
 expect((await req(f.admin.token,path(r,'/assignment'),{version:2,reviewerId:f.admin.id,reason})).status).toBe(200);expect((await req(f.admin.token,path(r,'/decision'),{version:3,decision:'approved',reason})).status).toBe(200);
});
test('history failure rolls back policy, assignment and approved document changes without deleting the proposal',async()=>{
 const f=await fixture(),d=await doc(f.alice),r=await submit(f,d);
 await pg.exec("CREATE FUNCTION fail_document_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER fail_document_history BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION fail_document_history();");
 try{
  expect((await policy(f.admin)).status).toBe(500);expect((await req(f.admin.token,'/review-policy')).body.version).toBe(0);
  expect((await req(f.admin.token,path(r,'/assignment'),{version:1,reviewerId:f.hr.id,reason})).status).toBe(500);
  expect((await req(f.hr.token,path(r,'/decision'),{version:1,decision:'approved',reason})).status).toBe(500);
  expect((await req(f.alice.token,'/'+d.id)).body).toMatchObject({documentNumber:'OLD-123',currentVersion:1});const requests=(await req(f.hr.token,'/renewal-requests')).body.items;expect(requests[0]).toMatchObject({status:'pending',version:1,assignedReviewerId:null});expect(files.remove).not.toHaveBeenCalled();
 }finally{await pg.exec('DROP TRIGGER fail_document_history ON hr_workflow_history; DROP FUNCTION fail_document_history();');}
});
test('document register paginates after scope and search, using current Qatar dates and configured expiry window',async()=>{
 const f=await fixture();await ctx.db.insert(s.appSettings).values({key:'company',value:{...defaultCompanySettings,documentExpiryDays:5}});
 for(let i=0;i<27;i++)await doc(f.alice,'Passport','MATCH-'+i,day(i-1));await doc(f.bob,'Passport','MATCH-private',day(-10));await doc(f.alice,'Certificate','100%_literal',day(1));
 const first=await req(f.alice.token,'/register?q=MATCH&type=passport'),second=await req(f.alice.token,'/register?q=MATCH&type=passport&page=2');expect(first.body.counts).toEqual({all:27,expired:1,expiring_soon:6,valid:20});expect(first.body.items).toHaveLength(25);expect(second.body.items).toHaveLength(2);expect(first.body.hasMore).toBe(true);expect(second.body.hasMore).toBe(false);expect(new Set([...first.body.items,...second.body.items].map(d=>d.id)).size).toBe(27);
 expect(JSON.stringify(first.body)).not.toContain('MATCH-private');expect(JSON.stringify(first.body)).not.toContain('PRIVATE-QID');expect((await req(f.alice.token,'/register?q=%25_')).body.items).toHaveLength(1);
 expect((await req(f.alice.token,'/register?status=expired')).body.total).toBe(1);expect((await req(f.outsider.token,'/register')).body.total).toBe(0);expect((await req(f.alice.token,'/register?page=0')).status).toBe(400);
});
test('overdue queue excludes final requests, and old clients cannot decide reassigned versions',async()=>{
 const f=await fixture(),d=await doc(f.alice),r=await submit(f,d);await ctx.db.update(s.documentRenewalRequests).set({reviewDueDate:day(-1)}).where(eq(s.documentRenewalRequests.id,r.id));
 expect((await req(f.hr.token,'/renewal-requests?view=overdue')).body.items[0].overdue).toBe(true);
 expect((await req(f.alice.token,path(r,'/decision'),{decision:'withdrawn',reason})).status).toBe(200);expect((await req(f.hr.token,'/renewal-requests?view=overdue')).body.items).toHaveLength(0);
 expect((await req(f.alice.token,path(r,'/assignment'),{version:2,reviewerId:f.hr.id,reason})).status).toBe(403);expect((await req(f.admin.token,path(r,'/assignment'),{version:2,reviewerId:f.hr.id,reason})).status).toBe(409);
});

test('document detail, legacy list, register and replacement agree after midnight in Qatar',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-18T21:30:00.000Z'));
 try{
  const f=await fixture(),d=await doc(f.alice,'Passport','AFTER-MIDNIGHT','2026-09-18');
  expect((await req(f.alice.token,'/'+d.id)).body.status).toBe('expired');expect((await req(f.alice.token,'/')).body[0].status).toBe('expired');expect((await req(f.alice.token,'/register')).body.counts.expired).toBe(1);
  await ctx.db.insert(s.appSettings).values({key:'company',value:{...defaultCompanySettings,documentExpiryDays:365}});
  expect((await upload(f.alice,d,'replace')).body.status).toBe('expiring_soon');expect((await req(f.alice.token,'/'+d.id)).body.status).toBe('expiring_soon');
 }finally{vi.useRealTimers();}
});


test('renewal submission time matches its audit even when the database session uses Qatar time',async()=>{
 await pg.exec("SET TIME ZONE 'Asia/Qatar'");
 try{const f=await fixture(),d=await doc(f.alice),r=await submit(f,d);const history=(await req(f.alice.token,path(r,'/history'))).body.items;
 expect(Math.abs(Date.parse(r.createdAt)-Date.parse(history[0].created_at))).toBeLessThan(5000);
 }finally{await pg.exec("SET TIME ZONE 'UTC'");}
});
