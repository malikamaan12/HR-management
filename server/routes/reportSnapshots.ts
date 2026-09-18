import {isDeepStrictEqual} from 'node:util';
import {Router} from 'express';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {activityLogs} from '@shared/schema';
import {reportInput,reportLabels,type ReportKind} from '@shared/reporting';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {availableReports,buildReport,reportingPolicy,snapshotCsv} from '../services/reportSnapshots';
import {recordHandler as handle,recordHistory,requireAdmin,isAdmin} from '../services/reportRecords';
import {WorkforceError as OnboardingError} from '../services/workforce';
const router=Router();
const id=z.coerce.number().int().positive(),page=z.coerce.number().int().min(1).max(10000).default(1);
router.use(authenticate,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
function access(req:any,kind?:ReportKind){const kinds=availableReports(req.user.role);if(!kinds.length||(kind&&!kinds.includes(kind)))throw new OnboardingError(403,'Report and source-module access required');return kinds;}
router.get('/catalog',handle(async(req,res)=>{res.json({kinds:access(req).map(kind=>({kind,label:reportLabels[kind]})),canEditPolicy:isAdmin(req)});}));
router.get('/policy',handle(async(req,res)=>{access(req);res.json({...await reportingPolicy(db),canEdit:isAdmin(req)});}));
router.post('/policy',handle(async(req,res)=>{
 requireAdmin(req);const input=z.object({version:z.number().int().min(0),turnoverDenominator:z.enum(['opening','average_endpoints']),reason:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE reporting_policies IN SHARE ROW EXCLUSIVE MODE`);const old=await reportingPolicy(tx);if(old.version!==input.version)throw new OnboardingError(409,'Policy changed; reload');
  const r=await tx.execute(sql`INSERT INTO reporting_policies(version,turnover_denominator,created_by) VALUES (${old.version+1},${input.turnoverDenominator},${req.user.userId}) RETURNING *`);await recordHistory(tx,req,'reporting_policy',r.rows[0],input.reason);return reportingPolicy(tx);
 });res.status(201).json(saved);
}));
router.get('/policy/history',handle(async(req,res)=>{requireAdmin(req);const p=page.parse(req.query.page);const r=await db.execute(sql`SELECT version,reason,created_at,snapshot FROM report_correction_history WHERE kind='reporting_policy' ORDER BY version DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
router.post('/runs',handle(async(req,res)=>{
 const input=reportInput.parse(req.body);access(req,input.kind);
 const run=await db.transaction(async tx=>{
  const old=await tx.execute(sql`SELECT * FROM report_runs WHERE owner_id=${req.user.userId} AND request_key=${input.requestKey}`);
  if(old.rows.length){const row=old.rows[0];if(row.report_type!==input.kind||!isDeepStrictEqual((row.snapshot as any).filters,input.filters))throw new OnboardingError(409,'This request key belongs to a different report');return row;}
  const snapshot=await buildReport(tx,input);
  const r=await tx.execute(sql`INSERT INTO report_runs(owner_id,request_key,report_type,filters,snapshot) VALUES (${req.user.userId},${input.requestKey},${input.kind},${JSON.stringify(input.filters)}::jsonb,${JSON.stringify(snapshot)}::jsonb) RETURNING id,report_type,created_at,snapshot`);
  await tx.insert(activityLogs).values({userId:req.user.userId,action:'create',entityType:'report_run',entityId:Number(r.rows[0].id),details:'Generated '+input.kind+' snapshot'});return r.rows[0];
 },{isolationLevel:'repeatable read'});res.status(201).json(run);
}));
router.get('/runs',handle(async(req,res)=>{const kinds=access(req),p=page.parse(req.query.page);const allowed=sql.join(kinds.map(k=>sql`${k}`),sql`,`);const r=await db.execute(sql`SELECT id,report_type,filters,created_at FROM report_runs WHERE owner_id=${req.user.userId} AND report_type IN (${allowed}) ORDER BY id DESC LIMIT 21 OFFSET ${(p-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});}));
async function ownRun(req:any){access(req);const r=await db.execute(sql`SELECT id,report_type,created_at,snapshot FROM report_runs WHERE id=${id.parse(req.params.id)} AND owner_id=${req.user.userId}`);if(!r.rows.length)throw new OnboardingError(404,'Report not found');access(req,r.rows[0].report_type as ReportKind);return r.rows[0];}
router.get('/runs/:id.csv',handle(async(req,res)=>{const run=await ownRun(req);res.type('text/csv').set('Content-Disposition','attachment; filename="hr-report-'+run.id+'.csv"').send(snapshotCsv(run.snapshot as any));}));
router.get('/runs/:id',handle(async(req,res)=>{res.json(await ownRun(req));}));
// Historical definitions remain in the database. Their unrestricted CRUD and
// live-query exports are retired; snapshots are the supported reporting flow.
router.use(handle(async(req,res)=>{access(req);res.status(410).json({message:'Use Reports to generate a saved snapshot. Legacy report definitions, schedules and exports are retired.'});}));
export default router;
