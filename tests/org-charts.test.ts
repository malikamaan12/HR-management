import {readFileSync,readdirSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,test,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import {eq} from 'drizzle-orm';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as s from '../shared/schema';
import {orgChartInput} from '../shared/org-chart';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db;},pool:{}}));
import router from '../server/routes/org-charts';
import {authService} from '../server/services/auth';
let pg:PGlite,server:ReturnType<ReturnType<typeof express>['listen']>,origin:string;
const password='ChartTesting9!';
async function account(name:string,role:any){const [u]=await ctx.db.insert(s.users).values({username:name,email:name+'@example.test',password:await bcrypt.hash(password,4),firstName:name,lastName:'Test',role,isActive:true,approvalStatus:'approved'}).returning();return {...u,token:(await authService.login(name,password)).accessToken};}
async function request(token:string,path:string,body?:unknown){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};}
async function fixture(){
 const admin=await account('admin','super_admin'),lead=await account('lead','department_head'),other=await account('other','employee');
 const people=[];for(let i=1;i<=3;i++){const [p]=await ctx.db.insert(s.employees).values({employeeId:'CHART-'+i,firstName:'Person',lastName:String(i),gender:'other',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'CHART-QID-'+i,primaryMobile:'00000000',residentialAddress:'Test',emergencyContactName:'Test',emergencyContactNumber:'00000000',type:'permanent',department:'Operations',position:'Host',location:'Doha',joiningDate:'2025-01-01'}).returning();people.push(p);}
 await ctx.db.update(s.employees).set({reportingManagerId:people[0].id}).where(eq(s.employees.id,people[1].id));
 const [site]=await ctx.db.insert(s.workforceSites).values({name:'Chart venue',timezone:'Asia/Qatar'}).returning();
 const [team]=await ctx.db.insert(s.workforceTeams).values({name:'Test FEC',kind:'fec',siteId:site.id}).returning();
 const now=Date.now();const [grant]=await ctx.db.insert(s.workforceGrants).values({teamId:team.id,userId:lead.id,permission:'view',startAt:new Date(now-86400000*2),endAt:new Date(now+86400000*2)}).returning();
 for(const p of people.slice(0,2))await ctx.db.insert(s.workforceMembers).values({teamId:team.id,employeeId:p.id,startAt:new Date(now-86400000*2),endAt:new Date(now+86400000*2)});
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const body={version:0,effectiveFrom:date,effectiveTo:date,reason:'Initial team hierarchy',nodes:people.map((p,i)=>({employeeId:p.id,parentEmployeeId:i?people[0].id:null,role:i?'Team member':'Operations manager'}))};
 return {admin,lead,other,people,site,team,grant,date,body,path:'/teams/'+team.id};
}
beforeAll(async()=>{process.env.JWT_SECRET='org-chart-access-secret-at-least32';process.env.JWT_REFRESH_SECRET='org-chart-refresh-secret-at-least32';pg=new PGlite();for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync('migrations/'+f,'utf8'));ctx.db=drizzle(pg);const app=express();app.use(express.json());app.use(router);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));origin='http://127.0.0.1:'+(server.address() as any).port;});
beforeEach(async()=>{await pg.exec('TRUNCATE users,employees,workforce_sites RESTART IDENTITY CASCADE');});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));await pg.close();});
test('company chart exposes only work directory fields to HR administrators',async()=>{
 const f=await fixture();const result=await request(f.admin.token,'/company');expect(result.status).toBe(200);expect(result.cache).toBe('no-store');expect(result.body.people).toHaveLength(3);
 expect(result.body.people[1].reportingManagerId).toBe(f.people[0].id);expect(JSON.stringify(result.body)).not.toMatch(/qidNumber|salary|password|dateOfBirth/);
 expect((await request(f.lead.token,'/company')).status).toBe(403);
});
test('team chart preserves revisions, rejects stale writes and does not rewrite company reporting',async()=>{
 const f=await fixture();expect((await request(f.admin.token,f.path,f.body)).status).toBe(201);
 const revised={...f.body,version:1,nodes:f.body.nodes.map(n=>({...n,role:'Event role'}))};expect((await request(f.admin.token,f.path,revised)).status).toBe(201);
 expect((await request(f.admin.token,f.path,revised)).status).toBe(409);
 const result=await request(f.admin.token,f.path+'?date='+f.date);expect(result.body.version).toBe(2);expect(result.body.revision).toBe(2);expect(result.body.history).toHaveLength(2);expect(result.body.nodes[1].role).toBe('Event role');
 expect((await ctx.db.select().from(s.employees).where(eq(s.employees.id,f.people[1].id)))[0].reportingManagerId).toBe(f.people[0].id);
 expect((await pg.query<any>('SELECT nodes FROM workforce_org_chart_revisions WHERE version=1')).rows[0].nodes[0].role).toBe('Operations manager');
});
test('team viewer sees only roster members during grant dates; role changes cannot grant chart editing',async()=>{
 const f=await fixture();await request(f.admin.token,f.path,f.body);
 const result=await request(f.lead.token,f.path+'?date='+f.date);expect(result.status).toBe(200);expect(result.body.nodes).toHaveLength(2);expect(result.body.history).toEqual([]);expect(result.body.canEdit).toBe(false);
 expect((await request(f.lead.token,f.path,{...f.body,version:1})).status).toBe(403);expect((await request(f.other.token,f.path)).status).toBe(404);
 expect((await request(f.lead.token,f.path+'?date=2000-01-01')).status).toBe(404);
 await ctx.db.update(s.workforceGrants).set({revokedAt:new Date()}).where(eq(s.workforceGrants.id,f.grant.id));expect((await request(f.lead.token,f.path)).status).toBe(404);
});
test('invalid reporting loops, duplicates, missing parents and inactive staff are rejected atomically',async()=>{
 const f=await fixture();for(const nodes of [[{...f.body.nodes[0],parentEmployeeId:f.people[0].id}], [...f.body.nodes,f.body.nodes[0]], [{...f.body.nodes[0],parentEmployeeId:999}], [{...f.body.nodes[0],parentEmployeeId:f.people[1].id},f.body.nodes[1]]])expect((await request(f.admin.token,f.path,{...f.body,nodes})).status).toBe(400);
 await ctx.db.update(s.employees).set({status:'terminated'}).where(eq(s.employees.id,f.people[0].id));expect((await request(f.admin.token,f.path,f.body)).status).toBe(400);
 expect((await pg.query('SELECT * FROM workforce_org_chart_revisions')).rows).toHaveLength(0);
 expect(orgChartInput.safeParse({...f.body,effectiveTo:'2000-01-01'}).success).toBe(false);
});
test('dated revisions select the latest applicable chart and permit an explicitly empty chart',async()=>{
 const f=await fixture();await request(f.admin.token,f.path,f.body);
 expect((await request(f.admin.token,f.path+'?date=2000-01-01')).body.revision).toBeNull();
 await request(f.admin.token,f.path,{...f.body,version:1,nodes:[]});const result=await request(f.admin.token,f.path);expect(result.body.nodes).toEqual([]);expect(result.body.revision).toBe(2);
 expect((await request(f.admin.token,f.path,{...f.body,version:2,effectiveTo:null})).status).toBe(201);
 expect((await request(f.admin.token,f.path+'?date=2099-01-01')).body.nodes).toHaveLength(3);
});
test('team details are editable with stale-write protection, including head office',async()=>{
 const f=await fixture();const previous={name:f.team.name,kind:f.team.kind,siteId:f.team.siteId};const payload={previous,updated:{...previous,name:'Head Office',kind:'head_office'}};
 expect((await request(f.lead.token,f.path+'/details',payload)).status).toBe(403);expect((await request(f.admin.token,f.path+'/details',payload)).status).toBe(200);expect((await request(f.admin.token,f.path+'/details',payload)).status).toBe(409);
});
