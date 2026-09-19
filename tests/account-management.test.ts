import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, expect, test, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import express from 'express';
import { users, employees, securityLogs } from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
vi.mock('../server/services/email',()=>({emailConfigured:()=>false,sendPasswordResetEmail:vi.fn()}));
import {authService} from '../server/services/auth';
import {updateAccount,provisionEmployees} from '../server/services/account-management';
import router from '../server/routes/users';
let pg:PGlite, server:ReturnType<ReturnType<typeof express>['listen']>, origin:string;
const password='CorrectHorse7!';
beforeAll(async()=>{
 process.env.JWT_SECRET='test-access-secret-at-least-32-characters';process.env.JWT_REFRESH_SECRET='test-refresh-secret-at-least-32-characters';
 pg=new PGlite();for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+file,'utf8'));
 ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use('/users',router);server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
beforeEach(async()=>{await pg.exec('TRUNCATE users,employees,auth_sessions,security_logs RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pg.close();});
async function account(name='admin',role:any='super_admin') {const [row]=await ctx.db.insert(users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return row;}
async function employee(n:number,type:any='permanent') {const [row]=await ctx.db.insert(employees).values({employeeId:String(n),firstName:'Employee',lastName:String(n),gender:'other',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'TEST'+n,primaryMobile:'00000000',residentialAddress:'Doha',emergencyContactName:'Test',emergencyContactNumber:'00000000',type,department:'Operations',position:'Host',location:'Doha',joiningDate:'2026-01-01',workEmail:`employee${n}@example.test`}).returning();return row;}
async function call(token:string,path:string,body?:unknown,method='POST'){const res=await fetch(origin+'/users'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),cache:res.headers.get('cache-control')};}
async function admin(){const actor=await account();const token=(await authService.login(actor.username,password)).accessToken;return {actor,token};}

test.each(['frozen','on_hold','revoked'] as const)('%s invalidates all tokens; restore never revives sessions',async state=>{
 const actor=await account(), target=await account('staff','employee'), login=await authService.login('staff',password);
 const changed=await updateAccount(actor.id,target.id,{accountState:state,accountVersion:1,reason:'Access review'});
 expect(changed.isActive).toBe(false);await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();await expect(authService.refreshToken(login.refreshToken)).rejects.toThrow();await expect(authService.login('staff',password)).rejects.toThrow();
 await updateAccount(actor.id,target.id,{accountState:'active',accountVersion:2,reason:'Review complete'});
 await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();expect((await authService.login('staff',password)).user.id).toBe(target.id);
 expect((await ctx.db.select().from(securityLogs).where(eq(securityLogs.resourceType,'account')))).toHaveLength(2);
});
test('protects self, super admins, deleted accounts and stale edits including legacy role path',async()=>{
 const actor=await account(), lower=await account('lower','admin'),staff=await account('staff','employee');
 await expect(updateAccount(actor.id,actor.id,{accountState:'deleted'})).rejects.toThrow(/own/);
 await expect(updateAccount(lower.id,actor.id,{role:'employee'})).rejects.toThrow(/Super/);
 await expect(authService.updateUserRole(actor.id,'employee',lower.id)).rejects.toThrow(/Super/);
 await expect(updateAccount(lower.id,staff.id,{role:'super_admin'})).rejects.toThrow(/Super/);
 await updateAccount(actor.id,staff.id,{email:'new@example.test',accountVersion:1});
 await expect(updateAccount(actor.id,staff.id,{username:'stale',accountVersion:1})).rejects.toThrow(/changed/);
 await updateAccount(actor.id,staff.id,{accountState:'deleted',accountVersion:2});
 await expect(updateAccount(actor.id,staff.id,{accountState:'active'})).rejects.toThrow(/Deleted/);
 await expect(authService.approveUserAccount(staff.id,actor.id)).rejects.toThrow();
});
test('identity edits reject case-insensitive collisions and invalidate old sessions',async()=>{
 const actor=await account(),target=await account('staff','employee'),login=await authService.login('staff',password);
 await expect(updateAccount(actor.id,target.id,{email:'ADMIN@example.test'})).rejects.toThrow(/already/);
 const saved=await updateAccount(actor.id,target.id,{username:'newstaff',email:'newstaff@example.test'});expect(saved).not.toHaveProperty('password');
 await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();expect((await authService.login('newstaff',password)).user.email).toBe('newstaff@example.test');
});
test('bulk preview creates nothing; provisions 21 employees once with correct roles and hashed one-use setup tokens',async()=>{
 const actor=await account();const people=[];for(let n=1;n<=21;n++)people.push(await employee(n,n<=9?'permanent':'contract'));
 const preview=await provisionEmployees(actor.id,people.map(p=>p.id),true);expect(preview.every(row=>row.status==='ready')).toBe(true);expect(await ctx.db.select().from(users)).toHaveLength(1);
 const versions=Object.fromEntries(people.map(p=>[p.id,p.recordVersion]));
 const created=await provisionEmployees(actor.id,people.map(p=>p.id),false,versions);expect(created.filter(row=>row.status==='created')).toHaveLength(21);
 const all=await ctx.db.select().from(users);expect(all.filter((row:any)=>row.role==='permanent_employee')).toHaveLength(9);expect(all.filter((row:any)=>row.role==='employee')).toHaveLength(12);
 expect((await ctx.db.select().from(employees)).every((row:any)=>row.userId&&row.recordVersion===2)).toBe(true);
 const first=created[0] as any;const stored=all.find((row:any)=>row.id===first.accountId);expect(stored.passwordResetToken).not.toBe(first.setupToken);expect(stored.passwordSetupRequired).toBe(true);
 await expect(authService.login(first.username,password)).rejects.toThrow(/setup/);
 await authService.resetPassword(first.setupToken,password);expect((await authService.login(first.username,password)).user.passwordSetupRequired).toBe(false);
 await expect(authService.resetPassword(first.setupToken,'OtherPassword1!')).rejects.toThrow();
 expect((await provisionEmployees(actor.id,people.map(p=>p.id),false,versions)).every(row=>row.status==='already_linked')).toBe(true);expect(await ctx.db.select().from(users)).toHaveLength(22);
 expect(JSON.stringify(await ctx.db.select().from(securityLogs))).not.toContain(first.setupToken);
});
test('provision fails atomically on conflicts or changed employee data',async()=>{
 const actor=await account(),a=await employee(1),b=await employee(2);
 await expect(provisionEmployees(actor.id,[a.id],false,{})).rejects.toThrow(/review/i);
 await ctx.db.update(employees).set({workEmail:a.workEmail}).where(eq(employees.id,b.id));
 await expect(provisionEmployees(actor.id,[a.id,b.id],false,{[a.id]:1,[b.id]:1})).rejects.toThrow();expect(await ctx.db.select().from(users)).toHaveLength(1);
 expect((await ctx.db.select().from(employees)).every((row:any)=>!row.userId)).toBe(true);
});
test('password setup revokes sessions; freeze cancels setup and legacy approval cannot bypass it',async()=>{
 const {actor,token}=await admin(), target=await account('staff','employee'), login=await authService.login('staff',password);
 const setup=await call(token,`/${target.id}/password-setup`,{accountVersion:1,reason:'Reset requested'});expect(setup.status).toBe(200);expect(setup.cache).toBe('no-store');expect(setup.data.setupToken).toBeTruthy();
 await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();
 await updateAccount(actor.id,target.id,{accountState:'frozen',accountVersion:2});
 await expect(authService.resetPassword(setup.data.setupToken,password)).rejects.toThrow();await expect(authService.approveUserAccount(target.id,actor.id)).rejects.toThrow();
 expect((await call(token,`/${target.id}/password-setup`,{accountVersion:3,reason:'Try reset'})).status).toBe(400);
 const history=await call(token,`/${target.id}/history`,undefined,'GET');expect(history.status).toBe(200);expect(JSON.stringify(history.data)).not.toContain(setup.data.setupToken);
});
test('HTTP controls require administrator access, validate payloads and revoke sessions independently',async()=>{
 const {token}=await admin(),target=await account('staff','employee'),login=await authService.login('staff',password);
 expect((await call(login.accessToken,'',undefined,'GET')).status).toBe(403);
 expect((await call(token,`/${target.id}/revoke-sessions`,{reason:'Missing version'})).status).toBe(400);
 expect((await call(token,`/${target.id}`,{password:'CannotPatchPassword'},'PATCH')).status).toBe(400);
 expect((await call(token,`/${target.id}/revoke-sessions`,{accountVersion:1,reason:'Lost device'})).status).toBe(200);
 await expect(authService.authenticateToken(login.accessToken)).rejects.toThrow();expect((await authService.login('staff',password)).user.id).toBe(target.id);
});
test('permanent account deletion preserves the linked HR record',async()=>{
 const actor=await account(), person=await employee(1);const [created]=await provisionEmployees(actor.id,[person.id],false,{[person.id]:1});
 await updateAccount(actor.id,(created as any).accountId,{accountState:'deleted'});
 expect((await ctx.db.select().from(employees))[0].userId).toBe((created as any).accountId);
 await expect(authService.resetPassword((created as any).setupToken,password)).rejects.toThrow();
});

test('audit failure rolls back identity, access and session changes',async()=>{
 const actor=await account(),target=await account('staff','employee'),login=await authService.login('staff',password);
 await pg.exec("CREATE FUNCTION fail_account_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type = 'account' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_account_audit BEFORE INSERT ON security_logs FOR EACH ROW EXECUTE FUNCTION fail_account_audit();");
 try {
  await expect(updateAccount(actor.id,target.id,{accountState:'frozen',email:'changed@example.test'})).rejects.toThrow();
  expect((await authService.authenticateToken(login.accessToken)).userId).toBe(target.id);
  const [saved]=await ctx.db.select().from(users).where(eq(users.id,target.id));expect(saved.email).toBe(target.email);expect(saved.accountVersion).toBe(1);
 } finally {await pg.exec('DROP TRIGGER fail_account_audit ON security_logs; DROP FUNCTION fail_account_audit();');}
});
test('concurrent administrator deactivations cannot remove every administrator',async()=>{
 const a=await account(),b=await account('other');
 const outcomes=await Promise.allSettled([updateAccount(a.id,b.id,{accountState:'frozen'}),updateAccount(b.id,a.id,{accountState:'frozen'})]);
 expect(outcomes.filter(row=>row.status==='fulfilled')).toHaveLength(1);
 expect((await ctx.db.select().from(users)).filter((row:any)=>row.isActive)).toHaveLength(1);
});
