import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import bcrypt from 'bcryptjs';
import express from 'express';
import {users,employees} from '../shared/schema';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db},pool:{}}));
import router from '../server/routes/privacy-requests';
import preferences from '../server/routes/preferences';
import {authService} from '../server/services/auth';
let pg:PGlite,server:any,url:string,personId:number,subject:string,outsider:string,preparer:string,reviewer:string,preparerId:number;
beforeAll(async()=>{
 process.env.JWT_SECRET='privacy-test-access-secret-at-least-32';process.env.JWT_REFRESH_SECRET='privacy-test-refresh-secret-at-least-32';
 pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);
 const password='SyntheticPrivacy2026!';const accounts=[];
 for(const [name,role] of [['subject','permanent_employee'],['outsider','permanent_employee'],['preparer','super_admin'],['reviewer','super_admin']] as const){const [u]=await ctx.db.insert(users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Synthetic',role,isActive:true,approvalStatus:'approved'}).returning();accounts.push({id:u.id,token:(await authService.login(name,password)).accessToken});}
 [subject,outsider,preparer,reviewer]=accounts.map(a=>a.token);preparerId=accounts[2].id;
 const [e]=await ctx.db.insert(employees).values({userId:accounts[0].id,employeeId:'PRIVACY-TEST',firstName:'Synthetic',lastName:'Subject',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'PRIVACY-TEST',primaryMobile:'00000000',residentialAddress:'Test',emergencyContactName:'Test',emergencyContactNumber:'00000000',department:'Operations',position:'Host',location:'Test',type:'permanent',joiningDate:'2020-01-01'}).returning();personId=e.id;
 const app=express();app.use(express.json());app.use('/api/privacy-requests',router);app.use('/api/preferences',preferences);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port+'/api/privacy-requests';
});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});
async function call(token:string,path='',body?:unknown){const r=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
test('language preferences are saved only for the authenticated user',async()=>{
 const endpoint=url.replace('/privacy-requests','/preferences');
 const headers={Authorization:'Bearer '+subject,'Content-Type':'application/json'};
 expect((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({language:'ar',userId:preparerId})})).status).toBe(400);
 expect((await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({language:'ar'})})).status).toBe(200);
 expect(await (await fetch(endpoint,{headers})).json()).toEqual({language:'ar'});
 expect(await (await fetch(endpoint,{headers:{Authorization:'Bearer '+outsider}})).json()).toEqual({language:'en'});
 expect((await fetch(endpoint)).status).toBe(401);
});
test('subject access is isolated; request retries preserve one record and reject altered replays',async()=>{
 const data={employeeId:personId,kind:'access',details:'Please provide my recorded personal information.',submissionKey:randomUUID()};const first=await call(subject,'',data);expect(first.status).toBe(201);expect((await call(subject,'',data)).body.id).toBe(first.body.id);expect((await call(subject,'',{...data,details:'This is different request content.'})).status).toBe(409);expect((await call(outsider)).body.items).toHaveLength(0);expect((await call(outsider,'', {...data,submissionKey:randomUUID()})).status).toBe(404);expect((await call(outsider,`/${first.body.id}/prepare`,{version:1,response:'Unauthorized access attempt blocked.'})).status).toBe(404);
 const prepared=await call(preparer,`/${first.body.id}/prepare`,{version:1,response:'Prepared synthetic response and verified subject identity.'});expect(prepared.status).toBe(200);expect((await call(preparer,`/${first.body.id}/fulfill`,{version:2,response:'Cannot approve my prepared response.'})).status).toBe(403);expect((await call(reviewer,`/${first.body.id}/fulfill`,{version:2,response:'Independent evidence checked; response delivered securely.'})).status).toBe(200);expect((await call(subject)).body.items[0].status).toBe('fulfilled');expect((await call(subject,`/${first.body.id}/withdraw`,{version:3,response:'Cannot withdraw a completed request.'})).status).toBe(409);
});
test('preservation holds block erasure closure, with stale writes and audits preserved',async()=>{
 const created=await call(subject,'',{employeeId:personId,kind:'erasure',details:'Please review erasure of my personal information.',submissionKey:randomUUID()});const requestId=created.body.id;
 await call(preparer,`/${requestId}/prepare`,{version:1,response:'Review retention obligations before responding.'});
 await pg.query('INSERT INTO hr_retention_holds(employee_id,reason,created_by) VALUES($1,$2,$3)',[personId,'Synthetic preservation hold',preparerId]);
 expect((await call(reviewer,`/${requestId}/fulfill`,{version:2,response:'Held data must not be marked erased.'})).status).toBe(409);
 expect((await call(reviewer,`/${requestId}/reject`,{version:1,response:'Reject stale request decision attempt.'})).status).toBe(409);
 expect((await call(reviewer,`/${requestId}/reject`,{version:2,response:'Preservation obligation prevents erasure; review on hold release.'})).status).toBe(200);
 const history=await pg.query('SELECT * FROM hr_workflow_history WHERE kind=$1 AND record_id=$2',['privacy_request',requestId]);expect(history.rows).toHaveLength(3);expect((await pg.query('SELECT id FROM employees WHERE id=$1',[personId])).rows).toHaveLength(1);
});
test('access exports require independent release, exclude third-party fields and keep reviewed snapshots stable',async()=>{
 const created=await call(subject,'',{employeeId:personId,kind:'access',details:'Please provide a copy of my core employee records.',submissionKey:randomUUID()});const requestId=created.body.id;
 expect((await call(subject,`/${requestId}/prepare-export`,{version:1,response:'Subject cannot prepare their own disclosure.'})).status).toBe(403);
 expect((await call(preparer,`/${requestId}/prepare-export`,{version:1,response:'Core records prepared; additional scope reviewed separately.'})).status).toBe(200);
 expect((await call(subject,`/${requestId}/export`)).status).toBe(403);
 expect((await call(outsider,`/${requestId}/export`)).status).toBe(404);
 const prepared=await call(reviewer,`/${requestId}/export`);expect(prepared.status).toBe(200);expect(prepared.body.profile.employee_id).toBe('PRIVACY-TEST');
 expect(prepared.body.profile).not.toHaveProperty('emergency_contact_name');expect(prepared.body.profile).not.toHaveProperty('user_id');expect(prepared.body.scope.requiresSeparateReview.length).toBeGreaterThan(0);
 expect(JSON.stringify((await call(subject)).body)).not.toContain('e3-personal-data-core-v1');
 expect((await call(preparer,`/${requestId}/fulfill`,{version:2,response:'Self-release must remain forbidden.'})).status).toBe(403);
 await pg.query("UPDATE employees SET position='Changed after preparation' WHERE id=$1",[personId]);
 expect((await call(reviewer,`/${requestId}/fulfill`,{version:2,response:'Reviewed saved disclosure, supplemental scope and recipient.'})).status).toBe(200);
 const delivered=await call(subject,`/${requestId}/export`);expect(delivered.body).toEqual(prepared.body);
 expect((await call(preparer,`/${requestId}/prepare-export`,{version:3,response:'A released artifact cannot be replaced.'})).status).toBe(409);
 const audit=await pg.query("SELECT snapshot FROM hr_workflow_history WHERE kind='privacy_request' AND record_id=$1 ORDER BY version DESC LIMIT 1",[requestId]);expect((audit.rows[0].snapshot as any).exportHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(audit.rows)).not.toContain('qid_number');
 await pg.query("UPDATE privacy_access_exports SET content='{}' WHERE request_id=$1",[requestId]);expect((await call(subject,`/${requestId}/export`)).status).toBe(409);
});
test('corrections apply only after independent review, reject protected fields and stale profiles, and close once',async()=>{
 const created=await call(subject,'',{employeeId:personId,kind:'correction',details:'Please correct my personal contact email address.',submissionKey:randomUUID()});const requestId=created.body.id;
 const proposal={version:1,response:'Verified updated personal contact details with the subject.',correction:{personalEmail:'corrected@example.test'}};
 expect((await call(preparer,`/${requestId}/prepare-correction`,{...proposal,correction:{status:'inactive'}})).status).toBe(400);
 expect((await call(preparer,`/${requestId}/prepare-correction`,proposal)).status).toBe(200);
 expect((await pg.query('SELECT personal_email FROM employees WHERE id=$1',[personId])).rows[0].personal_email).toBeNull();
 expect((await call(preparer,`/${requestId}/fulfill`,{version:2,response:'Cannot self-approve a profile correction.'})).status).toBe(403);
 await pg.query('UPDATE employees SET record_version=record_version+1 WHERE id=$1',[personId]);
 expect((await call(reviewer,`/${requestId}/fulfill`,{version:2,response:'Stale employee profile must block fulfilment.'})).status).toBe(409);
 expect((await call(preparer,`/${requestId}/prepare-correction`,{...proposal,version:2})).status).toBe(200);
 expect((await call(reviewer,`/${requestId}/fulfill`,{version:3,response:'Independent verification complete; apply the reviewed correction.'})).status).toBe(200);
 expect((await pg.query('SELECT personal_email FROM employees WHERE id=$1',[personId])).rows[0].personal_email).toBe('corrected@example.test');
 expect((await call(reviewer,`/${requestId}/fulfill`,{version:4,response:'Cannot apply the correction a second time.'})).status).toBe(409);
 const audit=await pg.query("SELECT snapshot FROM hr_workflow_history WHERE kind='privacy_request' AND record_id=$1 ORDER BY version DESC LIMIT 1",[requestId]);expect((audit.rows[0].snapshot as any).correctionFields).toEqual(['personalEmail']);expect(JSON.stringify(audit.rows)).not.toContain('corrected@example.test');
});
