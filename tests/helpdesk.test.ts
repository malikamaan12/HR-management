import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import express from 'express';
import type {Server} from 'node:http';
import {users,helpdeskCases,helpdeskMessages,helpdeskAttachments,type UserRole} from '../shared/schema';
const context=vi.hoisted(()=>({db:null as any,available:true,uploads:[] as string[],deleted:[] as string[],signed:[] as string[]}));
vi.mock('../server/db',()=>({get db(){return context.db;},pool:{}}));
vi.mock('../server/services/r2',()=>{
  class StorageUnavailableError extends Error{}
  return {StorageUnavailableError,privateStorageConfigured:()=>context.available,
    validateDocumentFile:(file:Express.Multer.File)=>{if(file.buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('invalid');return 'pdf';},
    uploadCaseAttachment:async(id:number)=>{if(!context.available)throw new StorageUnavailableError();const key=`helpdesk/${id}/abcd-${context.uploads.length+1}.pdf`;context.uploads.push(key);return key;},
    deleteCaseAttachment:async(key:string)=>{context.deleted.push(key);},caseAttachmentUrl:async(key:string)=>{context.signed.push(key);return 'https://private-storage.example.test/download';}};
});
import router from '../server/routes/helpdesk';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const password='HelpdeskTestPass8!';
async function account(name:string,role:UserRole='employee'){
  const [user]=await context.db.insert(users).values({username:name,email:name+'@example.test',firstName:name,lastName:'Test',password:await bcrypt.hash(password,4),role,isActive:true,approvalStatus:'approved'}).returning();
  return {...user,token:(await authService.login(name,password)).accessToken};
}
async function request(token:string,path:string,body?:unknown){
  const multipart=body instanceof FormData;
  const res=await fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,...multipart?{}:{'Content-Type':'application/json'}},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
  const text=await res.text();return {status:res.status,body:res.headers.get('content-type')?.includes('json')?JSON.parse(text):text,location:res.headers.get('location')};
}
function multipart(values:Record<string,string>,content='%PDF-test',filename='evidence.pdf'){
  const form=new FormData();for(const [key,value] of Object.entries(values))form.set(key,value);form.set('file',new Blob([content],{type:'application/pdf'}),filename);return form;
}
async function create(token:string,extra:Record<string,unknown>={}){
  const response=await request(token,'/cases',{title:'Support request',category:'payroll',body:'Please review my payroll question.',...extra});expect(response.status).toBe(201);return response.body.id as number;
}
async function detail(token:string,id:number){const res=await request(token,`/cases/${id}`);expect(res.status).toBe(200);return res.body;}
async function action(token:string,id:number,values:Record<string,unknown>){const row=await detail(token,id);return request(token,`/cases/${id}/actions`,{version:row.case.version,...values});}
async function reply(token:string,id:number,body:string,internal=false){const row=await detail(token,id);return request(token,`/cases/${id}/messages`,{version:row.case.version,body,internal});}
beforeAll(async()=>{
  process.env.JWT_SECRET='test-helpdesk-access-secret-at-least-32-characters';process.env.JWT_REFRESH_SECRET='test-helpdesk-refresh-secret-at-least-32-characters';
  pg=new PGlite();for(const name of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  context.db=drizzle(pg);const app=express();app.use(express.json());app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
});
beforeEach(async()=>{await pg.exec('DROP TRIGGER IF EXISTS fail_attachment_test ON helpdesk_attachments; TRUNCATE users RESTART IDENTITY CASCADE');context.available=true;context.uploads=[];context.deleted=[];context.signed=[];});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pg.close();});

