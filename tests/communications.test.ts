import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll,beforeEach,afterAll,test,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import express from 'express';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import { defaultCommunicationPolicy } from '../shared/communications';
const ctx=vi.hoisted(()=>({db:null as any,upload:vi.fn(),cleanup:vi.fn(),download:vi.fn()}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
vi.mock('../server/services/r2',()=>({
  uploadCommunicationFile:ctx.upload,deleteCommunicationFile:ctx.cleanup,communicationFileUrl:ctx.download,
  validateDocumentFile:(f:any)=>{if(f.buffer.subarray(0,5).toString()!=='%PDF-')throw Error('Invalid file');return 'pdf';},StorageUnavailableError:class extends Error{},
}));
import router from '../server/routes/communications';
import legacyNotifications from '../server/routes/notifications';
import legacyAnnouncements from '../server/routes/announcements';
import { authService } from '../server/services/auth';
import { createNotification } from '../server/services/notifications';
let pg:PGlite,server:Server,base:string,admin:any,outsider:any,worker:any,colleague:any,lead:any,dept:any,employee:any,otherEmployee:any;
const why='Synthetic communication workflow',password='InternalExample9!';
const instant=(hours:number)=>new Date(Date.now()+hours*3600000).toISOString();
async function account(name:string,role:s.UserRole,department='Operations'){
  const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Synthetic',role,department,isActive:true,approvalStatus:'approved'}).returning();
  return {...u,token:(await authService.login(name,password)).accessToken};
}
async function emp(user:any,type:'temporary'|'permanent'){
  return (await ctx.db.insert(s.employees).values({employeeId:'COMM-'+user.id,firstName:user.firstName,lastName:'Employee',userId:user.id,gender:'other',dateOfBirth:'1990-01-01',nationality:'Synthetic',qidNumber:'SECRET-'+user.id,primaryMobile:'SECRET',residentialAddress:'SECRET',emergencyContactName:'SECRET',emergencyContactNumber:'SECRET',department:user.department,position:'Host',location:'Test',type,joiningDate:'2020-01-01'}).returning())[0];
}
async function request(actor:any,path:string,body?:any,method=body===undefined?'GET':'POST'){
  const multipart=body instanceof FormData;
  const response=await fetch(base+path,{method,redirect:'manual',headers:{...(actor?{Authorization:'Bearer '+actor.token}:{}),...(!multipart?{'Content-Type':'application/json'}:{})},...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)})});
  return {status:response.status,cache:response.headers.get('cache-control'),location:response.headers.get('location'),body:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()};
}
async function group(actor=admin){const r=await request(actor,'/channels',{name:'Synthetic group',description:'Internal test',kind:'group',teamId:null,startsAt:instant(-1),endsAt:null,managersOnly:false,reason:why});expect(r.status,r.body.message).toBe(201);return r.body;}
async function add(c:any,user=worker,actor=admin,end:string|null=instant(5)){
  const r=await request(actor,`/channels/${c.id}/members`,{version:c.version,member:{userId:user.id,startsAt:instant(-1),endsAt:end,reason:why}});expect(r.status,r.body.message).toBe(200);return r.body;
}
async function send(c:any,actor=admin,body='Synthetic message',extras={}){return request(actor,`/channels/${c.id}/messages`,{body,requestKey:randomUUID(),...extras});}
async function draft(actor=admin,extra={}){
  const r=await request(actor,'/bulletins',{title:'Synthetic notice',body:'Please read this exact notice.',audience:'all',target:'',publishAt:instant(-1),expiresAt:instant(2),requiresAcknowledgement:true,pinned:false,reason:why,...extra});expect(r.status,r.body.message).toBe(201);return r.body;
}
async function publish(b:any,actor=admin){const r=await request(actor,`/bulletins/${b.id}/publish`,{version:b.version,reason:why});expect(r.status,r.body.message).toBe(200);return r.body;}
async function team(){
  const site=(await ctx.db.insert(s.workforceSites).values({name:'Synthetic mall',timezone:'Asia/Qatar'}).returning())[0];
  const t=(await ctx.db.insert(s.workforceTeams).values({name:'Activation team',kind:'mall_activation',siteId:site.id}).returning())[0];
  await ctx.db.insert(s.workforceMembers).values({teamId:t.id,employeeId:employee.id,startAt:new Date(instant(-2)),endAt:new Date(instant(4))});
  await ctx.db.insert(s.workforceGrants).values({teamId:t.id,userId:lead.id,permission:'schedule',startAt:new Date(instant(-2)),endAt:new Date(instant(4))});return t;
}
beforeAll(async()=>{
  process.env.JWT_SECRET='communications-access-secret-thirtytwo';process.env.JWT_REFRESH_SECRET='communications-refresh-secret-thirtytwo';
  pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
  ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/comm',router);app.use('/notifications',legacyNotifications);app.use('/announcements',legacyAnnouncements);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as any).port}/comm`;
});
beforeEach(async()=>{
  await pg.exec('TRUNCATE users,employees RESTART IDENTITY CASCADE');
  admin=await account('admin','super_admin');outsider=await account('outsider','super_admin');worker=await account('worker','temporary_staff');colleague=await account('colleague','permanent_employee','Finance');lead=await account('lead','event_manager');dept=await account('dept','hr_manager');
  employee=await emp(worker,'temporary');otherEmployee=await emp(colleague,'permanent');
  ctx.upload.mockReset().mockImplementation(async(id:number)=>`communications/${id}/${randomUUID()}.pdf`);ctx.cleanup.mockReset().mockResolvedValue(undefined);ctx.download.mockReset().mockResolvedValue('https://example.test/private-signed-file');
});
afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));if(pg)await pg.close();});

