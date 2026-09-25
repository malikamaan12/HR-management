import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {beforeAll,afterAll,expect,test,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import bcrypt from 'bcryptjs';
import express from 'express';
import {users} from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import {authService} from '../server/services/auth';
import router from '../server/routes/account-avatar';
let pg:PGlite,server:ReturnType<ReturnType<typeof express>['listen']>,origin:string,a:string,b:string;
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const length=Buffer.alloc(4),check=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([length,body,check]);}
function png(width=32,height=32){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('private metadata')),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);}

beforeAll(async()=>{
 process.env.JWT_SECRET='test-access-secret-at-least-32-characters';process.env.JWT_REFRESH_SECRET='test-refresh-secret-at-least-32-characters';
 pg=new PGlite();for(const f of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+f,'utf8'));ctx.db=drizzle(pg);
 const app=express();app.use(express.json());app.use('/api/auth/avatar',router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 for(const name of ['avatar_a','avatar_b']){await ctx.db.insert(users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('AvatarTest7!',4),firstName:name,lastName:'Test',role:'employee',isActive:true,approvalStatus:'approved'});const token=(await authService.login(name,'AvatarTest7!')).accessToken;if(name==='avatar_a')a=token;else b=token;}
});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pg.close();});
const metadata=async(token:string)=>(await fetch(origin+'/api/auth/avatar',{headers:{Authorization:'Bearer '+token}})).json();
async function upload(token:string,version:string,bytes=png(),extra?:string){const body=new FormData();body.append('version',version);body.append('photo',new Blob([new Uint8Array(bytes)],{type:'image/png'}),'photo.png');if(extra)body.append('userId',extra);return fetch(origin+'/api/auth/avatar',{method:'PUT',headers:{Authorization:'Bearer '+token},body});}
test('personal photos work without employee records, reject foreign writes, strip metadata and never expose another user image',async()=>{
 expect((await fetch(origin+'/api/auth/avatar')).status).toBe(401);
 const initial=await metadata(a);expect(initial.url).toBeNull();
 expect((await upload(a,initial.version,Buffer.from('<svg/>'))).status).toBe(400);
 expect((await upload(a,initial.version,png(513,32))).status).toBe(400);
 expect((await upload(a,initial.version,png(),'2')).status).toBe(400);
 const response=await upload(a,initial.version);expect(response.status).toBe(200);const saved=await response.json();expect(saved.url).toContain('/api/auth/avatar/image?v=');
 const image=await fetch(origin+saved.url,{headers:{Authorization:'Bearer '+a}});expect(image.status).toBe(200);expect(image.headers.get('cache-control')).toContain('no-store');expect(Buffer.from(await image.arrayBuffer()).includes(Buffer.from('private metadata'))).toBe(false);
 expect((await fetch(origin+saved.url,{headers:{Authorization:'Bearer '+b}})).status).toBe(404);expect((await metadata(b)).url).toBeNull();
 expect((await authService.login('avatar_a','AvatarTest7!')).user.avatar).toBe(saved.url);
 expect((await upload(a,initial.version)).status).toBe(409);
 process.env.FILE_SCAN_REQUIRED='true';try{expect((await upload(a,saved.version)).status).toBe(503);}finally{delete process.env.FILE_SCAN_REQUIRED;}expect((await metadata(a)).version).toBe(saved.version);
 await pg.exec("CREATE FUNCTION reject_avatar_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER reject_avatar_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_avatar_audit()");
 const remove=()=>fetch(origin+'/api/auth/avatar',{method:'DELETE',headers:{Authorization:'Bearer '+a,'Content-Type':'application/json'},body:JSON.stringify({version:saved.version})});
 expect((await remove()).status).toBe(500);expect((await metadata(a)).version).toBe(saved.version);await pg.exec('DROP TRIGGER reject_avatar_audit ON activity_logs');
 expect((await remove()).status).toBe(200);expect((await metadata(a)).url).toBeNull();
});
