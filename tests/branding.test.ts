import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {beforeAll,beforeEach,afterAll,expect,test,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import bcrypt from 'bcryptjs';
import express from 'express';
import {users,appSettings,activityLogs} from '../shared/schema';
import {defaultBranding,maxBrandingBytes} from '../shared/branding';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import {authService} from '../server/services/auth';
import router from '../server/routes/branding';
import {brandingHtml,emptyBranding,getBranding,validateBrandingPng} from '../server/services/branding';
let pg:PGlite,server:ReturnType<ReturnType<typeof express>['listen']>,origin:string,admin:string,staff:string;
const password='SyntheticBranding7!';
function crc(bytes:Buffer){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const length=Buffer.alloc(4),check=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),data]);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([length,body,check]);}
function png(width=32,height=32){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('private metadata')),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);}
beforeAll(async()=>{
 process.env.JWT_SECRET='test-access-secret-at-least-32-characters';process.env.JWT_REFRESH_SECRET='test-refresh-secret-at-least-32-characters';
 pg=new PGlite();for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+file,'utf8'));ctx.db=drizzle(pg);
 const app=express();app.use('/api/branding',router);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 for(const role of ['super_admin','employee']){await ctx.db.insert(users).values({username:role,email:role+'@example.test',password:await bcrypt.hash(password,4),firstName:'QA',lastName:role,role,isActive:true,approvalStatus:'approved'});const token=(await authService.login(role,password)).accessToken;if(role==='super_admin')admin=token;else staff=token;}
});
beforeEach(async()=>{await pg.exec('TRUNCATE app_settings,activity_logs RESTART IDENTITY');});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();});
async function save({token=admin,version=0,settings=defaultBranding,files={},remove=[],requestOrigin}:{token?:string;version?:number;settings?:typeof defaultBranding;files?:Record<string,Buffer>;remove?:string[];requestOrigin?:string}={}){
 const body=new FormData();body.append('settings',JSON.stringify({settings,version,remove}));for(const [key,value]of Object.entries(files))body.append(key,new Blob([new Uint8Array(value)],{type:'image/png'}),'image.png');
 return fetch(origin+'/api/branding',{method:'PUT',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(requestOrigin?{Origin:requestOrigin}:{})},body});
}
test('public defaults do not expose private company settings',async()=>{
 await ctx.db.insert(appSettings).values({key:'company',value:{companyEmail:'private@example.test'}});
 const response=await fetch(origin+'/api/branding'),value=await response.json();expect(response.status).toBe(200);expect(value.applicationName).toBe(defaultBranding.applicationName);expect(value.assets).toEqual({});expect(JSON.stringify(value)).not.toContain('private@');expect(response.headers.get('cache-control')).toBe('no-store');
});
test('anonymous, staff and cross-origin writes are denied before parsing uploads',async()=>{
 expect((await save({token:''})).status).toBe(401);expect((await save({token:staff})).status).toBe(403);expect((await save({requestOrigin:'https://elsewhere.invalid'})).status).toBe(403);expect((await getBranding()).version).toBe(0);
});
test('admin saves all assets atomically; public URLs return PNG and no embedded metadata',async()=>{
 const response=await save({settings:{...defaultBranding,applicationName:'QA Workspace'},files:{lightLogo:png(),darkLogo:png(48,48),favicon:png()}});expect(response.status).toBe(200);const value=await response.json();expect(value.version).toBe(1);expect(value.applicationName).toBe('QA Workspace');expect(JSON.stringify(value)).not.toContain('base64');
 for(const key of ['lightLogo','darkLogo','favicon']){const image=await fetch(origin+value.assets[key]);expect(image.status).toBe(200);expect(image.headers.get('content-type')).toContain('image/png');expect(image.headers.get('x-content-type-options')).toBe('nosniff');expect(Buffer.from(await image.arrayBuffer()).includes(Buffer.from('private metadata'))).toBe(false);}
 expect(await ctx.db.select().from(activityLogs)).toHaveLength(1);
});
test('replacement changes asset URL; removing one asset preserves the other',async()=>{
 const first=await (await save({files:{lightLogo:png(),darkLogo:png()}})).json();
 const second=await (await save({version:1,files:{lightLogo:png(64,64)}})).json();expect(second.assets.lightLogo).not.toBe(first.assets.lightLogo);expect(second.assets.darkLogo).toBe(first.assets.darkLogo);
 const third=await (await save({version:2,remove:['lightLogo']})).json();expect(third.assets.lightLogo).toBeUndefined();expect(third.assets.darkLogo).toBe(first.assets.darkLogo);expect((await fetch(origin+'/api/branding/assets/lightLogo')).status).toBe(404);
});
test('stale edits cannot replace another administrator’s changes',async()=>{
 expect((await save({settings:{...defaultBranding,applicationName:'Saved'}})).status).toBe(200);expect((await save({settings:{...defaultBranding,applicationName:'Stale'}})).status).toBe(409);expect((await getBranding()).settings.applicationName).toBe('Saved');expect(await ctx.db.select().from(activityLogs)).toHaveLength(1);
});
test.each([Buffer.from('<svg onload="alert(1)"></svg>'),png().subarray(0,45),png(32,16),Buffer.alloc(maxBrandingBytes+1)])('rejects unsafe, truncated, non-square or oversized favicon without changing metadata',async image=>{
 expect((await save({settings:{...defaultBranding,applicationName:'Must not save'},files:{favicon:image}})).status).toBe(400);expect((await getBranding()).version).toBe(0);expect(await ctx.db.select().from(activityLogs)).toHaveLength(0);
});
test('corrupt PNG checksums, excessive dimensions and unknown asset names are rejected',async()=>{
 const corrupt=png();corrupt[corrupt.length-1]^=1;expect(()=>validateBrandingPng(corrupt,'lightLogo')).toThrow();expect(()=>validateBrandingPng(png(2049,1),'lightLogo')).toThrow();expect((await save({files:{other:png()}})).status).toBe(400);expect((await fetch(origin+'/api/branding/assets/company')).status).toBe(404);
});
test('audit failure rolls back branding and image changes',async()=>{
 await pg.exec("CREATE FUNCTION reject_branding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_branding_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_branding_audit()");
 try{expect((await save({files:{lightLogo:png()}})).status).toBe(500);expect((await getBranding()).version).toBe(0);}finally{await pg.exec('DROP TRIGGER fail_branding_audit ON activity_logs; DROP FUNCTION reject_branding_audit()');}
});
test('server HTML includes configured metadata safely escaped and excludes indexing',()=>{
 const value=emptyBranding();value.settings.pageTitle='QA </title><script>alert(1)</script>';value.settings.description='" onload="unsafe';const html=brandingHtml('<html><head><title>Old</title></head></html>',value);
 expect(html).not.toContain('<script>');expect(html).toContain('&lt;/title&gt;');expect(html).toContain('&quot; onload=&quot;unsafe');expect(html).toContain('noindex, nofollow');expect(html).toContain('og:title');expect(html).not.toContain('<title>Old');expect(html).toContain('default-icon.svg');
});