test('authentication, module restrictions and directory privacy apply before discovery',async()=>{
  expect((await request(null,'/context')).status).toBe(401);
  const audit=await account('audit','finance_audit');expect((await request(audit,'/context')).status).toBe(403);
  const d=await request(worker,'/directory');expect(d.status).toBe(200);expect(d.body.items.some((u:any)=>u.id===colleague.id)).toBe(false);expect(JSON.stringify(d.body)).not.toContain('SECRET');expect(JSON.stringify(d.body)).not.toContain('@example.test');expect(d.cache).toBe('no-store');
  expect((await request(worker,'/channels',{name:'Forged'})).status).toBe(400);
  expect((await request(audit,'/../announcements')).status).toBe(403);
  expect((await request(audit,'/../notifications')).status).toBe(403);
  expect((await request(admin,'/../notifications',{message:'Legacy broadcast'})).status).toBe(410);
});
test('private channels deny nonmember administrators, search, messages and read cursors',async()=>{
  const c=await add(await group());const m=(await send(c,admin,'Private text for assigned members')).body;
  expect((await request(outsider,'/channels')).body.items).toHaveLength(0);
  for(const suffix of ['', '/messages?q=Private','/members','/history'])expect((await request(outsider,`/channels/${c.id}${suffix}`)).status).toBe(404);
  expect((await request(outsider,`/channels/${c.id}/state`,{lastReadId:m.id})).status).toBe(404);
  expect((await request(worker,`/channels/${c.id}/messages`)).body.items[0].body).toBe('Private text for assigned members');
});
test('sends persist once under retries and reject changed replay, foreign replies and forged mentions',async()=>{
  const c=await add(await group()),key=randomUUID(),input={body:'Retry safe text',requestKey:key,mentions:[worker.id]};
  const first=await request(admin,`/channels/${c.id}/messages`,input),again=await request(admin,`/channels/${c.id}/messages`,input);expect(first.status,first.body.message).toBe(201);expect(again.body.id).toBe(first.body.id);
  expect((await request(admin,`/channels/${c.id}/messages`,{...input,body:'Changed'})).status).toBe(409);
  const other=await group(outsider),m=(await send(other,outsider)).body;
  expect((await send(c,admin,'Cross reply',{replyTo:m.id})).status).toBe(404);
  expect((await send(c,admin,'Forged mention',{mentions:[outsider.id]})).status).toBe(400);
  const state=(await request(worker,'/channels')).body.items[0];expect(state.unread).toBe(1);expect(state.mentions).toBe(1);
  expect((await request(worker,`/channels/${c.id}/state`,{lastReadId:m.id})).status).toBe(400);
  await request(worker,`/channels/${c.id}/state`,{lastReadId:first.body.id,muted:true});expect((await request(worker,'/channels')).body.items[0]).toMatchObject({unread:0,muted:true});
});
test('dated group membership ends access and removal preserves messages without leaking content',async()=>{
  let c=await group();expect((await request(admin,`/channels/${c.id}/members`,{version:c.version,member:{userId:worker.id,startsAt:instant(-1),endsAt:null,reason:why}})).status).toBe(400);
  c=await add(c);await send(c);expect((await request(worker,`/channels/${c.id}`)).status).toBe(200);
  await pg.query('UPDATE comm_members SET ends_at=now()-interval \'1 minute\' WHERE channel_id=$1 AND user_id=$2',[c.id,worker.id]);
  expect((await request(worker,`/channels/${c.id}/messages`)).status).toBe(404);
  c=await add(c);expect((await request(admin,`/channels/${c.id}/members/${worker.id}/remove`,{version:c.version,reason:why})).status).toBe(200);
  expect((await request(worker,'/channels')).body.items).toHaveLength(0);expect((await pg.query('SELECT count(*)::int n FROM comm_messages')).rows[0].n).toBe(1);
});
test('workforce channels follow membership and supervisor grants; outsiders cannot create against a team',async()=>{
  const t=await team(),input={name:'Event briefing room',description:'Test event',kind:'workforce',teamId:t.id,startsAt:instant(-1),endsAt:instant(3),managersOnly:true,reason:why};
  expect((await request(dept,'/channels',input)).status).toBe(404);
  const created=await request(lead,'/channels',input);expect(created.status,created.body.message).toBe(201);const c=created.body;
  expect((await request(worker,`/channels/${c.id}`)).body.can_post).toBe(false);expect((await send(c,worker)).status).toBe(403);expect((await send(c,lead)).status).toBe(201);
  expect((await request(colleague,`/channels/${c.id}`)).status).toBe(404);
  await pg.query('UPDATE workforce_members SET end_at=now()-interval \'1 minute\' WHERE team_id=$1',[t.id]);expect((await request(worker,`/channels/${c.id}`)).status).toBe(404);
  await pg.query('UPDATE workforce_grants SET revoked_at=now() WHERE team_id=$1',[t.id]);expect((await request(lead,`/channels/${c.id}`)).status).toBe(404);
});
test('accepted upcoming shifts grant access and cancellation removes it',async()=>{
  const t=await team();await pg.exec('DELETE FROM workforce_members');
  const shift=(await ctx.db.insert(s.workforceShifts).values({teamId:t.id,role:'Host',headcount:1,startAt:new Date(instant(2)),endAt:new Date(instant(5)),createdBy:admin.id}).returning())[0];
  const assignment=(await ctx.db.insert(s.workforceAssignments).values({shiftId:shift.id,employeeId:employee.id,createdBy:admin.id,status:'accepted'}).returning())[0];
  const c=(await request(admin,'/channels',{name:'Upcoming event',description:'Briefing',kind:'workforce',teamId:t.id,startsAt:instant(-1),endsAt:instant(8),managersOnly:false,reason:why})).body;
  expect((await request(worker,`/channels/${c.id}`)).status).toBe(200);
  await pg.query("UPDATE workforce_assignments SET status='cancelled' WHERE id=$1",[assignment.id]);expect((await request(worker,`/channels/${c.id}`)).status).toBe(404);
});
test('group managers cannot invite employees outside their assigned scope or overwrite stale settings',async()=>{
  const c=await group(dept);
  expect((await request(dept,`/channels/${c.id}/members`,{version:c.version,member:{userId:colleague.id,startsAt:instant(-1),endsAt:instant(2),reason:why}})).status).toBe(403);
  const changed=await request(dept,`/channels/${c.id}/settings`,{version:c.version,reason:why,managersOnly:true,archived:false});expect(changed.status).toBe(200);
  expect((await request(dept,`/channels/${c.id}/settings`,{version:c.version,reason:why,managersOnly:false,archived:false})).status).toBe(409);
});
test('direct conversations are unique, participant-only and respect the administrator switch',async()=>{
  const a=await request(worker,'/direct',{userId:admin.id}),b=await request(admin,'/direct',{userId:worker.id});expect(a.status,a.body.message).toBe(200);expect(b.body.id).toBe(a.body.id);
  expect((await request(outsider,`/channels/${a.body.id}/messages`)).status).toBe(404);
  expect((await request(worker,'/direct',{userId:colleague.id})).status).toBe(404);
  expect((await request(worker,'/policy',{version:0,definition:defaultCommunicationPolicy,reason:why},'PUT')).status).toBe(403);
  expect((await request(admin,'/policy',{version:0,definition:{...defaultCommunicationPolicy,directMessages:false},reason:why},'PUT')).status).toBe(200);
  expect((await send(a.body,worker)).status).toBe(403);expect((await request(worker,'/direct',{userId:admin.id})).status).toBe(409);
});
test('employment changes block hub access and expired shared assignments stop new direct messages',async()=>{
  await team();
  const direct=await request(worker,'/direct',{userId:lead.id});expect(direct.status).toBe(200);
  expect((await send(direct.body,worker)).status).toBe(201);
  await pg.exec("UPDATE workforce_members SET end_at=now()-interval '1 minute'");
  expect((await request(worker,`/channels/${direct.body.id}`)).body.can_post).toBe(false);
  expect((await send(direct.body,lead)).status).toBe(403);
  expect((await request(worker,`/channels/${direct.body.id}/messages`)).body.items).toHaveLength(1);
  await pg.query("UPDATE employees SET status='inactive' WHERE id=$1",[employee.id]);
  expect((await request(worker,'/context')).status).toBe(403);
  expect((await request(worker,'/bulletins')).status).toBe(403);
  expect((await request(worker,'/../announcements')).status).toBe(403);
  expect((await request(worker,'/../notifications')).status).toBe(403);
  await pg.query("UPDATE employees SET status='active',termination_date='2020-01-01' WHERE id=$1",[employee.id]);
  expect((await request(worker,'/inbox')).status).toBe(403);
});
test('attachments validate size, keep keys private, reject outsiders and disappear after withdrawal',async()=>{
  const c=await add(await group()),input={body:'Attachment example',requestKey:randomUUID()},form=()=>{const f=new FormData();f.append('message',JSON.stringify(input));f.append('file',new Blob(['%PDF-1.7 synthetic']), 'briefing.pdf');return f;};
  const sent=await request(admin,`/channels/${c.id}/messages`,form());expect(sent.status,sent.body.message).toBe(201);expect(sent.body).not.toHaveProperty('attachment_key');expect(sent.body).not.toHaveProperty('content_hash');
  await request(admin,`/channels/${c.id}/messages`,form());expect(ctx.upload).toHaveBeenCalledTimes(1);
  await expect(pg.query('UPDATE comm_messages SET body=$1 WHERE id=$2',['Tampered',sent.body.id])).rejects.toThrow(/immutable/);
  const bad=new FormData();bad.append('message',JSON.stringify({body:'Invalid file',requestKey:randomUUID()}));bad.append('file',new Blob(['not a PDF']),'pretend.pdf');
  expect((await request(admin,`/channels/${c.id}/messages`,bad)).status).toBe(400);
  await request(admin,'/policy',{version:0,definition:{...defaultCommunicationPolicy,attachmentMegabytes:1},reason:why},'PUT');
  const oversized=new FormData();oversized.append('message',JSON.stringify({body:'Large file',requestKey:randomUUID()}));oversized.append('file',new Blob(['%PDF-',new Uint8Array(1024*1024)]),'large.pdf');
  expect((await request(admin,`/channels/${c.id}/messages`,oversized)).status).toBe(400);expect(ctx.upload).toHaveBeenCalledTimes(1);
  expect((await request(outsider,`/channels/${c.id}/messages/${sent.body.id}/file`)).status).toBe(404);expect(ctx.download).not.toHaveBeenCalled();
  expect((await request(worker,`/channels/${c.id}/messages/${sent.body.id}/file`)).status).toBe(302);
  const files=(await request(worker,'/search?mode=files&q=briefing')).body.items;
  expect(files).toHaveLength(1);expect(files[0]).toMatchObject({id:sent.body.id,attachment_name:'briefing.pdf'});expect(files[0]).not.toHaveProperty('attachment_key');expect(files[0]).not.toHaveProperty('content_hash');expect(files[0]).not.toHaveProperty('request_key');
  expect((await request(outsider,'/search?mode=files&q=briefing')).body.items).toHaveLength(0);
  expect((await request(worker,`/channels/${c.id}/messages?view=files`)).body.items[0].id).toBe(sent.body.id);

  expect((await request(worker,`/channels/${c.id}/messages/${sent.body.id}/retract`,{reason:why})).status).toBe(404);
  expect((await request(admin,`/channels/${c.id}/messages/${sent.body.id}/retract`,{reason:why})).status).toBe(200);
  expect((await request(worker,`/channels/${c.id}/messages`)).body.items[0]).toMatchObject({body:'Message withdrawn',attachment_name:null});
  expect((await request(worker,'/search?mode=files&q=briefing')).body.items).toHaveLength(0);
  expect((await request(worker,`/channels/${c.id}/messages?view=files`)).body.items).toHaveLength(0);
  expect((await request(worker,`/channels/${c.id}/messages/${sent.body.id}/file`)).status).toBe(404);
});
test('policy limits constrain message length and history; saves are versioned',async()=>{
  const c=await group();await send(c);
  const change={version:0,definition:{...defaultCommunicationPolicy,maxMessageLength:200,historyDays:30},reason:why};
  expect((await request(admin,'/policy',change,'PUT')).status).toBe(200);expect((await request(admin,'/policy',change,'PUT')).status).toBe(409);
  expect((await send(c,admin,'x'.repeat(201))).status).toBe(400);
  await pg.exec('ALTER TABLE comm_messages DISABLE TRIGGER comm_message_immutable');await pg.exec("UPDATE comm_messages SET created_at=now()-interval '31 days'");await pg.exec('ALTER TABLE comm_messages ENABLE TRIGGER comm_message_immutable');
  expect((await request(admin,`/channels/${c.id}/messages`)).body.items).toHaveLength(0);expect((await request(admin,'/policy/history')).body.items).toHaveLength(1);
});
test('draft and scheduled announcements stay private; published text cannot be silently changed',async()=>{
  let b=await draft(admin,{publishAt:instant(1),expiresAt:instant(3)});
  expect((await request(worker,'/bulletins')).body.items).toHaveLength(0);expect((await request(worker,`/bulletins/${b.id}`)).status).toBe(404);
  b=await publish(b);expect((await request(worker,'/bulletins')).body.items).toHaveLength(0);
  expect((await request(admin,`/bulletins/${b.id}/read`,{})).status).toBe(409);
  await expect(pg.query('UPDATE comm_bulletins SET body=$1 WHERE id=$2',['Tampered',b.id])).rejects.toThrow(/immutable/);
});
test('announcements target departments and require an explicit prior read before acknowledgement',async()=>{
  const b=await publish(await draft(dept,{audience:'department',target:'Operations'}),dept);
  expect((await request(colleague,'/bulletins')).body.items).toHaveLength(0);expect((await request(worker,'/bulletins')).body.items).toHaveLength(1);
  expect((await request(worker,`/bulletins/${b.id}/acknowledge`,{})).status).toBe(409);
  expect((await request(worker,`/bulletins/${b.id}/read`,{})).status).toBe(200);
  expect((await request(worker,`/bulletins/${b.id}/acknowledge`,{})).status).toBe(200);
  const first=(await request(worker,`/bulletins/${b.id}`)).body.acknowledged_at;await request(worker,`/bulletins/${b.id}/acknowledge`,{});expect((await request(worker,`/bulletins/${b.id}`)).body.acknowledged_at).toBe(first);
  expect((await request(colleague,`/bulletins/${b.id}/receipts`)).status).toBe(403);expect((await request(dept,`/bulletins/${b.id}/receipts`)).body.items[0].name).toContain('worker');
  expect((await request(dept,`/bulletins/${b.id}/archive`,{version:b.version,reason:why})).status).toBe(200);expect((await request(worker,`/bulletins/${b.id}`)).status).toBe(404);
  expect((await pg.query('SELECT count(*)::int n FROM comm_bulletin_receipts')).rows[0].n).toBe(1);
});
test('channel briefing access and management end when assignments or grants are removed',async()=>{
  const t=await team(),c=(await request(lead,'/channels',{name:'Private event briefing',description:'Test',kind:'workforce',teamId:t.id,startsAt:instant(-1),endsAt:instant(3),managersOnly:true,reason:why})).body;
  const b=await publish(await draft(lead,{audience:'channel',target:String(c.id)}),lead);
  expect((await request(worker,`/bulletins/${b.id}`)).status).toBe(200);expect((await request(outsider,`/bulletins/${b.id}`)).status).toBe(404);
  await pg.exec('DELETE FROM workforce_members');expect((await request(worker,`/bulletins/${b.id}`)).status).toBe(404);
  await pg.exec('UPDATE workforce_grants SET revoked_at=now()');expect((await request(lead,'/bulletins?managed=true')).body.items).toHaveLength(0);
});
test('inbox read state is private, preserves delivery status and rejects external links',async()=>{
  const n=(await ctx.db.insert(s.notifications).values({userId:worker.id,message:'Action reminder',channel:'push',status:'pending',data:{url:'/team-overview'}}).returning())[0];
  await ctx.db.insert(s.notifications).values({userId:worker.id,message:'Unsafe link',channel:'push',status:'pending',data:{url:'https://example.test/steal'}});
  expect((await request(outsider,`/inbox/${n.id}/read`,{})).status).toBe(404);
  const list=(await request(worker,'/inbox')).body.items;expect(list[0].url).toBe(null);expect(list[1].url).toBe('/team-overview');
  await request(worker,`/inbox/${n.id}/read`,{});expect((await request(worker,'/inbox?unread=true')).body.items).toHaveLength(1);
  expect((await pg.query('SELECT status FROM notifications WHERE id=$1',[n.id])).rows[0].status).toBe('pending');
  await expect(createNotification({userId:worker.id,message:'External attempt',channel:'slack'})).rejects.toThrow(/in-app/);
});
test('message audit failure rolls back persistence and cleans an uploaded synthetic attachment',async()=>{
  const c=await group();await pg.exec("CREATE FUNCTION fail_comm_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='comm_message' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_comm_audit BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION fail_comm_audit();");
  try{const form=new FormData();form.append('message',JSON.stringify({body:'Rollback message',requestKey:randomUUID()}));form.append('file',new Blob(['%PDF-test']),'test.pdf');expect((await request(admin,`/channels/${c.id}/messages`,form)).status).toBe(500);expect(ctx.cleanup).toHaveBeenCalledTimes(1);expect((await pg.query('SELECT count(*)::int n FROM comm_messages')).rows[0].n).toBe(0);}finally{await pg.exec('DROP TRIGGER fail_comm_audit ON hr_workflow_history; DROP FUNCTION fail_comm_audit();');}
});
test('legacy announcement migration preserves content and safely retains unmapped custom audiences',async()=>{
  const legacy=new PGlite();try{
    for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')&&n<'0043').sort())await legacy.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
    await legacy.exec("INSERT INTO users(username,email,password,first_name,last_name,role) VALUES('legacy','legacy@example.test','synthetic','Legacy','User','admin'); INSERT INTO announcements(title,content,author_id,target_audience,expiry_date,created_at) VALUES('Existing expired','Keep exact text',1,'all','2020-01-01','2021-01-01'),('Custom audience','Private old content',1,'custom',NULL,'2021-01-01');");
    await legacy.exec(readFileSync(new URL('../migrations/0043_internal_communications.sql',import.meta.url),'utf8'));
    expect((await legacy.query('SELECT body,audience,status FROM comm_bulletins ORDER BY id')).rows).toEqual([{body:'Keep exact text',audience:'all',status:'published'},{body:'Private old content',audience:'legacy_custom',status:'archived'}]);expect((await legacy.query('SELECT count(*)::int n FROM announcements')).rows[0].n).toBe(2);
  }finally{await legacy.close();}
});