test('employees see only their own requests and cannot forge ownership or internal-note access',async()=>{
  const alice=await account('alice'),bob=await account('bob'),lead=await account('lead','event_manager');const id=await create(alice.token);
  expect((await request('','/cases')).status).toBe(401);
  expect((await request(bob.token,'/cases')).body.total).toBe(0);
  expect((await request(bob.token,`/cases/${id}`)).status).toBe(404);
  expect((await request(lead.token,`/cases/${id}`)).status).toBe(404);
  expect((await request(lead.token,'/cases?view=queue')).status).toBe(403);
  expect((await request(bob.token,`/cases/${id}/messages`,{version:1,body:'Stolen reply'})).status).toBe(404);
  expect((await reply(alice.token,id,'Private fake note',true)).status).toBe(403);
  expect((await request(alice.token,'/cases',{title:'Forged case',category:'other',body:'Forged requester details',requesterId:bob.id})).status).toBe(400);
});
test('confidential cases are excluded from ordinary HR queues, search, totals and direct access',async()=>{
  const employee=await account('employee'),hr=await account('hr','hr'),admin=await account('admin','admin'),director=await account('director','hr_director');
  await create(employee.token,{title:'Ordinary case'});const restricted=await create(employee.token,{title:'Sensitive relations',category:'employee_relations',confidential:false});
  expect((await detail(employee.token,restricted)).case.confidential).toBe(true);
  for(const user of [hr,admin]){expect((await request(user.token,'/cases?view=queue')).body.total).toBe(1);expect((await request(user.token,'/cases?view=queue&q=Sensitive')).body.total).toBe(0);expect((await request(user.token,`/cases/${restricted}`)).status).toBe(404);}
  expect((await request(director.token,'/cases?view=queue')).body.total).toBe(2);
  const body=await detail(director.token,restricted);expect(body.capabilities.staff).toBe(true);expect(JSON.stringify(body)).not.toMatch(/password|email|refreshToken|bank|qidNumber/);
});
test('explicit assignment grants HR responders case access and unassignment removes it',async()=>{
  const employee=await account('employee'),director=await account('director','hr_director'),manager=await account('manager','hr_manager'),lead=await account('lead','department_head');
  const id=await create(employee.token,{confidential:true});
  expect((await request(manager.token,`/cases/${id}`)).status).toBe(404);
  expect((await action(director.token,id,{action:'assign',assigneeId:lead.id})).status).toBe(400);
  expect((await action(director.token,id,{action:'assign',assigneeId:employee.id})).status).toBe(400);
  expect((await action(director.token,id,{action:'assign',assigneeId:manager.id})).status).toBe(200);
  expect((await detail(manager.token,id)).capabilities).toMatchObject({staff:true,assign:false,internal:true});
  expect((await reply(manager.token,id,'We are reviewing your request.')).status).toBe(201);
  expect((await action(director.token,id,{action:'assign',assigneeId:null})).status).toBe(200);
  expect((await request(manager.token,`/cases/${id}`)).status).toBe(404);
});
test('internal notes, audit details and files remain hidden from the requester, including an HR requester',async()=>{
  const requester=await account('requester','hr_director'),owner=await account('owner','super_admin');const id=await create(requester.token,{confidential:true});
  expect((await detail(requester.token,id)).capabilities).toMatchObject({staff:false,assign:false,internal:false});
  expect((await reply(requester.token,id,'Self internal note',true)).status).toBe(403);
  const state=await detail(owner.token,id);
  const note=await request(owner.token,`/cases/${id}/messages`,multipart({version:String(state.case.version),body:'Restricted HR deliberation',internal:'true'}));expect(note.status).toBe(201);
  const internal=await detail(owner.token,id),file=internal.messages.find((m:any)=>m.internal).attachments[0];
  expect(JSON.stringify(await detail(requester.token,id))).not.toMatch(/Restricted HR deliberation|evidence.pdf|Internal note added|objectKey/);
  expect((await request(requester.token,`/attachments/${file.id}/download`)).status).toBe(404);expect(context.signed).toHaveLength(0);
  expect((await request(owner.token,`/attachments/${file.id}/download`)).status).toBe(302);expect(context.signed).toHaveLength(1);
});
test('public attachments inherit case access and are not exposed as raw storage keys',async()=>{
  const employee=await account('employee'),stranger=await account('stranger');
  const opened=await request(employee.token,'/cases',multipart({title:'Document support',category:'documents',body:'Please review the attached document.'}));expect(opened.status).toBe(201);
  const row=await detail(employee.token,opened.body.id),file=row.messages[0].attachments[0];expect(file.filename).toBe('evidence.pdf');expect(file).not.toHaveProperty('objectKey');
  expect((await request(stranger.token,`/attachments/${file.id}/download`)).status).toBe(404);
  const download=await request(employee.token,`/attachments/${file.id}/download`);expect(download.status).toBe(302);expect(download.location).toBe('https://private-storage.example.test/download');
  expect(context.uploads).toHaveLength(1);expect(context.deleted).toHaveLength(0);
});
test('restricting an existing case immediately removes general HR and attachment access',async()=>{
  const employee=await account('employee'),hr=await account('hr','hr');
  const opened=await request(employee.token,'/cases',multipart({title:'Private document',category:'documents',body:'Please review this request.'}));const id=opened.body.id;
  const before=await detail(hr.token,id),file=before.messages[0].attachments[0];
  expect((await action(employee.token,id,{action:'restrict'})).status).toBe(200);
  expect((await request(hr.token,`/cases/${id}`)).status).toBe(404);
  expect((await request(hr.token,`/attachments/${file.id}/download`)).status).toBe(404);
  expect((await request(hr.token,'/cases?view=queue')).body.total).toBe(0);
  expect((await request(employee.token,`/cases/${id}/actions`,{action:'restrict',version:2,confidential:false})).status).toBe(400);
});
test('case transitions preserve resolution reasons and support requester close and reopen',async()=>{
  const employee=await account('employee'),hr=await account('hr','hr');const id=await create(employee.token);
  expect((await action(employee.token,id,{action:'status',status:'resolved',reason:'Resolve myself'})).status).toBe(409);
  expect((await action(hr.token,id,{action:'status',status:'waiting_employee',reason:'Please provide the affected dates.'})).status).toBe(200);
  expect((await reply(hr.token,id,'Private work note',true)).status).toBe(201);
  expect((await detail(hr.token,id)).case.status).toBe('waiting_employee');
  expect((await reply(employee.token,id,'The affected dates are in September.')).status).toBe(201);expect((await detail(hr.token,id)).case.status).toBe('open');
  expect((await action(hr.token,id,{action:'status',status:'resolved',reason:'The employee record has been corrected.'})).status).toBe(200);
  expect((await reply(employee.token,id,'Another reply')).status).toBe(409);
  expect((await action(employee.token,id,{action:'status',status:'closed',reason:'Confirmed, thank you.'})).status).toBe(200);
  expect((await action(employee.token,id,{action:'status',status:'open',reason:'The correction needs another review.'})).status).toBe(200);
  const result=await detail(employee.token,id);expect(result.events.some((e:any)=>e.details.includes('The employee record has been corrected.'))).toBe(true);expect(result.messages).toHaveLength(2);
});
test('stale and simultaneous changes return a conflict without losing messages',async()=>{
  const employee=await account('employee'),hr=await account('hr','hr');const id=await create(employee.token);
  const results=await Promise.all([request(hr.token,`/cases/${id}/messages`,{version:1,body:'First HR answer'}),request(hr.token,`/cases/${id}/messages`,{version:1,body:'Second HR answer'})]);
  expect(results.map(r=>r.status).sort()).toEqual([201,409]);
  expect((await detail(hr.token,id)).messages).toHaveLength(2);
  expect((await request(hr.token,`/cases/${id}/actions`,{version:1,action:'status',status:'resolved',reason:'Stale resolution'})).status).toBe(409);
});
test('storage outages do not create partial requests; text-only requests remain available',async()=>{
  const employee=await account('employee');context.available=false;
  expect((await request(employee.token,'/config')).body.attachmentsAvailable).toBe(false);
  const failed=await request(employee.token,'/cases',multipart({title:'Storage unavailable',category:'documents',body:'A request with an unavailable file.'}));expect(failed.status).toBe(503);
  expect((await context.db.select().from(helpdeskCases))).toHaveLength(0);expect((await context.db.select().from(helpdeskMessages))).toHaveLength(0);
  await create(employee.token);expect((await context.db.select().from(helpdeskCases))).toHaveLength(1);
});
test('file validation rejects unsupported data and oversized uploads before storage',async()=>{
  const employee=await account('employee');const data={title:'Invalid attachment',category:'documents',body:'Please review this attachment.'};
  expect((await request(employee.token,'/cases',multipart(data,'<script>alert(1)</script>','fake.pdf'))).status).toBe(400);
  expect((await request(employee.token,'/cases',multipart(data,'%PDF-'+ 'x'.repeat(10*1024*1024)))).status).toBe(413);
  expect(context.uploads).toHaveLength(0);
});
test('database failure rolls back the case and cleans up the uploaded object',async()=>{
  const employee=await account('employee');
  await pg.exec("CREATE OR REPLACE FUNCTION fail_attachment_test_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic attachment insert failure'; END $$; CREATE TRIGGER fail_attachment_test BEFORE INSERT ON helpdesk_attachments FOR EACH ROW EXECUTE FUNCTION fail_attachment_test_fn();");
  expect((await request(employee.token,'/cases',multipart({title:'Rollback request',category:'documents',body:'This is an isolated rollback test.'}))).status).toBe(500);
  expect(context.uploads).toHaveLength(1);expect(context.deleted).toEqual(context.uploads);
  expect((await context.db.select().from(helpdeskCases))).toHaveLength(0);expect((await context.db.select().from(helpdeskAttachments))).toHaveLength(0);
});
test('deactivation and role changes remove assigned responder access',async()=>{
  const employee=await account('employee'),director=await account('director','hr_director'),manager=await account('manager','hr_manager');const id=await create(employee.token,{confidential:true});
  await action(director.token,id,{action:'assign',assigneeId:manager.id});
  await context.db.update(users).set({role:'employee'}).where(eq(users.id,manager.id));expect((await request(manager.token,`/cases/${id}`)).status).toBe(404);
  await context.db.update(users).set({isActive:false}).where(eq(users.id,manager.id));expect((await request(manager.token,`/cases/${id}`)).status).toBe(401);
});
