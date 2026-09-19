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
import {reportKinds,datedReports,defaultAnalyticsPolicy,previousPeriod} from '../shared/reporting';
const ctx=vi.hoisted(()=>({db:null as any}));vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import reporting from '../server/routes/reporting';
import analytics from '../server/routes/analytics';
import {reportRunLimiter} from '../server/routes/reportSnapshots';
import {runReportSchedules,scheduledPeriod} from '../server/services/reportWorkspace';
import {authenticate} from '../server/middleware/auth';
import {moduleAccess} from '../server/middleware/moduleAccess';
import {authService} from '../server/services/auth';
let pg:PGlite,server:Server,base:string,admin:any;
const reason='Verified synthetic reporting scenario',period={from:'2026-01-01',to:'2026-01-31'};
async function user(name:string,role:s.UserRole='super_admin',department='Operations'){
 const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash('ReportTest123!',4),firstName:name,lastName:'Synthetic',role,department,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,'ReportTest123!')).accessToken};
}
async function employee(n=1,extra:any={}){return (await ctx.db.insert(s.employees).values({employeeId:'RA-'+n,firstName:'Private',lastName:'Worker',gender:'other',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'PRIVATE-'+n,primaryMobile:'PRIVATE',residentialAddress:'PRIVATE',emergencyContactName:'PRIVATE',emergencyContactNumber:'PRIVATE',department:'Operations',position:'Host',location:'Mall',joiningDate:'2020-01-01',type:'temporary',...extra}).returning())[0];}
async function req(u:any,path:string,body?:unknown,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+(u?.token||''),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:r.headers.get('content-type')?.includes('json')?await r.json():await r.text()};}
const api='/reporting/snapshots',run=(u:any,kind='headcount',filters:any={},extra={})=>req(u,api+'/runs',{kind,filters,requestKey:randomUUID(),...extra});
beforeAll(async()=>{process.env.JWT_SECRET='analytics-test-access-secret-32-characters';process.env.JWT_REFRESH_SECRET='analytics-test-refresh-secret-32-characters';pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json(),authenticate,moduleAccess);app.use('/reporting',reporting);app.use('/analytics',analytics);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{for(let i=1;i<20;i++)reportRunLimiter.resetKey(String(i));await pg.exec('TRUNCATE employees,users,candidates,workforce_sites,report_correction_history,app_settings RESTART IDENTITY CASCADE');admin=await user('admin');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});