test('conversation previews, favorites and mentions are scoped and summary respects mute without hiding mentions',async()=>{
 const c=await add(await group()),m=(await send(c,admin,'Meet at the entrance',{mentions:[worker.id]})).body;
 expect((await request(worker,'/channels?filter=unread')).body.items[0]).toMatchObject({last_message:'Meet at the entrance',unread:1,mentions:1,favorite:false});
 expect((await request(outsider,'/summary')).body).toMatchObject({unreadConversations:0,mentions:0});
 expect((await request(worker,'/summary')).body).toMatchObject({unreadConversations:1,mentions:1});
 expect((await request(worker,`/channels/${c.id}/state`,{favorite:true,muted:true})).status).toBe(200);
 expect((await request(worker,'/channels?filter=favorites')).body.items).toHaveLength(1);expect((await request(admin,'/channels?filter=favorites')).body.items).toHaveLength(0);
 expect((await request(worker,'/channels?filter=unread')).body.items).toHaveLength(0);expect((await request(worker,'/channels?filter=mentions')).body.items).toHaveLength(1);
 expect((await request(worker,'/summary')).body).toMatchObject({unreadConversations:0,mentions:1});
 await request(worker,`/channels/${c.id}/state`,{lastReadId:m.id});expect((await request(worker,`/channels/${c.id}`)).body).toMatchObject({favorite:true,muted:true});expect((await request(worker,'/summary')).body.mentions).toBe(0);
});

