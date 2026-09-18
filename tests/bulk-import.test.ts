import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import Papa from 'papaparse';
import * as s from '../shared/schema';
import {employeeImportColumns} from '../shared/employee-import';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/bulkImport';
import {authService} from '../server/services/auth';
import {importReportCsv,parseEmployeeCsv} from '../server/services/bulkImport';
let pg:PGlite,server:Server,base:string;const reason='Reviewed source employment records';
async function user(name='admin',role:s.UserRole='super_admin'){
 const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('ImportTest123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();
 return {...u,token:(await authService.login(name,'ImportTest123!')).accessToken};
}
const sample=(n=1,extra:Record<string,string>={})=>({employeeId:'EMP-'+String(n).padStart(5,'0'),firstName:'Synthetic',lastName:'Worker '+n,gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'0000000'+String(n).padStart(4,'0'),primaryMobile:'+97400000',residentialAddress:'PRIVATE-ADDRESS',emergencyContactName:'PRIVATE-CONTACT',emergencyContactNumber:'+97400001',department:'Operations',position:'FEC host',location:'Mall activation',joiningDate:'2026-01-01',type:'temporary',...extra});
const csv=(data:any[])=>{const fields=[...new Set(data.flatMap(row=>Object.keys(row)))];return Papa.unparse({fields,data:data.map(row=>fields.map(key=>row[key]??''))});};
async function req(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){
 const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text(),headers:r.headers};
}
async function upload(u:any,content:string|Uint8Array,key=randomUUID(),name='staff.csv'){
 const data=new FormData();data.append('submissionKey',key);data.append('file',new Blob([content as any],{type:'text/csv'}),name);const r=await fetch(base+'/upload',{method:'POST',headers:{Authorization:'Bearer '+u.token},body:data});return {status:r.status,body:await r.json()};
}
async function draft(u:any,data:any[]=[sample()]){const r=await upload(u,csv(data));expect(r.status).toBe(201);return r.body.job;}
const path=(j:any,suffix='')=>'/job/'+j.id+suffix;
const commit=(u:any,j:any)=>req(u.token,path(j,'/commit'),{version:j.version,reason,confirmedRows:j.includedRows});
const records=async(u:any,j:any)=>(await req(u.token,path(j,'/rows'))).body.items;
const edit=(u:any,j:any,row:any,extra:any)=>req(u.token,path(j,'/rows/'+row.id),{version:j.version,reason,...extra},'PATCH');
async function existing(n=1,extra:any={}){const [e]=await ctx.db.insert(s.employees).values({...sample(n),...extra}).returning();return e;}
beforeAll(async()=>{process.env.JWT_SECRET='bulk-import-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='bulk-import-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE employees,users,lifecycle_history RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('imports require current administrator access and jobs stay private to their uploader',async()=>{
 const admin=await user(),other=await user('other'),hr=await user('hr','hr'),staff=await user('staff','employee'),j=await draft(admin);
 for(const endpoint of ['/jobs','/template','/columns',path(j),path(j,'/rows'),path(j,'/report'),path(j,'/history')]){expect((await req('',endpoint)).status).toBe(401);expect((await req(hr.token,endpoint)).status).toBe(403);expect((await req(staff.token,endpoint)).status).toBe(403);}
 for(const suffix of ['','/rows','/report','/history'])expect((await req(other.token,path(j,suffix))).status).toBe(404);
 expect((await commit(other,j)).status).toBe(404);expect((await req(other.token,'/jobs')).body.items).toHaveLength(0);expect((await upload(hr,csv([sample()]))).status).toBe(403);
 await ctx.db.update(s.users).set({role:'employee'}).where(eq(s.users.id,admin.id));expect((await commit(admin,j)).status).toBe(403);
});
test('UTF-8 CSV stages without creating people or accounts and preserves identifiers and quoted values',async()=>{
 const admin=await user(),data=sample(1,{firstName:'أحمد',lastName:'Test, Worker',residentialAddress:'First line\nSecond line',personalEmail:'person@example.test'});let content=csv([data]).replace('employeeId','employee_id').replace('personalEmail','email');
 const r=await upload(admin,'\ufeff'+content);expect(r.status).toBe(201);expect(r.body.job).toMatchObject({status:'draft',failedRows:0,totalRows:1,includedRows:1,version:1});
 const row=(await records(admin,r.body.job))[0];expect(row.payload).toMatchObject(data);expect((await ctx.db.select().from(s.employees))).toHaveLength(0);expect((await ctx.db.select().from(s.users))).toHaveLength(1);expect((await req(admin.token,path(r.body.job))).headers.get('cache-control')).toBe('no-store');
});
test('headers, encodings, malformed records and technical limits reject the file without saving private data',async()=>{
 const admin=await user();const valid=csv([sample()]);
 for(const content of ['', 'employeeId\n',valid.replace('firstName','unknownColumn'),valid.replace('lastName','first_name'),valid.replace('employeeId','username'),valid.replace('employeeId','password'),valid.replace('employeeId','role'),valid+'\nonly,two',new Uint8Array([0xff,0xfe,0x41,0])])expect((await upload(admin,content)).status).toBe(400);
 expect((await upload(admin,valid,'not-a-uuid')).status).toBe(400);expect((await upload(admin,valid,randomUUID(),'staff.xlsx')).status).toBe(400);
 expect((await upload(admin,'a'.repeat(2*1024*1024+1))).status).toBe(413);
 expect(()=>parseEmployeeCsv(Buffer.from(csv(Array.from({length:501},(_,i)=>sample(i+1)))))).toThrow(/500/);
 expect(parseEmployeeCsv(Buffer.from(csv(Array.from({length:500},(_,i)=>sample(i+1)))))).toHaveLength(500);
 expect((await ctx.db.select().from(s.bulkImportJobs))).toHaveLength(0);
});
test('row validation reports invalid calendar dates, missing fields, enum values, email and numeric limits',async()=>{
 const admin=await user(),j=await draft(admin,[sample(1,{firstName:' ',dateOfBirth:'2026-02-30',personalEmail:'bad email',gender:'PRIVATE-BAD-VALUE',eventStaffEligible:'maybe',noticePeriod:'2e3'}),sample(2,{dateOfBirth:'2026-02-01',contractEndDate:'2025-12-01'})]);expect(j.failedRows).toBe(2);
 const rows=await records(admin,j);expect(rows[0].errors.map((e:any)=>e.field)).toEqual(expect.arrayContaining(['firstName','dateOfBirth','personalEmail','gender','eventStaffEligible','noticePeriod']));expect(rows[1].errors.some((e:any)=>e.field==='dates')).toBe(true);
 const blocked=await commit(admin,j);expect(blocked.status).toBe(409);expect(blocked.body.job.version).toBe(2);expect((await ctx.db.select().from(s.employees))).toHaveLength(0);
 const report=await req(admin.token,path(j,'/report'));expect(report.body).not.toContain('PRIVATE-BAD-VALUE');expect(report.body).not.toContain('PRIVATE-ADDRESS');expect(report.body).not.toContain('00000000001');
});
test('duplicate errors apply to all included copies and exclusion recalculates the whole draft',async()=>{
 const admin=await user();let j=await draft(admin,[sample(),sample(2,{employeeId:' emp-00001 ',qidNumber:'00000000001'})]);expect(j.failedRows).toBe(2);const rows=await records(admin,j);
 const changed=await edit(admin,j,rows[1],{included:false});expect(changed.status).toBe(200);j=changed.body;expect(j).toMatchObject({includedRows:1,excludedRows:1,failedRows:0,version:2});
 expect((await commit(admin,j)).status).toBe(200);expect((await ctx.db.select().from(s.employees))).toHaveLength(1);expect((await records(admin,j))[1].employeeId).toBeNull();
});
test('row corrections are versioned, reject protected fields and concurrent edits cannot overwrite one another',async()=>{
 const admin=await user();let j=await draft(admin,[sample(1,{firstName:''})]);const row=(await records(admin,j))[0];
 expect((await edit(admin,j,row,{payload:{...sample(),userId:'1'}})).status).toBe(400);expect((await edit(admin,j,row,{payload:{...sample(),password:'secret'}})).status).toBe(400);
 const outcomes=await Promise.all([edit(admin,j,row,{payload:sample(1,{firstName:'First correction'})}),edit(admin,j,row,{payload:sample(1,{firstName:'Second correction'})})]);expect(outcomes.map(r=>r.status).sort()).toEqual([200,409]);j=outcomes.find(r=>r.status===200)!.body;
 expect(j.failedRows).toBe(0);expect((await req(admin.token,path(j,'/history'))).body.items).toHaveLength(2);expect((await commit(admin,{...j,version:1})).status).toBe(409);
});
test('new employees can reference existing or same-file managers and cycles or invalid dependencies block commit',async()=>{
 const admin=await user();const mgr=await existing(90);let j=await draft(admin,[sample(1,{managerEmployeeId:'EMP-00002'}),sample(2,{secondaryManagerEmployeeId:'EMP-00001'})]);expect(j.failedRows).toBe(2);
 let rows=await records(admin,j);j=(await edit(admin,j,rows[1],{payload:sample(2,{managerEmployeeId:mgr.employeeId,workSchedule:'management_office',eventStaffEligible:'true'})})).body;expect(j.failedRows).toBe(0);
 j=(await edit(admin,j,rows[1],{included:false})).body;expect(j.failedRows).toBe(1);j=(await edit(admin,j,rows[1],{included:true})).body;
 expect((await commit(admin,j)).status).toBe(200);const all=await ctx.db.select().from(s.employees);const first=all.find((e:any)=>e.employeeId==='EMP-00001'),second=all.find((e:any)=>e.employeeId==='EMP-00002');expect(first.reportingManagerId).toBe(second.id);expect(second).toMatchObject({reportingManagerId:mgr.id,workSchedule:'management_office',eventStaffEligible:true,userId:null});
});
test('inactive managers and malformed or excluded manager references are not silently dropped',async()=>{
 const admin=await user();await existing(90,{status:'inactive'});const j=await draft(admin,[sample(1,{managerEmployeeId:'EMP-00090'}),sample(2,{managerEmployeeId:'NOT-FOUND'}),sample(3,{managerEmployeeId:'EMP-00003'})]);expect(j.failedRows).toBe(3);expect((await commit(admin,j)).status).toBe(409);
});
test('commit is atomic and repeatable, and new employee audit logs exclude source personal fields',async()=>{
 const admin=await user(),j=await draft(admin,[sample(),sample(2,{type:'contract',contractEndDate:'2027-01-01',eventStaffEligible:'true',noticePeriod:'30',probationPeriod:'3'})]);
 expect((await req(admin.token,path(j,'/commit'),{version:1,confirmedRows:1,reason})).status).toBe(409);
 const [a,b]=await Promise.all([commit(admin,j),commit(admin,j)]);expect([a.status,b.status]).toEqual([200,200]);expect([a.body.replayed,b.body.replayed].filter(Boolean)).toHaveLength(1);
 const created=await ctx.db.select().from(s.employees);expect(created).toHaveLength(2);expect(created[0].qidNumber).toBe('00000000001');expect(created[1]).toMatchObject({type:'contract',eventStaffEligible:true,noticePeriod:30,probationPeriod:3});expect(created.every((e:any)=>e.userId===null)).toBe(true);
 const logs=JSON.stringify(await ctx.db.select().from(s.activityLogs));expect(logs).not.toContain('PRIVATE-ADDRESS');expect(logs).not.toContain('00000000001');expect((await req(admin.token,path(j,'/history'))).body.items).toHaveLength(2);
 expect((await commit(admin,{...j,version:2})).status).toBe(409);
});
test('new database conflicts invalidate the preview without importing any of the file',async()=>{
 const admin=await user(),j=await draft(admin,[sample(),sample(2)]);await existing(90,{employeeId:'emp-00001',qidNumber:'OTHER-QID'});
 const r=await commit(admin,j);expect(r.status).toBe(409);expect(r.body.job).toMatchObject({status:'draft',successfulRows:0,failedRows:1,version:2});expect((await ctx.db.select().from(s.employees))).toHaveLength(1);
 const recheck=await req(admin.token,path(j,'/revalidate'),{version:2});expect(recheck.body.version).toBe(3);
});
test('two import jobs racing for the same employee create one record and block the other draft',async()=>{
 const admin=await user(),j1=await draft(admin),j2=await draft(admin);const r=await Promise.all([commit(admin,j1),commit(admin,j2)]);expect(r.map(x=>x.status).sort()).toEqual([200,409]);expect((await ctx.db.select().from(s.employees))).toHaveLength(1);
});
test('audit failures roll back staging and commit, and a later retry can commit the original draft',async()=>{
 const admin=await user(),j=await draft(admin,[sample(),sample(2,{managerEmployeeId:'EMP-00001'})]);
 await pg.exec("CREATE FUNCTION reject_import_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_import_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_import_audit();");
 try{
  expect((await upload(admin,csv([sample(3)]))).status).toBe(500);expect((await ctx.db.select().from(s.bulkImportJobs))).toHaveLength(1);
  expect((await commit(admin,j)).status).toBe(500);expect((await ctx.db.select().from(s.employees))).toHaveLength(0);expect((await req(admin.token,path(j))).body).toMatchObject({status:'draft',version:1,successfulRows:0});expect((await records(admin,j)).every((r:any)=>r.employeeId===null)).toBe(true);
 }finally{await pg.exec('DROP TRIGGER reject_import_audit ON activity_logs; DROP FUNCTION reject_import_audit();');}
 expect((await commit(admin,j)).status).toBe(200);
});
test('replayed uploads reuse a job while conflicting content, cancellation and empty selection are explicit',async()=>{
 const admin=await user(),key=randomUUID(),content=csv([sample()]);const [a,b]=await Promise.all([upload(admin,content,key),upload(admin,content,key)]);expect(a.body.jobId).toBe(b.body.jobId);expect((await ctx.db.select().from(s.bulkImportJobs))).toHaveLength(1);expect((await upload(admin,csv([sample(2)]),key)).status).toBe(409);
 let j=a.body.job;const row=(await records(admin,j))[0];j=(await edit(admin,j,row,{included:false})).body;expect((await req(admin.token,path(j,'/commit'),{version:j.version,confirmedRows:1,reason})).status).toBe(400);
 expect((await req(admin.token,path(j,'/cancel'),{version:j.version,reason})).body.status).toBe('cancelled');expect((await req(admin.token,path(j,'/revalidate'),{version:j.version+1})).status).toBe(409);expect((await records(admin,j))).toHaveLength(1);
});
test('preview pages filter after ownership and CSV result downloads neutralize spreadsheet formulas',async()=>{
 const admin=await user(),j=await draft(admin,Array.from({length:52},(_,i)=>sample(i+1,{firstName:i===51?'':'Synthetic'})));
 const first=await req(admin.token,path(j,'/rows')),last=await req(admin.token,path(j,'/rows?page=3')),errors=await req(admin.token,path(j,'/rows?filter=errors'));expect(first.body.items).toHaveLength(25);expect(last.body.items).toHaveLength(2);expect(errors.body.items[0].rowNumber).toBe(53);expect(last.body.hasMore).toBe(false);
 expect((await req(admin.token,path(j,'/rows?page=0'))).status).toBe(400);
 const report=importReportCsv([{rowNumber:2,included:true,errors:[{field:'=FIELD',message:'=HYPERLINK("example")'}],employeeId:null}]);const parsed=Papa.parse<any>(report,{header:true}).data[0];expect(parsed.field).toBe("'=FIELD");expect(parsed.message.startsWith("'=HYPERLINK")).toBe(true);
});
test('legacy job totals remain readable but cannot execute through the reviewed import path',async()=>{
 const admin=await user();const [j]=await ctx.db.insert(s.bulkImportJobs).values({fileName:'old.csv',fileUrl:'inline-upload',uploadedBy:admin.id,status:'failed',totalRows:3,successfulRows:2,failedRows:1,errorLog:[{data:'LEGACY-PRIVATE'}]}).returning();
 const r=await req(admin.token,path(j));expect(r.body).toMatchObject({staged:false,status:'failed',successfulRows:2});expect(JSON.stringify(r.body)).not.toContain('LEGACY-PRIVATE');expect((await commit(admin,{...j,includedRows:1})).status).toBe(409);expect((await req(admin.token,path(j,'/report'))).status).toBe(409);
});

test('new draft and completion timestamps agree with audit time even in a non-UTC database session',async()=>{
 await pg.exec("SET TIME ZONE 'Asia/Qatar'");
 try{
  const admin=await user(),j=await draft(admin),history=(await req(admin.token,path(j,'/history'))).body.items;
  expect(Math.abs(Date.parse(j.createdAt)-Date.parse(history[0].created_at))).toBeLessThan(5000);
  const r=await commit(admin,j);expect(r.status).toBe(200);expect(Date.parse(r.body.job.completedAt)).toBeGreaterThanOrEqual(Date.parse(j.createdAt));
 }finally{await pg.exec("SET TIME ZONE 'UTC'");}
});
