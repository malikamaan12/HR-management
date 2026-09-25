import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,afterAll,afterEach,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import bcrypt from 'bcryptjs';
import express from 'express';
import {users} from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db},pool:{}}));
import {totp,base32} from '../server/services/mfa';
import {authService} from '../server/services/auth';
import router from '../server/routes/mfa';
import {authenticate} from '../server/middleware/auth';
let pg:PGlite,server:any,url:string;
beforeAll(async()=>{
 process.env.JWT_SECRET='mfa-test-access-at-least-32-characters';process.env.JWT_REFRESH_SECRET='mfa-test-refresh-at-least-32-characters';process.env.MFA_ENCRYPTION_KEY='12'.repeat(32);
 pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);
 const app=express();app.use(express.json());app.use('/api/auth/mfa',router);app.get('/api/private',authenticate,(_req,res)=>res.json({ok:true}));server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port;
});
afterEach(()=>{vi.useRealTimers();delete process.env.MFA_ENFORCE_PRIVILEGED;});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();delete process.env.MFA_ENCRYPTION_KEY;});
async function call(token:string,path:string,body?:unknown){const r=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
function decode(value:string){let acc=0,bits=0;const bytes=[];for(const c of value){acc=(acc<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255);}}return Buffer.from(bytes);}
test.each([[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])('RFC 6238 SHA1 vector at %s',(seconds,code)=>{expect(totp(Buffer.from('12345678901234567890'),Math.floor(Number(seconds)/30),8)).toBe(code);});
test('base32 matches the RFC alphabet encoding',()=>{expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');});
test('enrollment failures persist and lock further guesses across requests',async()=>{
 const password='SetupThrottle2026!';await ctx.db.insert(users).values({username:'mfa-throttle',email:'throttle@example.test',password:await bcrypt.hash(password,4),firstName:'Throttle',lastName:'Synthetic',role:'super_admin',isActive:true,approvalStatus:'approved'});
 const session=await authService.login('mfa-throttle',password),setup=await call(session.accessToken,'/api/auth/mfa/start',{password});
 const current=Math.floor(Date.now()/30000),valid=[current-1,current,current+1].map(step=>totp(decode(setup.body.secret),step));let invalid='000000';while(valid.includes(invalid))invalid=String(Number(invalid)+1).padStart(6,'0');
 for(let i=0;i<5;i++)expect((await call(session.accessToken,'/api/auth/mfa/confirm',{code:invalid})).status).toBe(400);
 const state=(await pg.query("SELECT failed_attempts,locked_until,enabled FROM account_mfa JOIN users ON users.id=account_mfa.user_id WHERE username='mfa-throttle'")).rows[0] as any;
 expect(state.failed_attempts).toBe(5);expect(state.locked_until).not.toBeNull();expect(state.enabled).toBe(false);
 expect((await call(session.accessToken,'/api/auth/mfa/confirm',{code:valid[1]})).status).toBe(400);expect((await call(session.accessToken,'/api/auth/mfa/start',{password})).status).toBe(429);
});
test('enforcement allows only enrollment; MFA rejects missing/reused codes and consumes recovery once',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-25T09:00:00Z'));process.env.MFA_ENFORCE_PRIVILEGED='true';
 const password='MfaScenario2026!';await ctx.db.insert(users).values({username:'mfa-admin',email:'mfa@example.test',password:await bcrypt.hash(password,4),firstName:'MFA',lastName:'Synthetic',role:'super_admin',isActive:true,approvalStatus:'approved'});
 const session=await authService.login('mfa-admin',password);expect(session.user.mfaRequired).toBe(true);expect((await call(session.accessToken,'/api/private')).status).toBe(403);
 expect((await call(session.accessToken,'/api/auth/mfa/start',{password:'incorrect'})).status).toBe(401);
 const setup=await call(session.accessToken,'/api/auth/mfa/start',{password});expect(setup.status).toBe(200);
 const code=totp(decode(setup.body.secret),Math.floor(Date.now()/30000));const confirmation=await call(session.accessToken,'/api/auth/mfa/confirm',{code});expect(confirmation.status).toBe(200);expect(confirmation.body.recoveryCodes).toHaveLength(10);
 await expect(authService.authenticateToken(session.accessToken)).rejects.toThrow();
 await expect(authService.login('mfa-admin',password)).rejects.toThrow();await expect(authService.login('mfa-admin',password,undefined,undefined,code)).rejects.toThrow();
 vi.setSystemTime(new Date('2026-09-25T09:00:30Z'));const next=totp(decode(setup.body.secret),Math.floor(Date.now()/30000));const signed=await authService.login('mfa-admin',password,undefined,undefined,next);expect(signed.user.mfaRequired).toBe(false);expect((await call(signed.accessToken,'/api/private')).status).toBe(200);
 const refreshed=await authService.refreshToken(signed.refreshToken);expect((await call(refreshed.accessToken,'/api/private')).status).toBe(200);
 const recovery=confirmation.body.recoveryCodes[0];await expect(authService.login('mfa-admin',password,undefined,undefined,recovery)).resolves.toBeDefined();await expect(authService.login('mfa-admin',password,undefined,undefined,recovery)).rejects.toThrow();
 const raw=(await pg.query("SELECT account_mfa.* FROM account_mfa JOIN users ON users.id=account_mfa.user_id WHERE username='mfa-admin'")).rows[0];expect(JSON.stringify(raw)).not.toContain(setup.body.secret);expect(JSON.stringify(raw)).not.toContain(recovery);
 expect((await call(refreshed.accessToken,'/api/auth/mfa/start',{password})).status).toBe(401);
 const replacement=await call(refreshed.accessToken,'/api/auth/mfa/start',{password,secondFactor:confirmation.body.recoveryCodes[1]});expect(replacement.status).toBe(200);
 expect((await call(refreshed.accessToken,'/api/private')).status).toBe(200);
 const replaced=await call(refreshed.accessToken,'/api/auth/mfa/confirm',{code:totp(decode(replacement.body.secret),Math.floor(Date.now()/30000))});expect(replaced.status).toBe(200);
 await expect(authService.authenticateToken(refreshed.accessToken)).rejects.toThrow();await expect(authService.login('mfa-admin',password,undefined,undefined,confirmation.body.recoveryCodes[2])).rejects.toThrow();
});