test('message reactions are idempotent, belong to their actor, and cannot bypass read-only channels',async()=>{
 const c=await add(await group()),m=(await send(c)).body,path=`/channels/${c.id}/messages/${m.id}/reaction`;
 expect((await request(outsider,path,{active:true,emoji:'👍'})).status).toBe(404);
 expect((await request(worker,path,{active:true,emoji:'bad'})).status).toBe(400);
 for(let i=0;i<2;i++)expect((await request(worker,path,{active:true,emoji:'👍'})).status).toBe(200);
 await request(admin,path,{active:true,emoji:'👍'});
 expect((await request(worker,`/channels/${c.id}/messages`)).body.items[0].reactions).toEqual([{emoji:'👍',count:2,mine:true}]);
 await request(worker,path,{active:false,emoji:'👍'});expect((await request(worker,`/channels/${c.id}/messages`)).body.items[0].reactions).toEqual([{emoji:'👍',count:1,mine:false}]);
 await request(admin,`/channels/${c.id}/settings`,{version:c.version,managersOnly:true,archived:false,reason:why});expect((await request(worker,path,{active:true,emoji:'✅'})).status).toBe(403);
});

test('saved messages are personal, search is scoped, and expired membership removes all discovery surfaces',async()=>{
 let c=await add(await group());const m=(await send(c,admin,'Coordinate the entrance queue')).body;
 await request(worker,`/channels/${c.id}/messages/${m.id}/save`,{active:true});
 expect((await request(worker,'/search?mode=saved')).body.items[0].id).toBe(m.id);expect((await request(admin,'/search?mode=saved')).body.items).toHaveLength(0);
 expect((await request(worker,'/search?q=entrance')).body.items).toHaveLength(1);expect((await request(outsider,'/search?q=entrance')).body.items).toHaveLength(0);
 expect((await request(worker,'/search?q=%25')).status).toBe(400);expect((await request(worker,'/search?q=%25_')).body.items).toHaveLength(0);
 await request(admin,`/channels/${c.id}/members/${worker.id}/remove`,{version:c.version,reason:why});
 expect((await request(worker,'/search?mode=saved')).body.items).toHaveLength(0);expect((await request(worker,'/search?q=entrance')).body.items).toHaveLength(0);expect((await request(worker,`/channels/${c.id}/messages/${m.id}/replies`)).status).toBe(404);
 expect((await request(worker,'/summary')).body).toMatchObject({unreadConversations:0,mentions:0});
});

