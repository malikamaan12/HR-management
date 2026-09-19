import {randomUUID} from 'node:crypto';
import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {reportInput,reportLabels,reportKinds,datedReports,analyticsPolicyInput,savedReportInput,scheduleInput,type ReportKind} from '@shared/reporting';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {reportingPolicy,snapshotCsv} from '../services/reportSnapshots';
import {recordHandler as handle,recordHistory,requireAdmin,isAdmin} from '../services/reportRecords';
import {WorkforceError} from '../services/workforce';
import {activePerson,searchTerm} from '../services/communications';
import {requireReport,saveReport,ownReport,runReportSchedules} from '../services/reportWorkspace';
import {reportEmployeeScope,reportTeamScope} from '../services/reportAccess';
const router=Router();
const id=z.coerce.number().int().positive(),page=z.coerce.number().int().min(1).max(10000).default(1),reason=z.string().trim().min(5).max(1000);
export const reportRunLimiter=rateLimit({windowMs:60000,limit:20,keyGenerator:req=>String(req.user!.userId),standardHeaders:'draft-8',legacyHeaders:false});
const limiter=reportRunLimiter;
const listing=z.object({page,q:z.string().trim().max(100).default(''),kind:z.enum(reportKinds).optional()}).strict();
router.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use((req,res,next)=>void handle(async(req,res)=>{requireReport(req.user);const row=(await db.execute(sql`SELECT u.id FROM users u WHERE u.id=${req.user.userId} AND ${activePerson('u')}`)).rows[0];if(!row)throw new WorkforceError(403,'An active approved account is required');next();})(req,res));
router.get('/catalog',handle(async(req,res)=>res.json({kinds:requireReport(req.user).map(kind=>({kind,label:reportLabels[kind],dated:datedReports.includes(kind)})),canEditPolicy:isAdmin(req),policy:await reportingPolicy(db)})));
router.get('/options',handle(async(req,res)=>{
 const kind=z.enum(reportKinds).parse(req.query.kind);requireReport(req.user,kind);
 if(kind==='workforce'){const teams=(await db.execute(sql`SELECT t.id,t.name,t.site_id AS "siteId",s.name AS "siteName" FROM workforce_teams t JOIN workforce_sites s ON s.id=t.site_id WHERE ${reportTeamScope(req.user)} ORDER BY s.name,t.name LIMIT 1000`)).rows;return res.json({departments:[],teams});}
 const departments=(await db.execute(sql`SELECT DISTINCT e.department FROM employees e WHERE (${reportEmployeeScope(req.user,kind)}) AND e.department<>'' ORDER BY e.department LIMIT 500`)).rows.map(r=>r.department);res.json({departments,teams:[]});
}));
router.get('/policy',handle(async(req,res)=>res.json({...await reportingPolicy(db),canEdit:isAdmin(req)})));
router.post('/policy',handle(async(req,res)=>{
 requireAdmin(req);const input=z.object({version:z.number().int().min(0),turnoverDenominator:z.enum(['opening','average_endpoints']),config:analyticsPolicyInput.optional(),reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE reporting_policies IN SHARE ROW EXCLUSIVE MODE`);const old=await reportingPolicy(tx);if(old.version!==input.version)throw new WorkforceError(409,'Policy changed; reload');
  const r=await tx.execute(sql`INSERT INTO reporting_policies(version,turnover_denominator,config,created_by) VALUES (${old.version+1},${input.turnoverDenominator},${JSON.stringify(input.config||old.config)}::jsonb,${req.user.userId}) RETURNING *`);await recordHistory(tx,req,'reporting_policy',r.rows[0],input.reason);return reportingPolicy(tx);
 });res.status(201).json(saved);
}));
router.get('/policy/history',handle(async(req,res)=>{requireAdmin(req);const p=page.parse(req.query.page);const r=await db.execute(sql`SELECT version,reason,created_at,snapshot FROM report_correction_history WHERE kind='reporting_policy' ORDER BY version DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
router.post('/runs',limiter,handle(async(req,res)=>{const input=reportInput.parse(req.body);const run=await db.transaction(tx=>saveReport(tx,req.user,input),{isolationLevel:'repeatable read'});res.status(201).json(run);}));
router.get('/runs',handle(async(req,res)=>{const kinds=requireReport(req.user),f=listing.parse(req.query),allowed=sql.join(kinds.map(k=>sql`${k}`),sql`,`);const r=await db.execute(sql`SELECT id,report_type,filters,created_at FROM report_runs WHERE owner_id=${req.user.userId} AND report_type IN (${allowed}) AND (${!f.kind} OR report_type=${f.kind||''}) AND (${!f.q} OR report_type ILIKE ${searchTerm(f.q)} OR filters::text ILIKE ${searchTerm(f.q)}) ORDER BY id DESC LIMIT 21 OFFSET ${(f.page-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
router.get('/runs/:id.csv',handle(async(req,res)=>{const run=await db.transaction(tx=>ownReport(tx,req.user,id.parse(req.params.id)),{isolationLevel:'repeatable read'});res.type('text/csv').set('Content-Disposition','attachment; filename="hr-report-'+run.id+'.csv"').send(snapshotCsv(run.snapshot as any));}));
router.get('/runs/:id',handle(async(req,res)=>{const run=await db.transaction(tx=>ownReport(tx,req.user,id.parse(req.params.id)),{isolationLevel:'repeatable read'});res.json({id:run.id,report_type:run.report_type,created_at:run.created_at,snapshot:run.snapshot});}));
router.get('/views',handle(async(req,res)=>{const p=page.parse(req.query.page);const r=await db.execute(sql`SELECT * FROM analytics_views WHERE owner_id=${req.user.userId} AND NOT archived ORDER BY id DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
function validateView(req:any,definition:any){requireReport(req.user,definition.kind);reportInput.parse({kind:definition.kind,filters:definition.filters,comparePrevious:definition.comparePrevious,requestKey:randomUUID()});}
router.post('/views',handle(async(req,res)=>{const definition=savedReportInput.parse(req.body);validateView(req,definition);const row=await db.transaction(async tx=>{const r=(await tx.execute(sql`INSERT INTO analytics_views(owner_id,definition) VALUES (${req.user.userId},${JSON.stringify(definition)}::jsonb) RETURNING *`)).rows[0];await recordHistory(tx,req,'analytics_view',r,'Saved private report view');return r;});res.status(201).json(row);}));
router.patch('/views/:id',handle(async(req,res)=>{const input=z.object({version:id,definition:savedReportInput,reason}).strict().parse(req.body);validateView(req,input.definition);const row=await db.transaction(async tx=>{const r=(await tx.execute(sql`UPDATE analytics_views SET definition=${JSON.stringify(input.definition)}::jsonb,version=version+1,updated_at=now() WHERE id=${id.parse(req.params.id)} AND owner_id=${req.user.userId} AND version=${input.version} AND NOT archived RETURNING *`)).rows[0];if(!r)throw new WorkforceError(409,'View changed or is unavailable; reload');await recordHistory(tx,req,'analytics_view',r,input.reason);return r;});res.json(row);}));
router.post('/views/:id/archive',handle(async(req,res)=>{const input=z.object({version:id,reason}).strict().parse(req.body);await db.transaction(async tx=>{const r=(await tx.execute(sql`UPDATE analytics_views SET archived=true,version=version+1,updated_at=now() WHERE id=${id.parse(req.params.id)} AND owner_id=${req.user.userId} AND version=${input.version} AND NOT archived RETURNING *`)).rows[0];if(!r)throw new WorkforceError(409,'View changed or is unavailable; reload');await recordHistory(tx,req,'analytics_view',r,input.reason);});res.json({archived:true});}));
router.get('/schedules',handle(async(req,res)=>{const p=page.parse(req.query.page);const r=await db.execute(sql`SELECT * FROM analytics_schedules WHERE owner_id=${req.user.userId} ORDER BY id DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
router.post('/schedules/run-due',limiter,handle(async(req,res)=>res.json(await runReportSchedules(new Date(),req.user.userId))));
function validateSchedule(req:any,raw:unknown){const d=scheduleInput.parse(raw);requireReport(req.user,d.kind);const {from,to,...filters}=d.filters;reportInput.parse({kind:d.kind,filters:{...filters,...(datedReports.includes(d.kind)?{from:'2026-01-01',to:'2026-01-01'}:{})},requestKey:randomUUID()});return {...d,filters};}
router.post('/schedules',handle(async(req,res)=>{const d=validateSchedule(req,req.body);const row=await db.transaction(async tx=>{await tx.execute(sql`SELECT id FROM users WHERE id=${req.user.userId} FOR UPDATE`);const count=(await tx.execute(sql`SELECT count(*)::int AS n FROM analytics_schedules WHERE owner_id=${req.user.userId}`)).rows[0];if(Number(count.n)>=30)throw new WorkforceError(400,'Use or update one of your existing 30 schedules');const r=(await tx.execute(sql`INSERT INTO analytics_schedules(owner_id,definition,enabled) VALUES (${req.user.userId},${JSON.stringify(d)}::jsonb,${d.enabled}) RETURNING *`)).rows[0];await recordHistory(tx,req,'analytics_schedule',r,d.reason);return r;});res.status(201).json(row);}));
router.patch('/schedules/:id',handle(async(req,res)=>{const input=z.object({version:id,definition:scheduleInput}).strict().parse(req.body),d=validateSchedule(req,input.definition);const row=await db.transaction(async tx=>{const r=(await tx.execute(sql`UPDATE analytics_schedules SET definition=${JSON.stringify(d)}::jsonb,enabled=${d.enabled},version=version+1,last_attempt_at=NULL,last_error=NULL,updated_at=now() WHERE id=${id.parse(req.params.id)} AND owner_id=${req.user.userId} AND version=${input.version} RETURNING *`)).rows[0];if(!r)throw new WorkforceError(409,'Schedule changed or is unavailable; reload');await recordHistory(tx,req,'analytics_schedule',r,d.reason);return r;});res.json(row);}));
router.get('/schedules/:id/history',handle(async(req,res)=>{const schedule=id.parse(req.params.id),p=page.parse(req.query.page);const owner=(await db.execute(sql`SELECT id FROM analytics_schedules WHERE id=${schedule} AND owner_id=${req.user.userId}`)).rows[0];if(!owner)throw new WorkforceError(404,'Schedule not found');const r=await db.execute(sql`SELECT * FROM analytics_schedule_runs WHERE schedule_id=${schedule} ORDER BY id DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
router.use(handle(async(_req,res)=>res.status(410).json({message:'Use the Reports & Analytics workspace and its saved snapshots. Legacy report definitions and exports are retired.'})));
export default router;
