import {Router} from 'express';
import {z} from 'zod';
import {sql,eq} from 'drizzle-orm';
import {db} from '../db';
import {employees,employeeLifecycleEvents} from '@shared/schema';
import {civilDate} from '@shared/calculation-rules';
import {authenticate} from '../middleware/auth';
import {OnboardingError} from '../services/onboarding-workflow';
import {recordId as id,shortText,decisionReason as reason,isAdmin,managesRecords,requireManager,requireAdmin,recordHandler as handle,recordHistory as history,qatarToday} from '../services/workplaceRecords';

const router=Router();
router.use(authenticate);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const fail=(status:number,message:string):never=>{throw new OnboardingError(status,message);};
const rulesSchema=z.object({maxExtensionDays:z.number().int().min(0).max(365),maxExtensions:z.number().int().min(0).max(10),incidentHours:z.object({low:z.number().int().min(1).max(8760),medium:z.number().int().min(1).max(8760),high:z.number().int().min(1).max(8760)}).strict()}).strict().refine(r=>r.incidentHours.high<=r.incidentHours.medium&&r.incidentHours.medium<=r.incidentHours.low,'Higher severity must have an equal or shorter target');
const defaults={maxExtensionDays:0,maxExtensions:0,incidentHours:{low:168,medium:72,high:24}};
async function policy(tx:any){const r=await tx.execute(sql`SELECT * FROM people_operation_policies ORDER BY version DESC LIMIT 1`);return r.rows[0]||{id:0,version:0,rules:defaults};}
const hrUser=(alias:string)=>sql.raw(`(${alias}.is_active=true AND ${alias}.approval_status='approved' AND ${alias}.role IN ('admin','super_admin','hr_director','hr'))`);
const liveGrant=(team:any,user:any)=>sql`EXISTS(SELECT 1 FROM workforce_grants g WHERE g.team_id=${team} AND g.user_id=${user} AND g.permission='schedule' AND g.revoked_at IS NULL AND g.start_at<=now() AND g.end_at>now())`;
async function employee(tx:any,employeeId:number){const r=await tx.execute(sql`SELECT id,user_id,joining_date,status,record_version,reporting_manager_id,department,position,location FROM employees WHERE id=${employeeId} FOR UPDATE`);return r.rows[0] as any||fail(404,'Employee not found');}
function activeEmployee(e:any,date?:string){if(e.status!=='active'||(date&&date<e.joining_date))fail(400,'Choose an active employee and a date on or after joining');}
async function reviewerEligible(tx:any,reviewerId:number,e:any){
 const r=await tx.execute(sql`SELECT u.id FROM users u LEFT JOIN employees m ON m.user_id=u.id WHERE u.id=${reviewerId} AND u.is_active=true AND u.approval_status='approved' AND (${hrUser('u')} OR (m.id=${e.reporting_manager_id} AND m.status='active'))`);
 if(!r.rows.length||reviewerId===e.user_id)fail(400,'Reviewer must be an active HR manager or the employee’s current reporting manager, and cannot review themselves');
}
const kinds=z.enum(['probation','transfers','incidents']);
type Kind=z.infer<typeof kinds>;
const tables={probation:'probation_reviews',transfers:'employee_transfers',incidents:'operational_incidents'};
const historyKind=(kind:Kind)=>'people_'+kind;
function scope(req:any,kind:Kind){
 if(managesRecords(req))return sql`true`;
 const uid=req.user.userId;
 if(kind==='incidents')return sql`(r.reporter_id=${uid} OR (r.handler_id=${uid} AND ${liveGrant(sql`r.team_id`,uid)}))`;
 if(kind==='transfers')return sql`(e.user_id=${uid} AND r.status IN ('approved','applied'))`;
 return sql`((e.user_id=${uid} AND r.status IN ('confirmed','follow_up')) OR (r.reviewer_id=${uid} AND EXISTS(SELECT 1 FROM employees m WHERE m.user_id=${uid} AND m.id=e.reporting_manager_id AND m.status='active')))`;
}
async function visible(tx:any,req:any,kind:Kind,recordId:number){const join=kind==='incidents'?sql``:sql`JOIN employees e ON e.id=r.employee_id`;const r=await tx.execute(sql`SELECT r.* FROM ${sql.raw(tables[kind])} r ${join} WHERE r.id=${recordId} AND ${scope(req,kind)}`);return r.rows[0] as any||fail(404,'Record not found');}
router.get('/config',handle(async(req,res)=>res.json({canManage:managesRecords(req),canConfigure:isAdmin(req),policy:await policy(db)})));
router.post('/policy',handle(async(req,res)=>{
 requireAdmin(req);const input=z.object({version:z.number().int().min(0),rules:rulesSchema,reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE people_operation_policies IN SHARE ROW EXCLUSIVE MODE`);const old=await policy(tx);if(old.version!==input.version)fail(409,'Policy changed; reload');const r=await tx.execute(sql`INSERT INTO people_operation_policies(version,rules,created_by) VALUES (${old.version+1},${JSON.stringify(input.rules)}::jsonb,${req.user.userId}) RETURNING *`);await history(tx,req,'people_policy',r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.get('/policy-history',handle(async(req,res)=>{requireAdmin(req);const r=await db.execute(sql`SELECT version,reason,created_at,snapshot FROM lifecycle_history WHERE kind='people_policy' ORDER BY id DESC LIMIT 100`);res.json(r.rows);}));
router.get('/people',handle(async(req,res)=>{requireManager(req);const q=z.string().trim().min(2).max(100).parse(req.query.q);const r=await db.execute(sql`SELECT id,user_id,employee_id,first_name||' '||last_name AS name,department,position,location,reporting_manager_id,record_version,joining_date FROM employees WHERE status='active' AND strpos(lower(first_name||' '||last_name||' '||employee_id),lower(${q}))>0 ORDER BY id LIMIT 25`);res.json(r.rows);}));
router.get('/reviewers',handle(async(req,res)=>{requireManager(req);const employeeId=id.parse(Number(req.query.employeeId));const r=await db.execute(sql`SELECT DISTINCT u.id,u.first_name||' '||u.last_name AS name FROM users u LEFT JOIN employees m ON m.user_id=u.id JOIN employees e ON e.id=${employeeId} WHERE u.is_active=true AND u.approval_status='approved' AND u.id IS DISTINCT FROM e.user_id AND (${hrUser('u')} OR (m.id=e.reporting_manager_id AND m.status='active')) ORDER BY u.id LIMIT 100`);res.json(r.rows);}));
router.get('/teams',handle(async(req,res)=>{const r=await db.execute(sql`SELECT t.id,t.name,t.kind FROM workforce_teams t WHERE ${managesRecords(req)?sql`true`:sql`${liveGrant(sql`t.id`,req.user.userId)} OR EXISTS(SELECT 1 FROM workforce_members m JOIN employees e ON e.id=m.employee_id WHERE m.team_id=t.id AND e.user_id=${req.user.userId} AND e.status='active' AND m.start_at<=now() AND m.end_at>now())`} ORDER BY t.name LIMIT 200`);res.json(r.rows);}));
router.get('/handlers',handle(async(req,res)=>{requireManager(req);const teamId=id.nullable().parse(req.query.teamId?Number(req.query.teamId):null);const r=await db.execute(sql`SELECT u.id,u.first_name||' '||u.last_name AS name FROM users u WHERE u.is_active=true AND u.approval_status='approved' AND (${hrUser('u')} OR ${liveGrant(teamId,sql`u.id`)}) ORDER BY u.id LIMIT 100`);res.json(r.rows);}));
router.get('/:kind',handle(async(req,res)=>{
 const kind=kinds.parse(req.params.kind),page=z.coerce.number().int().min(1).default(1).parse(req.query.page),status=z.string().max(30).default('').parse(req.query.status);
 const r=await db.execute(sql`SELECT r.* ${kind==='incidents'?sql`,t.name AS team_name`:sql`,e.first_name||' '||e.last_name AS employee_name,e.user_id AS employee_user_id`} FROM ${sql.raw(tables[kind])} r ${kind==='incidents'?sql`LEFT JOIN workforce_teams t ON t.id=r.team_id`:sql`JOIN employees e ON e.id=r.employee_id`} WHERE ${scope(req,kind)} AND (${status}='' OR r.status=${status}) ORDER BY r.id DESC LIMIT 25 OFFSET ${(page-1)*25}`);
 res.json({items:r.rows.map((r:any)=>({...r,isMine:kind==='incidents'?r.reporter_id===req.user.userId:r.employee_user_id===req.user.userId,isReviewer:r.reviewer_id===req.user.userId,isHandler:r.handler_id===req.user.userId,canDecide:managesRecords(req)&&r.employee_user_id!==req.user.userId&&r.reviewer_id!==req.user.userId,canApprove:managesRecords(req)&&r.employee_user_id!==req.user.userId&&r.created_by!==req.user.userId,canApply:managesRecords(req)&&r.employee_user_id!==req.user.userId,canClose:managesRecords(req)&&r.reporter_id!==req.user.userId&&r.handler_id!==req.user.userId}))});
}));
router.get('/:kind/:id/history',handle(async(req,res)=>{const kind=kinds.parse(req.params.kind),recordId=id.parse(Number(req.params.id));const row=await visible(db,req,kind,recordId);if(kind!=='incidents'&&!managesRecords(req)){const own=await db.execute(sql`SELECT id FROM employees WHERE id=${row.employee_id} AND user_id=${req.user.userId}`);if(own.rows.length)fail(403,'Internal review history is available to HR and the assigned reviewer; your published decision is shown on the record');}const r=await db.execute(sql`SELECT version,reason,created_at,snapshot FROM lifecycle_history WHERE kind=${historyKind(kind)} AND record_id=${recordId} ORDER BY version DESC LIMIT 100`);res.json(r.rows);}));

router.post('/probation',handle(async(req,res)=>{
 requireManager(req);const input=z.object({employeeId:id,reviewerId:id,startDate:civilDate,dueDate:civilDate,objectives:reason,reason}).strict().parse(req.body);
 if(input.dueDate<input.startDate)fail(400,'Review due date must be on or after the start date');
 const saved=await db.transaction(async tx=>{const e=await employee(tx,input.employeeId);activeEmployee(e,input.startDate);if(e.user_id===req.user.userId)fail(403,'Another HR manager must open your probation review');await reviewerEligible(tx,input.reviewerId,e);const p=await policy(tx);const r=await tx.execute(sql`INSERT INTO probation_reviews(employee_id,reviewer_id,start_date,due_date,objectives,policy_snapshot,created_by) VALUES (${e.id},${input.reviewerId},${input.startDate},${input.dueDate},${input.objectives},${JSON.stringify(p)}::jsonb,${req.user.userId}) RETURNING *`);await history(tx,req,historyKind('probation'),r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.post('/probation/:id/actions',handle(async(req,res)=>{
 const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,action:z.enum(['review','confirm','extend','follow_up','return','cancel','reassign','acknowledge']),reason,recommendation:z.enum(['confirm','extend','follow_up']).optional(),dueDate:civilDate.optional(),reviewerId:id.optional()}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{
 const lookup=await tx.execute(sql`SELECT employee_id FROM probation_reviews WHERE id=${recordId}`);if(!lookup.rows.length)fail(404,'Record not found');const e=await employee(tx,Number(lookup.rows[0].employee_id));const old=await visible(tx,req,'probation',recordId);await tx.execute(sql`SELECT id FROM probation_reviews WHERE id=${recordId} FOR UPDATE`);if(old.version!==input.version)fail(409,'Review changed; reload');const mine=e.user_id===req.user.userId;
 let r;
 if(input.action==='acknowledge'){
  if(!mine||!['confirmed','follow_up'].includes(old.status))fail(403,'Only the employee can acknowledge their published decision');if(old.acknowledged_at)fail(409,'Decision already acknowledged');r=await tx.execute(sql`UPDATE probation_reviews SET acknowledged_at=now(),employee_response=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);
 }else if(input.action==='review'){
  if(old.reviewer_id!==req.user.userId||mine)fail(403,'Assigned independent reviewer access required');activeEmployee(e);await reviewerEligible(tx,req.user.userId,e);if(old.status!=='open')fail(409,'Only an open review can be submitted');if(!input.recommendation||qatarToday()<old.start_date)fail(400,'Choose a recommendation after the review period starts');r=await tx.execute(sql`UPDATE probation_reviews SET status='submitted',recommendation=${input.recommendation},review_evidence=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);
 }else{
  requireManager(req);if(mine)fail(403,'Another HR manager must manage your review');if(!['open','submitted'].includes(old.status))fail(409,'Review is finalized');
  if(input.action==='cancel'){r=await tx.execute(sql`UPDATE probation_reviews SET status='cancelled',decision_reason=${input.reason},decided_by=${req.user.userId},version=version+1 WHERE id=${recordId} RETURNING *`);}
  else if(input.action==='reassign'){if(!input.reviewerId)fail(400,'Choose a reviewer');await reviewerEligible(tx,input.reviewerId!,e);r=await tx.execute(sql`UPDATE probation_reviews SET reviewer_id=${input.reviewerId},status='open',recommendation=NULL,review_evidence=NULL,version=version+1 WHERE id=${recordId} RETURNING *`);}
  else{
   if(old.reviewer_id===req.user.userId)fail(403,'An independent HR manager must decide this review');activeEmployee(e);if(old.status!=='submitted')fail(409,'Submit reviewer evidence before an HR decision');
   if(input.action==='return'){r=await tx.execute(sql`UPDATE probation_reviews SET status='open',recommendation=NULL,review_evidence=NULL,decision_reason=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);}
   else if(input.action==='extend'){
    const rules=rulesSchema.parse(old.policy_snapshot.rules),days=input.dueDate?(Date.parse(input.dueDate)-Date.parse(old.due_date))/86400000:0;
    if(!input.dueDate||input.dueDate<=qatarToday()||days<=0||days>rules.maxExtensionDays||old.extension_count>=rules.maxExtensions)fail(400,'Extension exceeds the saved policy or does not set a future due date');
    r=await tx.execute(sql`UPDATE probation_reviews SET status='open',due_date=${input.dueDate},extension_count=extension_count+1,recommendation=NULL,review_evidence=NULL,decision_reason=${input.reason},decided_by=${req.user.userId},version=version+1 WHERE id=${recordId} RETURNING *`);
   }else{
    r=await tx.execute(sql`UPDATE probation_reviews SET status=${input.action==='confirm'?'confirmed':'follow_up'},decision_reason=${input.reason},decided_by=${req.user.userId},version=version+1 WHERE id=${recordId} RETURNING *`);
    if(input.action==='confirm')await tx.insert(employeeLifecycleEvents).values({employeeId:e.id,eventType:'probation_completed',effectiveDate:qatarToday(),reason:input.reason,metadata:{probationReviewId:recordId},createdBy:req.user.userId});
   }
  }
 }
 await history(tx,req,historyKind('probation'),r!.rows[0],input.reason);return r!.rows[0];});res.json(saved);
}));