test('pins require current manager access; withdrawals hide text, pins, reactions and saved discovery',async()=>{
 const c=await add(await group()),m=(await send(c,admin,'Sensitive coordination instruction')).body,path=`/channels/${c.id}/messages/${m.id}`;
 expect((await request(worker,path+'/pin',{active:true})).status).toBe(403);expect((await request(admin,path+'/pin',{active:true})).status).toBe(200);
 expect((await request(worker,`/channels/${c.id}/messages?view=pinned`)).body.items[0].pinned).toBe(true);
 await request(worker,path+'/save',{active:true});await request(worker,path+'/reaction',{active:true,emoji:'👀'});
 await request(admin,path+'/retract',{reason:why});
 expect((await request(worker,`/channels/${c.id}/messages`)).body.items[0]).toMatchObject({body:'Message withdrawn',pinned:false,saved:false,reactions:[]});
 expect((await request(worker,'/search?mode=saved')).body.items).toHaveLength(0);expect((await request(worker,`/channels/${c.id}/messages?view=pinned`)).body.items).toHaveLength(0);expect((await request(worker,path+'/reaction',{active:true,emoji:'👍'})).status).toBe(404);
 expect((await request(worker,'/channels')).body.items[0].last_message).toBe(null);
});

test('reply context and paginated thread results never disclose foreign or withdrawn parent text',async()=>{
 const c=await add(await group()),m=(await send(c,admin,'Original instructions')).body,r=(await send(c,worker,'I can cover the desk',{replyTo:m.id})).body;
 const thread=await request(worker,`/channels/${c.id}/messages/${m.id}/replies`);expect(thread.body.root.id).toBe(m.id);expect(thread.body.items[0]).toMatchObject({id:r.id,reply_preview:{id:m.id,body:'Original instructions'}});
 const other=await group(outsider);expect((await request(admin,`/channels/${other.id}/messages/${m.id}/replies`)).status).toBe(404);expect((await request(worker,`/channels/${c.id}/messages/${m.id}/replies?offset=25`)).body.items).toHaveLength(0);
 await request(admin,`/channels/${c.id}/messages/${m.id}/retract`,{reason:why});const after=(await request(worker,`/channels/${c.id}/messages/${m.id}/replies`)).body;expect(after.root.body).toBe('Message withdrawn');expect(after.items[0].reply_preview.body).toBe('Message withdrawn');expect(JSON.stringify(after)).not.toContain('Original instructions');
});