test.each(reportKinds)('%s report executes against the migrated schema and saves exportable empty results',async kind=>{const response=await run(admin,kind,datedReports.includes(kind)?period:{});expect(response.status,JSON.stringify(response.body)).toBe(201);expect(response.body.snapshot.columns.length).toBeGreaterThan(0);expect(response.body.snapshot.rows).toEqual([]);expect((await req(admin,api+`/runs/${response.body.id}.csv`)).status).toBe(200);});
test('department and manager reports intersect source access, prohibit salary aggregation and invalidate moved-team snapshots',async()=>{
 const hr=await user('hr','hr_manager'),manager=await user('manager','department_head'),lead=await employee(1,{userId:manager.id}),member=await employee(2,{reportingManagerId:lead.id}),other=await employee(3,{department:'Finance'});
 expect((await run(hr)).body.snapshot.summary.registered_employees).toBe(2);expect((await run(hr,'headcount',{department:'Finance'})).body.snapshot.rows).toEqual([]);
 const r=await run(manager);expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.summary.registered_employees).toBe(1);expect((await run(manager,'payroll',period)).status).toBe(403);
 await employee(4,{reportingManagerId:lead.id});expect((await req(manager,api+`/runs/${r.body.id}`)).body.snapshot.summary.registered_employees).toBe(1);
 await ctx.db.update(s.employees).set({reportingManagerId:null}).where(eq(s.employees.id,member.id));expect((await req(manager,api+`/runs/${r.body.id}.csv`)).status).toBe(403);
 await ctx.db.update(s.users).set({department:'Finance'}).where(eq(s.users.id,hr.id));expect((await run(hr)).body.snapshot.summary.registered_employees).toBe(1);
});
test('event reports require a current team grant and close old snapshots when it is revoked',async()=>{
 const manager=await user('event','event_manager'),e=await employee(),other=await employee(2),[site]=await ctx.db.insert(s.workforceSites).values({name:'Synthetic Mall',timezone:'Asia/Qatar'}).returning(),[team]=await ctx.db.insert(s.workforceTeams).values({siteId:site.id,name:'Activation',kind:'event'}).returning();
 const [grant]=await ctx.db.insert(s.workforceGrants).values({teamId:team.id,userId:manager.id,permission:'view',startAt:new Date(Date.now()-86400000),endAt:new Date(Date.now()+86400000)}).returning();
 await ctx.db.insert(s.workforceMembers).values({teamId:team.id,employeeId:e.id,startAt:new Date(Date.now()-86400000),endAt:new Date(Date.now()+86400000)});
 const r=await run(manager);expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.summary.registered_employees).toBe(1);
 await ctx.db.update(s.workforceGrants).set({revokedAt:new Date()}).where(eq(s.workforceGrants.id,grant.id));expect((await req(manager,api+`/runs/${r.body.id}`)).status).toBe(403);expect((await run(manager)).body.snapshot.rows).toEqual([]);
});
test('attendance compares recorded periods without counting pending or open sessions as eligible time',async()=>{
 const e=await employee();await ctx.db.insert(s.attendance).values([{employeeId:e.id,date:'2026-01-10',status:'present',checkIn:new Date('2026-01-10T06:00Z'),checkOut:new Date('2026-01-10T14:00Z'),totalWorkHours:480,overtimeHours:30,approvalStatus:'approved'},{employeeId:e.id,date:'2026-01-11',status:'present',checkIn:new Date('2026-01-11T06:00Z'),checkOut:new Date('2026-01-11T14:00Z'),totalWorkHours:480,approvalStatus:'pending'},{employeeId:e.id,date:'2026-01-12',status:'present',checkIn:new Date('2026-01-12T06:00Z'),totalWorkHours:999,approvalStatus:'pending'},{employeeId:e.id,date:'2025-12-15',status:'present',checkIn:new Date('2025-12-15T06:00Z'),checkOut:new Date('2025-12-15T14:00Z'),totalWorkHours:450}]);
 const requestKey=randomUUID(),r=await run(admin,'attendance',period,{requestKey,comparePrevious:true});expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.summary).toMatchObject({records:3,open_sessions:1,recorded_work_minutes:960,eligible_work_minutes:480});expect(r.body.snapshot.comparison.summary.eligible_work_minutes).toBe(450);
 expect((await run(admin,'attendance',period,{requestKey,comparePrevious:true})).body.id).toBe(r.body.id);expect((await run(admin,'attendance',period,{requestKey,comparePrevious:false})).status).toBe(409);expect((await req(admin,api+`/runs/${r.body.id}.csv`)).body).toContain('2025-12-01');
 await expect(pg.query('UPDATE report_runs SET snapshot=$1 WHERE id=$2',['{}',r.body.id])).rejects.toThrow('immutable');await expect(pg.query('DELETE FROM report_runs WHERE id=$1',[r.body.id])).rejects.toThrow('immutable');
});
test('money remains exact per unit and status; monetary totals are not mixed',async()=>{
 const e=await employee();await ctx.db.insert(s.payroll).values({employeeId:e.id,month:1,year:2026,basicSalary:'1000.10',netSalary:'1080.25',allowances:{housing:100.25},deductions:{other:20.1},status:'draft'});
 const p=await run(admin,'payroll',period);expect(p.status,JSON.stringify(p.body)).toBe(201);expect(p.body.snapshot.rows[0]).toMatchObject({currency:'UNSPECIFIED',basic_amount:'1000.10',allowance_amount:'100.25',deduction_amount:'20.1',net_amount:'1080.25',legacy_without_review:1});
 for(const [unit,amount,status] of [['QAR','10.25','approved'],['USD','99.75','approved'],['QAR','100.50','draft']])await pg.query("INSERT INTO service_requests(kind,policy_key,employee_id,request_date,title,details,amount,policy_snapshot,status,created_by) VALUES('expense','travel',$1,'2026-01-15','PRIVATE','PRIVATE',$2,$3,$4,$5)",[e.id,amount,JSON.stringify({config:{unit}}),status,admin.id]);
 const x=await run(admin,'expenses',period);expect(x.status,JSON.stringify(x.body)).toBe(201);expect(x.body.snapshot.rows).toHaveLength(3);expect(x.body.snapshot.summary).toEqual({requests:3,fulfilled_requests:0});expect(JSON.stringify(x.body)).not.toContain('PRIVATE');
});
test('quiz averages count only submitted attempts and exclude withdrawn enrollments from overdue work',async()=>{
 const e=await employee();const c=(await pg.query<any>("INSERT INTO learning_courses(definition,created_by) VALUES('{}',$1) RETURNING id",[admin.id])).rows[0].id;
 const release=(await pg.query<any>("INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES($1,1,1,'{}','{}',$2) RETURNING id",[c,admin.id])).rows[0].id;
 const enrollment=(await pg.query<any>("INSERT INTO learning_enrollments(course_id,employee_id,status,course_snapshot,due_date,requested_by,approver_id,created_at) VALUES($1,$2,'withdrawn','{\"title\":\"Fire safety\"}','2026-01-01',$3,$3,'2026-01-10') RETURNING id",[c,e.id,admin.id])).rows[0].id;
 await pg.query('INSERT INTO learning_induction_enrollments(enrollment_id,release_id) VALUES($1,$2)',[enrollment,release]);
 for(const [i,score,status,passed] of [[1,80,'submitted',true],[2,60,'submitted',false],[3,null,'expired',null]] as const)await pg.query("INSERT INTO learning_induction_attempts(enrollment_id,attempt_number,start_key,questions,status,expires_at,created_by,score,passed) VALUES($1,$2,$3,'[]',$4,now(),$5,$6,$7)",[enrollment,i,randomUUID(),status,admin.id,score,passed]);
 const r=await run(admin,'learning',period);expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.rows[0]).toMatchObject({enrollments:1,submitted_quizzes:2,passed_quizzes:1,average_quiz_score:70,overdue:0});
});
test('small performance samples are suppressed and reporting policy revisions affect only future snapshots',async()=>{
 const e=await employee();const c=(await pg.query<any>("INSERT INTO performance_cycles(name,period_start,period_end,due_date,self_required,rubric,rating_labels,created_by) VALUES('January','2026-01-01','2026-01-31','2026-02-10',false,'[]','[]',$1) RETURNING id",[admin.id])).rows[0].id;
 await pg.query("INSERT INTO performance_assessments(cycle_id,employee_id,reviewer_id,due_date,self_required,status,final_rating,published_at) VALUES($1,$2,$3,'2026-02-10',false,'published',4,now())",[c,e.id,admin.id]);
 const old=await run(admin,'performance',period);expect(old.status,JSON.stringify(old.body)).toBe(201);expect(old.body.snapshot.rows[0].average_published_rating).toBeNull();
 const input={version:0,turnoverDenominator:'opening',config:{...defaultAnalyticsPolicy,minimumPerformanceSample:1},reason};expect((await req(admin,api+'/policy',input)).status).toBe(201);expect((await req(admin,api+'/policy',input)).status).toBe(409);
 expect((await run(admin,'performance',period)).body.snapshot.rows[0].average_published_rating).toBe(4);expect((await req(admin,api+`/runs/${old.body.id}`)).body.snapshot.rows[0].average_published_rating).toBeNull();
});
test('helpdesk scopes confidential cases and department SLAs without message content',async()=>{
 const hr=await user('hr','hr_manager'),worker=await user('worker','permanent_employee'),outside=await user('outside','permanent_employee','Finance');
 await ctx.db.insert(s.helpdeskCases).values([{title:'PRIVATE',category:'general',requesterId:worker.id,assigneeId:hr.id,createdAt:new Date('2026-01-01'),firstResponseDueAt:new Date('2026-01-02')},{title:'PRIVATE',category:'general',requesterId:worker.id,confidential:true,createdAt:new Date('2026-01-01')},{title:'PRIVATE',category:'general',requesterId:outside.id,assigneeId:hr.id,createdAt:new Date('2026-01-01')}]);
 const r=await run(hr,'helpdesk',period);expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.summary).toMatchObject({cases:1,response_breaches:1});expect(JSON.stringify(r.body)).not.toContain('PRIVATE');expect((await run(admin,'helpdesk',period)).body.snapshot.summary.cases).toBe(3);
 await ctx.db.insert(s.helpdeskCases).values({title:'New case',category:'general',requesterId:worker.id,assigneeId:hr.id});expect((await req(hr,api+`/runs/${r.body.id}`)).body.snapshot.summary.cases).toBe(1);
});
test('announcement analytics enforce current audience management after a department transfer',async()=>{
 const hr=await user('hr','hr_manager');await pg.query("INSERT INTO comm_bulletins(title,body,audience,target,status,author_id,publish_at) VALUES('Operations briefing','PRIVATE','department','Operations','published',$1,'2026-01-01'),('Finance briefing','PRIVATE','department','Finance','published',$1,'2026-01-01')",[hr.id]);
 const old=await run(hr,'communications',period);expect(old.status,JSON.stringify(old.body)).toBe(201);expect(old.body.snapshot.rows.map((r:any)=>r.title)).toEqual(['Operations briefing']);
 await ctx.db.update(s.users).set({department:'Finance'}).where(eq(s.users.id,hr.id));expect((await req(hr,api+`/runs/${old.body.id}`)).status).toBe(403);expect((await run(hr,'communications',period)).body.snapshot.rows.map((r:any)=>r.title)).toEqual(['Finance briefing']);
});
test('private views support versioned changes and archival without exposing another owner',async()=>{
 const other=await user('other'),definition={name:'Monthly attendance',kind:'attendance',filters:period,comparePrevious:true,columns:['department','records']},created=await req(admin,api+'/views',definition);expect(created.status).toBe(201);const view=created.body;
 expect((await req(other,api+'/views')).body.items).toEqual([]);expect((await req(other,api+`/views/${view.id}`,{version:1,definition,reason},'PATCH')).status).toBe(409);
 expect((await req(admin,api+`/views/${view.id}`,{version:1,definition:{...definition,name:'Renamed view'},reason},'PATCH')).status).toBe(200);expect((await req(admin,api+`/views/${view.id}/archive`,{version:1,reason})).status).toBe(409);expect((await req(admin,api+`/views/${view.id}/archive`,{version:2,reason})).status).toBe(200);expect((await req(admin,api+'/views')).body.items).toEqual([]);
 expect((await pg.query<any>("SELECT count(*)::int AS n FROM report_correction_history WHERE kind='analytics_view'")).rows[0].n).toBe(3);
});
test('Qatar completed periods and leap-day comparisons have explicit boundaries',()=>{
 expect(scheduledPeriod('daily',8,new Date('2026-02-01T04:59:00Z'))).toBeNull();expect(scheduledPeriod('daily',8,new Date('2026-02-01T05:00:00Z'))).toEqual({from:'2026-01-31',to:'2026-01-31'});
 expect(scheduledPeriod('weekly',0,new Date('2026-02-01T00:00:00Z'))).toEqual({from:'2026-01-25',to:'2026-01-31'});expect(scheduledPeriod('monthly',0,new Date('2024-03-15T00:00:00Z'))).toEqual({from:'2024-02-01',to:'2024-02-29'});expect(previousPeriod('2024-03-01','2024-03-01')).toEqual({from:'2024-02-29',to:'2024-02-29'});
});
test('schedules save once per completed period and revision, remain private, and pause revoked owners',async()=>{
 const definition={name:'Monthly people',kind:'headcount',filters:{},cadence:'monthly',hour:0,enabled:true,reason},schedule=(await req(admin,api+'/schedules',definition)).body;expect(schedule.id).toBeGreaterThan(0);
 const now=new Date();expect((await runReportSchedules(now,admin.id)).created).toBe(1);expect((await runReportSchedules(new Date(+now+3600000),admin.id)).created).toBe(0);expect((await req(admin,api+`/schedules/${schedule.id}/history`)).body.items).toHaveLength(1);
 expect((await req(admin,api+`/schedules/${schedule.id}`,{version:1,definition:{...definition,name:'Updated people'}},'PATCH')).status).toBe(200);expect((await runReportSchedules(new Date(+now+7200000),admin.id)).created).toBe(1);
 const other=await user('other');expect((await req(other,api+`/schedules/${schedule.id}/history`)).status).toBe(404);expect((await req(other,api+'/schedules')).body.items).toEqual([]);
 await ctx.db.update(s.users).set({role:'permanent_employee'}).where(eq(s.users.id,admin.id));const next=new Date(now);next.setUTCMonth(next.getUTCMonth()+1);expect((await runReportSchedules(next)).failed).toBe(1);expect((await pg.query<any>('SELECT enabled,last_error FROM analytics_schedules WHERE id=$1',[schedule.id])).rows[0]).toMatchObject({enabled:false,last_error:'Report and source-module access required'});
});
test('scheduler failure rolls back its snapshot, permits retries and does not repeat successful periods',async()=>{
 const d={name:'Retry report',kind:'headcount',filters:{},cadence:'daily',hour:0,enabled:true,reason};await req(admin,api+'/schedules',d);await pg.exec("ALTER TABLE activity_logs ADD CONSTRAINT reject_report CHECK(entity_type<>'report_run')");const now=new Date();
 try{expect((await runReportSchedules(now)).failed).toBe(1);expect((await pg.query<any>('SELECT count(*)::int AS n FROM report_runs')).rows[0].n).toBe(0);}finally{await pg.exec('ALTER TABLE activity_logs DROP CONSTRAINT reject_report');}
 expect((await runReportSchedules(new Date(+now+3600000))).created).toBe(1);expect((await pg.query<any>('SELECT status FROM analytics_schedule_runs')).rows.map(r=>r.status)).toEqual(['completed']);
 await req(admin,api+'/policy',{version:0,turnoverDenominator:'opening',config:{...defaultAnalyticsPolicy,schedulesEnabled:false},reason});expect((await runReportSchedules(new Date(+now+86400000))).skipped).toBe(true);
});
test('row limit rejects rather than truncates totals and retired query routes do not expose data',async()=>{
 await req(admin,api+'/policy',{version:0,turnoverDenominator:'opening',config:{...defaultAnalyticsPolicy,maxRows:100},reason});for(let n=1;n<=101;n++)await employee(n,{department:'Department '+n});const r=await run(admin);expect(r.status).toBe(400);expect(r.body.message).toContain('narrow');expect((await req(admin,api+'/runs')).body.items).toEqual([]);
 for(const path of ['/reporting/employee-headcount','/reporting/saved-views','/analytics/turnover-risk','/analytics/custom-reports'])expect((await req(admin,path)).status).toBe(410);
});
test('revoking channel management invalidates announcement snapshots even without employee membership changes',async()=>{
 const manager=await user('event','event_manager'),[site]=await ctx.db.insert(s.workforceSites).values({name:'Mall',timezone:'Asia/Qatar'}).returning(),[team]=await ctx.db.insert(s.workforceTeams).values({siteId:site.id,name:'FEC',kind:'fec'}).returning();
 const [grant]=await ctx.db.insert(s.workforceGrants).values({teamId:team.id,userId:manager.id,permission:'schedule',startAt:new Date(Date.now()-3600000),endAt:new Date(Date.now()+3600000)}).returning();
 const channel=(await pg.query<any>("INSERT INTO comm_channels(name,kind,owner_id,team_id,starts_at,ends_at) VALUES('Synthetic team','workforce',$1,$2,now()-interval '1 hour',now()+interval '1 hour') RETURNING id",[manager.id,team.id])).rows[0].id;
 await pg.query("INSERT INTO comm_bulletins(title,body,audience,target,status,author_id,publish_at) VALUES('Briefing','PRIVATE','channel',$1,'published',$2,'2026-01-01')",[String(channel),manager.id]);
 const r=await run(manager,'communications',period);expect(r.status,JSON.stringify(r.body)).toBe(201);expect(r.body.snapshot.summary.announcements).toBe(1);
 await ctx.db.update(s.workforceGrants).set({revokedAt:new Date()}).where(eq(s.workforceGrants.id,grant.id));expect((await req(manager,api+`/runs/${r.body.id}.csv`)).status).toBe(403);expect((await run(manager,'communications',period)).body.snapshot.rows).toEqual([]);
});
test('future-hour schedules do not starve later due jobs in the bounded queue',async()=>{
 for(let i=0;i<11;i++)await req(admin,api+'/schedules',{name:'Queue '+i,kind:'headcount',filters:{},cadence:'daily',hour:i<10?23:0,enabled:true,reason});
 const now=new Date('2026-02-01T05:00:00Z');expect((await runReportSchedules(now)).created).toBe(0);expect((await runReportSchedules(now)).created).toBe(1);
});
