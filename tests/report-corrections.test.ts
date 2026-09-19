import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import type {Server} from 'node:http';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import {defaultCompanySettings} from '../shared/settings';
import {qatarToday} from '../server/services/reportRecords';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import reports,{reportRunLimiter} from '../server/routes/reportSnapshots';
import dashboard from '../server/routes/dashboard';
import teamTasks from '../server/routes/teamTasks';
import corrections from '../server/routes/candidateCorrections';
import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string;
const reason='Verified source records with HR';
async function user(name='admin',role:s.UserRole='super_admin'){
 const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('ReportTest123!',4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,'ReportTest123!')).accessToken};
}
async function employee(n=1,extra:any={}){const [e]=await ctx.db.insert(s.employees).values({employeeId:'EMP-'+n,firstName:'Private',lastName:'Worker',gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'PRIVATE-'+n,primaryMobile:'PRIVATE',residentialAddress:'PRIVATE-ADDRESS',emergencyContactName:'PRIVATE',emergencyContactNumber:'PRIVATE',department:'Operations',position:'Host',location:'Mall',joiningDate:'2020-01-01',type:'temporary',...extra}).returning();return e;}
async function req(u:any,path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+(u?.token||''),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text(),headers:r.headers};}
const run=(u:any,kind='headcount',filters:any={},requestKey=randomUUID())=>req(u,'/reporting/snapshots/runs',{kind,filters,requestKey});
async function candidate(){const [c]=await ctx.db.insert(s.candidates).values({fullNameEn:'Initial Candidate',email:'candidate@example.test',phone:'private',source:'other'}).returning();return c;}
const correction=(u:any,c:any,fields:any,expectedVersion=c.recordVersion)=>req(u,`/hiring/candidates/${c.id}/corrections`,{fields,expectedVersion,reason});
beforeAll(async()=>{process.env.JWT_SECRET='report-corrections-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='report-corrections-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use(authenticate,moduleAccess);app.use('/reporting/snapshots',reports);app.use('/team-tasks',teamTasks);app.use('/dashboard',dashboard);app.use('/hiring',corrections);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{for(let id=1;id<=10;id++)reportRunLimiter.resetKey(String(id));await pg.exec('TRUNCATE employees,users,candidates,workforce_sites,report_correction_history,app_settings RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test('report snapshots require both report and underlying module access and remain owner-private',async()=>{
 const admin=await user(),other=await user('other'),exec=await user('exec','c_level_executive'),staff=await user('staff','employee');
 expect((await req(null,'/reporting/snapshots/catalog')).status).toBe(401);expect((await run(staff)).status).toBe(403);expect((await run(exec,'compliance')).status).toBe(403);
 const r=await run(admin);expect(r.status).toBe(201);expect(r.headers.get('cache-control')).toBe('no-store');
 for(const suffix of ['','.csv'])expect((await req(other,`/reporting/snapshots/runs/${r.body.id}${suffix}`)).status).toBe(404);
 expect((await req(other,'/reporting/snapshots/runs')).body.items).toHaveLength(0);
 await ctx.db.update(s.users).set({role:'employee'}).where(eq(s.users.id,admin.id));expect((await req(admin,`/reporting/snapshots/runs/${r.body.id}.csv`)).status).toBe(403);
});
test('saved totals and CSV remain stable after data changes; retry keys are bound to filters',async()=>{
 const u=await user();await employee(1,{department:' =SUM(1,2)'});const key=randomUUID(),r=await run(u,'headcount',{},key);expect(r.status).toBe(201);expect(r.body.snapshot.summary.registered_employees).toBe(1);
 await employee(2);expect((await run(u,'headcount',{},key)).body.id).toBe(r.body.id);expect((await run(u,'headcount',{department:'Operations'},key)).status).toBe(409);
 const csv=await req(u,`/reporting/snapshots/runs/${r.body.id}.csv`);expect(csv.status).toBe(200);expect(csv.body).toContain("' =SUM(1,2)");expect(csv.body).not.toContain('PRIVATE');expect((await req(u,`/reporting/snapshots/runs/${r.body.id}`)).body.snapshot.summary.registered_employees).toBe(1);
});
test('turnover uses historical date endpoints and admin policy is pinned to each run',async()=>{
 const u=await user(),hr=await user('hr','hr');await employee(1);await employee(2,{terminationDate:'2026-01-31',status:'inactive'});await employee(3,{joiningDate:'2026-01-01'});await employee(4,{joiningDate:'2026-01-20'});
 const filters={from:'2026-01-01',to:'2026-01-31'},r=await run(u,'turnover',filters);expect(r.status).toBe(201);expect(r.body.snapshot.summary).toEqual({opening:2,closing:3,exits:1,turnover_percent:40});
 const input={version:0,turnoverDenominator:'opening',reason};expect((await req(hr,'/reporting/snapshots/policy',input)).status).toBe(403);expect((await req(u,'/reporting/snapshots/policy',input)).status).toBe(201);expect((await req(u,'/reporting/snapshots/policy',input)).status).toBe(409);
 expect((await run(u,'turnover',filters)).body.snapshot.summary.turnover_percent).toBe(50);expect((await req(u,`/reporting/snapshots/runs/${r.body.id}`)).body.snapshot.policy.version).toBe(0);expect((await req(u,'/reporting/snapshots/policy/history')).body.items).toHaveLength(1);
});
test('leave sums saved approved booking days rather than calendar duration or overlapping bookings',async()=>{
 const u=await user(),e=await employee();await ctx.db.insert(s.leaves).values([{employeeId:e.id,leaveType:'annual',startDate:'2026-01-30',endDate:'2026-02-05',totalDays:2,reason:'Test',status:'approved'},{employeeId:e.id,leaveType:'annual',startDate:'2025-12-30',endDate:'2026-01-05',totalDays:4,reason:'Test',status:'approved'},{employeeId:e.id,leaveType:'annual',startDate:'2026-01-10',endDate:'2026-01-11',totalDays:1,reason:'Test',status:'pending'}]);
 const r=await run(u,'leave',{from:'2026-01-01',to:'2026-01-31'});expect(r.status).toBe(201);expect(r.body.snapshot.summary).toEqual({bookings:1,charged_days:2});
});
test('compliance derives current expiry state and pins configured warning days',async()=>{
 const u=await user(),e=await employee(),today=qatarToday(),expiry=new Date(Date.parse(today)+10*86400000).toISOString().slice(0,10);
 await ctx.db.insert(s.documents).values({employeeId:e.id,documentType:'passport',documentNumber:'PRIVATE-DOC',issueDate:'2020-01-01',expiryDate:expiry,documentFile:'PRIVATE-FILE',status:'valid'});
 await ctx.db.insert(s.appSettings).values({key:'company',value:{...defaultCompanySettings,documentExpiryDays:15}});
 const r=await run(u,'compliance');expect(r.status).toBe(201);expect(r.body.snapshot.rows[0]).toMatchObject({status:'expiring_soon',documents:1});expect(r.body.snapshot.policy.documentExpiryDays).toBe(15);expect(JSON.stringify(r.body)).not.toContain('PRIVATE');
});
test('workforce uses site calendar days, avoids duplicated capacity, and excludes unapproved time',async()=>{
 const u=await user(),e=await employee(),e2=await employee(2),[site]=await ctx.db.insert(s.workforceSites).values({name:'Mall',timezone:'Asia/Qatar'}).returning(),[team]=await ctx.db.insert(s.workforceTeams).values({siteId:site.id,name:'FEC',kind:'fec'}).returning();
 const [shift]=await ctx.db.insert(s.workforceShifts).values({teamId:team.id,role:'Host',headcount:3,startAt:new Date('2026-01-01T22:00:00Z'),endAt:new Date('2026-01-02T02:00:00Z'),createdBy:u.id}).returning();
 const assignments=await ctx.db.insert(s.workforceAssignments).values([e,e2].map(p=>({shiftId:shift.id,employeeId:p.id,status:'accepted',createdBy:u.id}))).returning();
 await ctx.db.insert(s.workforceTimesheets).values(assignments.map((a:any,i:number)=>({assignmentId:a.id,actualStartAt:shift.startAt,actualEndAt:shift.endAt,breakMinutes:0,workedMinutes:240,employeeNote:'Synthetic test time',status:i?'draft':'approved',...(i?{}:{payableMinutes:220,reviewerId:u.id,reviewedAt:new Date(),policyReference:'Checked time'})})));
 expect((await run(u,'workforce',{from:'2026-01-01',to:'2026-01-01'})).body.snapshot.summary.shifts).toBe(0);
 const r=await run(u,'workforce',{from:'2026-01-02',to:'2026-01-02',teamId:team.id});expect(r.status).toBe(201);expect(r.body.snapshot.summary).toMatchObject({shifts:1,capacity:3,accepted:2,approved_payable_minutes:220});
});
test('invalid filters reject and failed audit rolls back a report run',async()=>{
 const u=await user();for(const [kind,filters] of [['headcount',{from:'2026-01-01'}],['leave',{from:'2026-02-30',to:'2026-03-01'}],['turnover',{from:'2026-02-01',to:'2026-01-01'}],['workforce',{from:'2026-01-01',to:'2026-01-01',department:'Private'}],['headcount',{ownerId:99}]] as const)expect((await run(u,kind,filters)).status).toBe(400);
 await pg.exec("ALTER TABLE activity_logs ADD CONSTRAINT fail_report_audit CHECK(entity_type <> 'report_run')");try{expect((await run(u)).status).toBe(500);expect((await req(u,'/reporting/snapshots/runs')).body.items).toHaveLength(0);}finally{await pg.exec('ALTER TABLE activity_logs DROP CONSTRAINT fail_report_audit');}
 expect((await req(u,'/reporting/snapshots/export/headcount')).status).toBe(410);
});
test('candidate corrections preserve versions, reject forged fields, and keep private history',async()=>{
 const u=await user(),staff=await user('staff','employee'),c=await candidate();expect((await correction(staff,c,{email:'new@example.test'})).status).toBe(403);expect((await req(staff,`/hiring/candidates/${c.id}/corrections`)).status).toBe(403);
 expect((await correction(u,c,{recordVersion:55})).status).toBe(400);expect((await correction(u,c,{fullNameEn:'Correct Name',email:'new@example.test'})).body.recordVersion).toBe(2);expect((await correction(u,c,{phone:'stale'})).status).toBe(409);
 const h=await req(u,`/hiring/candidates/${c.id}/corrections`);expect(h.body.items.map((r:any)=>r.version)).toEqual([2,1]);expect(h.body.items[1].snapshot.fullNameEn).toBe('Initial Candidate');expect((await ctx.db.select().from(s.candidates))).toHaveLength(1);
});
test('candidate identity freezes at first offer, contact corrections remain possible, and SQL guards reject bypasses',async()=>{
 const u=await user(),e=await employee(),c=await candidate(),[job]=await ctx.db.insert(s.jobRequisitions).values({requisitionId:'REQ',jobTitle:'Host',department:'Operations',location:'Mall',positionType:'temporary',numberOfVacancies:1,jobDescription:'Host',qualifications:'Experience',responsibilities:'Support',requiredSkills:'Service',requestedBy:e.id}).returning(),[a]=await ctx.db.insert(s.jobApplications).values({candidateId:c.id,requisitionId:job.id,applicationDate:'2026-01-01'}).returning();
 await ctx.db.insert(s.jobOffers).values({applicationId:a.id,offerDate:'2026-01-01',expiryDate:'2030-01-01',salary:1000,status:'draft',createdBy:e.id});
 expect((await req(u,`/hiring/candidates/${c.id}/correction-record`)).body.identityLocked).toBe(true);expect((await correction(u,c,{fullNameEn:'Different Person'})).status).toBe(409);await expect(pg.query('UPDATE candidates SET full_name_en=$1 WHERE id=$2',['Different Person',c.id])).rejects.toThrow('frozen');
 expect((await correction(u,c,{phone:'Correct phone'})).status).toBe(200);expect((await ctx.db.select().from(s.employees))[0].primaryMobile).toBe('PRIVATE');
});
test('candidate edit and private history roll back together if audit fails',async()=>{
 const u=await user(),c=await candidate();await pg.exec("ALTER TABLE activity_logs ADD CONSTRAINT fail_candidate_audit CHECK(entity_type <> 'candidate_correction')");try{expect((await correction(u,c,{phone:'new'})).status).toBe(500);expect((await req(u,`/hiring/candidates/${c.id}/correction-record`)).body.candidate).toMatchObject({recordVersion:1,phone:'private'});expect((await req(u,`/hiring/candidates/${c.id}/corrections`)).body.items).toHaveLength(0);}finally{await pg.exec('ALTER TABLE activity_logs DROP CONSTRAINT fail_candidate_audit');}
});

test('team task owner lookup works for administrators after the import correction',async()=>{const u=await user(),[site]=await ctx.db.insert(s.workforceSites).values({name:'Task test site',timezone:'Asia/Qatar'}).returning(),[team]=await ctx.db.insert(s.workforceTeams).values({siteId:site.id,name:'Task test team',kind:'event'}).returning();const r=await req(u,'/team-tasks/owners?teamId='+team.id);expect(r.status).toBe(200);expect(Array.isArray(r.body)).toBe(true);});


test('dashboard employee summaries respect team scope and deny self-only roles',async()=>{
 const lead=await user('lead','department_head'),staff=await user('staff','employee'),admin=await user();
 const manager=await employee(1,{userId:lead.id});await employee(2,{reportingManagerId:manager.id});await employee(3);await employee(4,{department:'Finance'});
 const summary=await req(lead,'/dashboard/employee-summary');expect(summary.status).toBe(200);expect(summary.body.summary.totalEmployees).toBe(2);
 expect((await req(staff,'/dashboard/employee-summary')).status).toBe(403);
 expect((await req(admin,'/dashboard/employee-summary')).body.summary.totalEmployees).toBe(4);
});
test('dashboard department scope fails closed when the account has no department',async()=>{
 const hr=await user('department-hr','hr_manager');await employee(1);await employee(2,{department:'Finance'});
 expect((await req(hr,'/dashboard/employee-summary')).body.summary.totalEmployees).toBe(0);
 await ctx.db.update(s.users).set({department:'Operations'}).where(eq(s.users.id,hr.id));
 expect((await req(hr,'/dashboard/employee-summary')).body.summary.totalEmployees).toBe(1);
});

test('dashboard event totals are hidden from roles without event management access',async()=>{
 const admin=await user(),lead=await user('lead','department_head');
 await ctx.db.insert(s.events).values({name:'Private future event',startDate:'2099-01-01',endDate:'2099-01-02',location:'Test',status:'upcoming',createdBy:admin.id});
 expect((await req(admin,'/dashboard/stats')).body.upcomingEvents).toBe(1);
 expect((await req(lead,'/dashboard/stats')).body.upcomingEvents).toBe(0);
});