test('history windows apply to pins, saved messages, reply previews and file search',async()=>{
 const c=await add(await group()),m=(await send(c)).body;
 await request(worker,`/channels/${c.id}/messages/${m.id}/save`,{active:true});await request(admin,`/channels/${c.id}/messages/${m.id}/pin`,{active:true});
 await pg.exec('ALTER TABLE comm_messages DISABLE TRIGGER comm_message_immutable');await pg.exec("UPDATE comm_messages SET created_at=now()-interval '400 days'");await pg.exec('ALTER TABLE comm_messages ENABLE TRIGGER comm_message_immutable');
 expect((await request(worker,'/search?mode=saved')).body.items).toHaveLength(0);expect((await request(worker,`/channels/${c.id}/messages?view=pinned`)).body.items).toHaveLength(0);expect((await request(worker,`/channels/${c.id}/messages/${m.id}/replies`)).status).toBe(404);expect((await request(admin,`/channels/${c.id}/messages/${m.id}/pin`,{active:false})).status).toBe(404);
});

test('summary includes only live required notices and the current user’s unread action reminders',async()=>{
 const b=await publish(await draft());await publish(await draft(admin,{publishAt:instant(1),expiresAt:instant(3)}));
 await ctx.db.insert(s.notifications).values({userId:worker.id,message:'Private reminder',channel:'push',status:'pending'});
 expect((await request(worker,'/summary')).body).toMatchObject({pendingAcknowledgements:1,unreadActions:1});expect((await request(outsider,'/summary')).body.unreadActions).toBe(0);
 await request(worker,`/bulletins/${b.id}/read`,{});await request(worker,`/bulletins/${b.id}/acknowledge`,{});expect((await request(worker,'/summary')).body.pendingAcknowledgements).toBe(0);
});