const transferFields=z.object({department:shortText,position:shortText,location:shortText,reportingManagerId:id.nullable()}).strict();
const professional=(e:any)=>({department:e.department,position:e.position,location:e.location,reportingManagerId:e.reporting_manager_id});
async function validateManager(tx:any,employeeId:number,managerId:number|null){
 if(managerId===null)return;const r=await tx.execute(sql`SELECT id,status,reporting_manager_id,secondary_manager_id FROM employees`);const byId=new Map<number,any>(r.rows.map((e:any)=>[e.id,e]));if(byId.get(managerId)?.status!=='active')fail(400,'Choose an active reporting manager');const pending=[managerId],seen=new Set<number>();while(pending.length){const next=pending.pop()!;if(next===employeeId)fail(400,'Transfer would create a reporting cycle');if(seen.has(next))continue;seen.add(next);const e=byId.get(next);for(const parent of [e?.reporting_manager_id,e?.secondary_manager_id])if(parent)pending.push(parent);}
}
router.post('/transfers',handle(async(req,res)=>{
 requireManager(req);const input=z.object({employeeId:id,employeeVersion:id,target:transferFields,effectiveDate:civilDate,reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);const e=await employee(tx,input.employeeId);activeEmployee(e,input.effectiveDate);if(e.user_id===req.user.userId)fail(403,'Another HR manager must propose your transfer');if(e.record_version!==input.employeeVersion)fail(409,'Employee changed; select the employee again');await validateManager(tx,e.id,input.target.reportingManagerId);if(JSON.stringify(professional(e))===JSON.stringify(input.target))fail(400,'Specify at least one change');const r=await tx.execute(sql`INSERT INTO employee_transfers(employee_id,employee_version,from_snapshot,to_snapshot,effective_date,proposal_reason,created_by) VALUES (${e.id},${e.record_version},${JSON.stringify(professional(e))}::jsonb,${JSON.stringify(input.target)}::jsonb,${input.effectiveDate},${input.reason},${req.user.userId}) RETURNING *`);await history(tx,req,historyKind('transfers'),r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.post('/transfers/:id/actions',handle(async(req,res)=>{
 requireManager(req);const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,action:z.enum(['approve','reject','cancel','apply']),reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);const rows=await tx.execute(sql`SELECT * FROM employee_transfers WHERE id=${recordId} FOR UPDATE`);const old=rows.rows[0] as any;if(!old)fail(404,'Transfer not found');const e=await employee(tx,old.employee_id);if(e.user_id===req.user.userId)fail(403,'Another HR manager must handle your transfer');if(old.version!==input.version)fail(409,'Transfer changed; reload');let r;
 if(input.action==='cancel'){if(!['submitted','approved'].includes(old.status))fail(409,'Only a pending transfer can be cancelled');r=await tx.execute(sql`UPDATE employee_transfers SET status='cancelled',decision_reason=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);}
 else if(input.action==='apply'){
  if(old.status!=='approved')fail(409,'Approve the transfer before applying it');activeEmployee(e,old.effective_date);if(old.effective_date>qatarToday())fail(400,'Apply on or after the effective date');if(e.record_version!==old.employee_version)fail(409,'Employee changed since proposal; cancel and submit a fresh transfer');
  const target=transferFields.parse(old.to_snapshot);await validateManager(tx,e.id,target.reportingManagerId);
  await tx.update(employees).set({...target,updatedAt:new Date()}).where(eq(employees.id,e.id));
  await tx.insert(employeeLifecycleEvents).values({employeeId:e.id,eventType:'transfer',effectiveDate:old.effective_date,reason:input.reason,metadata:{transferId:recordId,from:old.from_snapshot,to:old.to_snapshot},createdBy:req.user.userId});
  r=await tx.execute(sql`UPDATE employee_transfers SET status='applied',applied_by=${req.user.userId},applied_at=now(),decision_reason=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);
 }else{
  if(old.status!=='submitted')fail(409,'Only a submitted transfer can be decided');if(old.created_by===req.user.userId)fail(403,'An independent HR manager must decide this proposal');
  if(input.action==='approve'){activeEmployee(e,old.effective_date);if(e.record_version!==old.employee_version)fail(409,'Employee changed since proposal; cancel and submit a fresh transfer');await validateManager(tx,e.id,old.to_snapshot.reportingManagerId);}
  r=await tx.execute(sql`UPDATE employee_transfers SET status=${input.action==='approve'?'approved':'rejected'},approved_by=${input.action==='approve'?req.user.userId:null},approved_at=${input.action==='approve'?sql`now()`:sql`NULL`},decision_reason=${input.reason},version=version+1 WHERE id=${recordId} RETURNING *`);
 }
 await history(tx,req,historyKind('transfers'),r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));

router.post('/incidents',handle(async(req,res)=>{
 const input=z.object({teamId:id.nullable(),title:shortText,location:shortText,occurredAt:z.string().datetime({offset:true}),category:z.enum(['equipment','service','attendance','site_operations','other']),severity:z.enum(['low','medium','high']),description:reason}).strict().parse(req.body);
 if(Date.parse(input.occurredAt)>Date.now())fail(400,'Incident occurrence cannot be in the future');
 const saved=await db.transaction(async tx=>{
  if(input.teamId){const r=await tx.execute(sql`SELECT t.id FROM workforce_teams t WHERE t.id=${input.teamId} AND ${managesRecords(req)?sql`true`:sql`${liveGrant(input.teamId,req.user.userId)} OR EXISTS(SELECT 1 FROM workforce_members m JOIN employees e ON e.id=m.employee_id WHERE m.team_id=t.id AND e.user_id=${req.user.userId} AND e.status='active' AND m.start_at<=now() AND m.end_at>now())`}`);if(!r.rows.length)fail(403,'Choose one of your current teams');}
  const p=await policy(tx);const dueAt=new Date(Date.now()+p.rules.incidentHours[input.severity]*3600000);const r=await tx.execute(sql`INSERT INTO operational_incidents(reporter_id,team_id,title,location,occurred_at,category,severity,description,due_at,policy_snapshot) VALUES (${req.user.userId},${input.teamId},${input.title},${input.location},${input.occurredAt},${input.category},${input.severity},${input.description},${dueAt},${JSON.stringify(p)}::jsonb) RETURNING *`);await history(tx,req,historyKind('incidents'),r.rows[0],'Incident reported');return r.rows[0];});res.status(201).json(saved);
}));
router.post('/incidents/:id/actions',handle(async(req,res)=>{
 const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,action:z.enum(['assign','resolve','close','reopen']),reason,handlerId:id.optional(),correctiveAction:reason.optional()}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{await tx.execute(sql`SELECT id FROM operational_incidents WHERE id=${recordId} FOR UPDATE`);const old=await visible(tx,req,'incidents',recordId);if(old.version!==input.version)fail(409,'Incident changed; reload');let r;
 if(input.action==='assign'){
  requireManager(req);if(!['open','in_progress'].includes(old.status))fail(409,'Reopen the incident before reassignment');if(!input.handlerId||!input.correctiveAction)fail(400,'Choose a handler and record the corrective action');
  const eligible=await tx.execute(sql`SELECT u.id FROM users u WHERE u.id=${input.handlerId} AND u.is_active=true AND u.approval_status='approved' AND (${hrUser('u')} OR ${liveGrant(old.team_id,input.handlerId)})`);if(!eligible.rows.length)fail(400,'Choose an active HR manager or current team scheduling lead');
  r=await tx.execute(sql`UPDATE operational_incidents SET handler_id=${input.handlerId},corrective_action=${input.correctiveAction},status='in_progress',version=version+1 WHERE id=${recordId} RETURNING *`);
 }else if(input.action==='resolve'){
  if(old.handler_id!==req.user.userId)fail(403,'Only the current assigned handler can resolve the incident');if(old.status!=='in_progress')fail(409,'Assign the incident before resolution');r=await tx.execute(sql`UPDATE operational_incidents SET status='resolved',resolution=${input.reason},resolved_at=now(),version=version+1 WHERE id=${recordId} RETURNING *`);
 }else if(input.action==='close'){
  requireManager(req);if(old.handler_id===req.user.userId||old.reporter_id===req.user.userId)fail(403,'An independent HR manager must verify closure');if(old.status!=='resolved')fail(409,'Resolve the corrective action before closure');r=await tx.execute(sql`UPDATE operational_incidents SET status='closed',closed_by=${req.user.userId},version=version+1 WHERE id=${recordId} RETURNING *`);
 }else{
  requireManager(req);if(!['resolved','closed'].includes(old.status))fail(409,'Only resolved or closed incidents can reopen');r=await tx.execute(sql`UPDATE operational_incidents SET status='open',handler_id=NULL,corrective_action=NULL,resolution=NULL,resolved_at=NULL,closed_by=NULL,version=version+1 WHERE id=${recordId} RETURNING *`);
 }
 await history(tx,req,historyKind('incidents'),r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));
export default router;
