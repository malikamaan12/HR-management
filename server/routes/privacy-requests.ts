import {Router} from 'express';
import {z} from 'zod';
import {and,eq,or,sql} from 'drizzle-orm';
import {employees,activityLogs} from '@shared/schema';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {preparePrivacyExport} from '../services/privacy-export';
import {createHash} from 'node:crypto';
import {privacyCorrectionSchema} from '@shared/privacy';
import {recordHandler as handle,recordHistory,WorkflowError,qatarToday} from '../services/workflowRecords';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const manager=(req:any)=>['super_admin','admin','hr_director','hr','hr_manager'].includes(req.user.role);
const exportManager=(req:any)=>['super_admin','admin'].includes(req.user.role);
const scope=(req:any)=>manager(req)?employeeScope(req.user,'compliance_documents','update'):sql`false`;
const visible=(req:any)=>or(eq(employees.userId,req.user.userId),scope(req))!;
const id=z.coerce.number().int().positive(),note=z.string().trim().min(20).max(4000);
const days=()=>{const n=Number(process.env.PRIVACY_RESPONSE_DAYS||30);return Number.isInteger(n)&&n>=1&&n<=90?n:30;};
router.get('/options',handle(async(req,res)=>{res.json({canManage:manager(req),responseDays:days(),employees:await db.select({id:employees.id,name:sql<string>`${employees.firstName}||' '||${employees.lastName}`}).from(employees).where(visible(req)).orderBy(employees.id).limit(1000)});}));
router.get('/',handle(async(req,res)=>{
 const page=z.coerce.number().int().min(1).max(100000).parse(req.query.page||1);
 const rows=(await db.execute(sql`SELECT p.*,employees.first_name||' '||employees.last_name AS employee_name,employees.user_id AS subject_user_id,(${scope(req)}) AS can_manage,x.sha256 AS export_hash,x.prepared_by AS export_preparer,c.proposed AS proposed_correction,c.prepared_by AS correction_preparer FROM privacy_requests p JOIN employees ON employees.id=p.employee_id LEFT JOIN privacy_access_exports x ON x.request_id=p.id LEFT JOIN privacy_corrections c ON c.request_id=p.id WHERE ${visible(req)} ORDER BY p.id DESC LIMIT 51 OFFSET ${(page-1)*50}`)).rows;
 res.json({hasMore:rows.length>50,items:rows.slice(0,50).map((r:any)=>({...r,subject_user_id:undefined,export_preparer:undefined,
  correction_preparer:undefined,
  canReview:!!r.can_manage&&(!(r.export_hash||r.proposed_correction)||exportManager(req))&&![Number(r.requested_by),Number(r.subject_user_id),Number(r.handled_by),Number(r.export_preparer),Number(r.correction_preparer)].includes(req.user.userId),
  canHandle:!!r.can_manage&&Number(r.subject_user_id)!==req.user.userId,
  canPrepareExport:!!r.can_manage&&exportManager(req)&&Number(r.subject_user_id)!==req.user.userId&&r.kind==='access',
  canPrepareCorrection:!!r.can_manage&&exportManager(req)&&Number(r.subject_user_id)!==req.user.userId&&r.kind==='correction',
  canDownloadExport:!!r.export_hash&&((!!r.can_manage&&exportManager(req)&&Number(r.subject_user_id)!==req.user.userId)||(Number(r.subject_user_id)===req.user.userId&&r.status==='fulfilled')),
  canWithdraw:Number(r.requested_by)===req.user.userId,overdue:['submitted','in_review'].includes(r.status)&&String(r.due_date)<qatarToday()}))});
}));
router.post('/',handle(async(req,res)=>{
 const input=z.object({employeeId:id,kind:z.enum(['access','correction','erasure','restriction']),details:note,submissionKey:z.string().uuid()}).strict().parse(req.body);
 res.status(201).json(await db.transaction(async tx=>{
  const [person]=await tx.select().from(employees).where(and(eq(employees.id,input.employeeId),visible(req))).for('update');if(!person)throw new WorkflowError(404,'Employee not found in your privacy-request scope');
  const prior=(await tx.execute(sql`SELECT * FROM privacy_requests WHERE requested_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];
  if(prior){if(Number(prior.employee_id)!==input.employeeId||prior.kind!==input.kind||prior.details!==input.details)throw new WorkflowError(409,'Submission key was already used for different details');return {id:prior.id};}
  const row=(await tx.execute(sql`INSERT INTO privacy_requests(employee_id,requested_by,kind,details,due_date,submission_key) VALUES(${input.employeeId},${req.user.userId},${input.kind},${input.details},${qatarToday()}::date+${days()}::integer,${input.submissionKey}::uuid) RETURNING *`)).rows[0];
  await recordHistory(tx,req,'privacy_request',row,'Privacy request submitted');return {id:row.id};
 }));
}));
router.get('/:id/export',handle(async(req,res)=>{
 const requestId=id.parse(req.params.id);
 const result=await db.transaction(async tx=>{
  const row=(await tx.execute(sql`SELECT p.status,employees.user_id,(${scope(req)}) AS can_manage,x.content,x.sha256 FROM privacy_requests p JOIN employees ON employees.id=p.employee_id JOIN privacy_access_exports x ON x.request_id=p.id WHERE p.id=${requestId} AND ${visible(req)}`)).rows[0];
  if(!row)throw new WorkflowError(404,'Access export not found');
  const subject=Number(row.user_id)===req.user.userId;
  if(subject?row.status!=='fulfilled':!row.can_manage||!exportManager(req))throw new WorkflowError(403,'Access export requires independent release or scoped administrator review');
  const content=String(row.content);
  if(createHash('sha256').update(content).digest('hex')!==row.sha256)throw new WorkflowError(409,'Export integrity check failed. Contact HR.');
  await tx.insert(activityLogs).values({userId:req.user.userId,action:'view',entityType:'privacy_access_export',entityId:requestId,details:'Downloaded core-record export'});
  return content;
 });
 res.set({'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="personal-data-request-${requestId}.json"`}).send(result);
}));
router.post('/:id/:action',handle(async(req,res)=>{
 const requestId=id.parse(req.params.id),action=z.enum(['start','prepare','prepare-export','prepare-correction','fulfill','reject','withdraw']).parse(req.params.action),input=z.object({version:id,response:note,correction:privacyCorrectionSchema.optional()}).strict().parse(req.body);
 if(action==='prepare-correction'&&!input.correction)throw new WorkflowError(400,'Provide the proposed correction');
 if(action!=='prepare-correction'&&input.correction)throw new WorkflowError(400,'Corrections must be prepared before review');
 res.json(await db.transaction(async tx=>{
  const lookup=(await tx.execute(sql`SELECT p.employee_id FROM privacy_requests p JOIN employees ON employees.id=p.employee_id WHERE p.id=${requestId} AND ${visible(req)}`)).rows[0];if(!lookup)throw new WorkflowError(404,'Privacy request not found');
  const [person]=await tx.select().from(employees).where(and(eq(employees.id,Number(lookup.employee_id)),visible(req))).for('update');if(!person)throw new WorkflowError(404,'Employee access changed');
  const row=(await tx.execute(sql`SELECT * FROM privacy_requests WHERE id=${requestId} FOR UPDATE`)).rows[0];if(Number(row.version)!==input.version)throw new WorkflowError(409,'Request changed. Refresh before continuing.');
  if(!['submitted','in_review'].includes(String(row.status)))throw new WorkflowError(409,'This privacy request is already closed');
  let status=String(row.status),handler=row.handled_by,reviewer=row.reviewed_by,response=input.response;
  let artifact=(await tx.execute(sql`SELECT prepared_by,sha256 FROM privacy_access_exports WHERE request_id=${requestId}`)).rows[0];
  let correction=(await tx.execute(sql`SELECT * FROM privacy_corrections WHERE request_id=${requestId}`)).rows[0];
  if(action==='withdraw'){if(Number(row.requested_by)!==req.user.userId)throw new WorkflowError(403,'Only the requester can withdraw');status='withdrawn';}
  else{
   const [permitted]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,person.id),scope(req)));if(!permitted||person.userId===req.user.userId)throw new WorkflowError(403,'Independent scoped HR access is required');
   if(action==='start'||action==='prepare'||action==='prepare-export'||action==='prepare-correction'){
    if(action==='prepare-export'){
     if(!exportManager(req))throw new WorkflowError(403,'An administrator must prepare cross-module personal data exports');
     if(row.kind!=='access')throw new WorkflowError(409,'Only access requests support a core-record export');
     const output=await preparePrivacyExport(tx,person.id);
     artifact=(await tx.execute(sql`INSERT INTO privacy_access_exports(request_id,prepared_by,content,sha256) VALUES(${requestId},${req.user.userId},${output.content},${output.sha256}) ON CONFLICT(request_id) DO UPDATE SET prepared_by=excluded.prepared_by,prepared_at=now(),content=excluded.content,sha256=excluded.sha256 RETURNING prepared_by,sha256`)).rows[0];
    }
    if(action==='prepare-correction'){
     if(!exportManager(req))throw new WorkflowError(403,'An administrator must prepare profile corrections');
     if(row.kind!=='correction')throw new WorkflowError(409,'Only correction requests support profile changes');
     correction=(await tx.execute(sql`INSERT INTO privacy_corrections(request_id,prepared_by,employee_version,proposed) VALUES(${requestId},${req.user.userId},${person.recordVersion},${JSON.stringify(input.correction)}::jsonb) ON CONFLICT(request_id) DO UPDATE SET prepared_by=excluded.prepared_by,employee_version=excluded.employee_version,proposed=excluded.proposed RETURNING *`)).rows[0];
    }
    status='in_review';handler=req.user.userId;
   }
   else{
    if(!row.handled_by||row.status!=='in_review')throw new WorkflowError(409,'Prepare the response before an independent decision');
    if([Number(row.requested_by),Number(row.handled_by)].includes(req.user.userId))throw new WorkflowError(403,'A different HR reviewer must verify the outcome');
    if(artifact&&(!exportManager(req)||Number(artifact.prepared_by)===req.user.userId))throw new WorkflowError(403,'A different administrator must review and release the access export');
    if(correction&&(!exportManager(req)||Number(correction.prepared_by)===req.user.userId))throw new WorkflowError(403,'A different administrator must verify the profile correction');
    if(action==='fulfill'&&correction){
     if(Number(correction.employee_version)!==person.recordVersion)throw new WorkflowError(409,'The employee profile changed. Prepare the correction again before independent review.');
     const patch=privacyCorrectionSchema.parse(correction.proposed);
     await tx.update(employees).set({...patch,recordVersion:sql`${employees.recordVersion}+1`,updatedAt:new Date()}).where(eq(employees.id,person.id));
     await tx.execute(sql`UPDATE privacy_corrections SET applied_at=now() WHERE request_id=${requestId}`);
     await tx.insert(activityLogs).values({userId:req.user.userId,action:'update',entityType:'employee',entityId:person.id,details:'Applied independently reviewed privacy correction; request '+requestId});
    }
    if(action==='fulfill'&&row.kind==='erasure'&&(await tx.execute(sql`SELECT id FROM hr_retention_holds WHERE employee_id=${person.id} AND active LIMIT 1`)).rows.length)throw new WorkflowError(409,'An active preservation hold blocks erasure fulfilment. Review and resolve the hold through retention governance.');
    status=action==='fulfill'?'fulfilled':'rejected';reviewer=req.user.userId;
    response=String(row.response||'')+'\n\nIndependent decision: '+input.response;
   }
  }
  const saved=(await tx.execute(sql`UPDATE privacy_requests SET status=${status},handled_by=${handler},reviewed_by=${reviewer},response=${response},version=version+1,updated_at=now() WHERE id=${requestId} RETURNING *`)).rows[0];await recordHistory(tx,req,'privacy_request',{...saved,exportHash:artifact?.sha256||null,correctionFields:correction?Object.keys(correction.proposed as object):null,correctionHash:correction?createHash('sha256').update(JSON.stringify(correction.proposed)).digest('hex'):null},action);return {id:requestId};
 }));
}));
export default router;