test('failed pin auditing rolls back the pin while unrelated administrators cannot access it',async()=>{
 const c=await group(),m=(await send(c)).body;
 await pg.exec("CREATE FUNCTION reject_pin_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_type='comm_message_pin' THEN RAISE EXCEPTION 'Synthetic pin audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_pin_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_pin_audit()");
 try{expect((await request(admin,`/channels/${c.id}/messages/${m.id}/pin`,{active:true})).status).toBe(500);expect((await request(admin,`/channels/${c.id}/messages?view=pinned`)).body.items).toHaveLength(0);}finally{await pg.exec('DROP TRIGGER reject_pin_audit ON activity_logs; DROP FUNCTION reject_pin_audit()');}
});


test('reply and discovery pagination show newest messages first without losing the older page',async()=>{
 const c=await add(await group()),parent=(await send(c)).body;
 const inserted=await pg.query(`INSERT INTO comm_messages(channel_id,author_id,body,reply_to,request_key,content_hash) SELECT $1,$2,'Shift note '||n,$3,gen_random_uuid(),'synthetic' FROM generate_series(1,27) n RETURNING id`,[c.id,admin.id,parent.id]);
 const ids=inserted.rows.map((r:any)=>r.id).reverse();
 const first=(await request(worker,`/channels/${c.id}/messages/${parent.id}/replies`)).body;
 const second=(await request(worker,`/channels/${c.id}/messages/${parent.id}/replies?offset=25`)).body;
 expect(first.hasMore).toBe(true);expect(second.hasMore).toBe(false);expect(first.root.reply_count).toBe(27);
 expect([...first.items,...second.items].map((m:any)=>m.id)).toEqual(ids);
 const results=(await request(worker,'/search?q=Shift%20note')).body;
 expect(results.hasMore).toBe(true);expect(results.items).toHaveLength(25);expect(results.items[0].id).toBe(ids[0]);
 expect((await request(worker,'/search?q=Shift%20note&offset=25')).body.items.map((m:any)=>m.id)).toEqual(ids.slice(25));
});
