import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { documents, employees } from '@shared/schema';
import { positiveId, reason } from '@shared/hr-rules';
import { retentionPolicyInput, retentionHoldInput, retentionRequestInput, retentionDecisionInput, retentionListInput, retentionReviewInput } from '@shared/retention';
import { db } from '../db';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { recordHandler as handle, recordHistory, requireAdmin, isAdmin, WorkflowError, qatarToday } from '../services/workflowRecords';
import { requireRetentionManager, retentionState } from '../services/retention';

const router = Router();
router.use(authenticate);
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.use((req,res,next) => { try { requireRetentionManager(req); next(); } catch { res.status(403).json({message:'HR retention access required'}); } });

async function employeeFor(tx:any, req:any, id:number, lock=false) {
  let query=tx.select().from(employees).where(and(eq(employees.id,id),employeeScope(req.user,'compliance_documents','update')));
  const [employee]=await (lock?query.for('update'):query);
  if(!employee) throw new WorkflowError(404,'Employee not found in your retention scope');
  return employee;
}
async function documentFor(tx:any, req:any, id:number) {
  const [lookup]=await tx.select({employeeId:documents.employeeId}).from(documents).where(eq(documents.id,id));
  if(!lookup) throw new WorkflowError(404,'Document not found');
  const employee=await employeeFor(tx,req,lookup.employeeId,true);
  const [document]=await tx.select().from(documents).where(eq(documents.id,id)).for('update');
  if(!document||document.employeeId!==employee.id)throw new WorkflowError(409,'Document changed; reload');
  await tx.execute(sql`LOCK TABLE hr_retention_policies IN SHARE MODE`);
  return {employee,document,state:await retentionState(tx,document,employee)};
}
router.get('/options',handle(async(req,res)=>{
  res.json({canEditPolicy:isAdmin(req),today:qatarToday(),employees:await db.select({id:employees.id,name:sql<string>`${employees.firstName}||' '||${employees.lastName}`}).from(employees).where(employeeScope(req.user,'compliance_documents','update')).orderBy(employees.firstName,employees.id)});
}));
router.get('/policies',handle(async(_req,res)=>res.json((await db.execute(sql`SELECT * FROM hr_retention_policies ORDER BY document_type`)).rows)));
router.post('/policies',handle(async(req,res)=>{
  requireAdmin(req);const input=retentionPolicyInput.parse(req.body);
  const row=await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE hr_retention_policies IN SHARE ROW EXCLUSIVE MODE`);
    const old=(await tx.execute(sql`SELECT * FROM hr_retention_policies WHERE document_type=${input.documentType}`)).rows[0];
    if(Number(old?.version||0)!==input.version)throw new WorkflowError(409,'Policy changed; reload before saving');
    const saved=(await tx.execute(sql`INSERT INTO hr_retention_policies(document_type,version,enabled,anchor,retention_days,review_days,updated_by)
      VALUES (${input.documentType},1,${input.enabled},${input.anchor},${input.retentionDays},${input.reviewDays},${req.user.userId})
      ON CONFLICT(document_type) DO UPDATE SET version=hr_retention_policies.version+1,enabled=excluded.enabled,anchor=excluded.anchor,
      retention_days=excluded.retention_days,review_days=excluded.review_days,updated_by=excluded.updated_by,updated_at=now() RETURNING *`)).rows[0];
    await recordHistory(tx,req,'retention_policy',saved,input.reason);return saved;
  });res.json(row);
}));
router.get('/documents',handle(async(req,res)=>{
  const input=retentionListInput.parse(req.query),today=qatarToday();
  const retained=sql`CASE WHEN p.anchor='employment_end' THEN CASE WHEN employees.status='inactive' THEN employees.termination_date + p.retention_days END ELSE documents.expiry_date + p.retention_days END`;
  const held=sql`EXISTS(SELECT 1 FROM hr_retention_holds h WHERE h.active AND h.employee_id=employees.id AND (h.document_id IS NULL OR h.document_id=documents.id))`;
  const pending=sql`EXISTS(SELECT 1 FROM document_renewal_requests r WHERE r.document_id=documents.id AND r.status='pending')`;
  const eligible=sql`coalesce(p.enabled AND ${retained}<=${today}::date AND NOT ${held} AND NOT ${pending} AND NOT coalesce(a.archived,false),false)`;
  const rows=(await db.execute(sql`SELECT documents.id,documents.document_type,documents.expiry_date,employees.first_name||' '||employees.last_name AS employee_name,
    employees.id AS employee_id,coalesce(a.archived,false) AS archived,${held} AS held,${pending} AS pending_renewal,${retained}::text AS retain_until,
    p.document_type AS policy_type,p.version AS policy_version,${eligible} AS eligible,
    EXISTS(SELECT 1 FROM hr_retention_requests r WHERE r.document_id=documents.id AND r.status='pending') AS pending_request
    FROM documents JOIN employees ON employees.id=documents.employee_id
    LEFT JOIN LATERAL(SELECT * FROM hr_retention_policies WHERE document_type IN (documents.document_type,'*') ORDER BY(document_type=documents.document_type) DESC LIMIT 1)p ON true
    LEFT JOIN hr_document_archives a ON a.document_id=documents.id
    WHERE ${employeeScope(req.user,'compliance_documents','update')}
      AND (${input.q}='' OR strpos(lower(employees.first_name||' '||employees.last_name||' '||documents.document_type),lower(${input.q}))>0)
      AND ${input.view==='eligible'?eligible:input.view==='archived'?sql`a.archived`:input.view==='held'?held:sql`true`}
    ORDER BY documents.id DESC LIMIT 51 OFFSET ${input.offset}`)).rows;
  res.json({items:rows.slice(0,50),hasMore:rows.length>50});
}));
router.get('/holds',handle(async(req,res)=>{
  const {offset,active}=z.object({offset:z.coerce.number().int().min(0).default(0),active:z.enum(['all','active','released']).default('active')}).strict().parse(req.query);
  const rows=(await db.execute(sql`SELECT h.*,employees.first_name||' '||employees.last_name AS employee_name,documents.document_type FROM hr_retention_holds h JOIN employees ON employees.id=h.employee_id LEFT JOIN documents ON documents.id=h.document_id
    WHERE ${employeeScope(req.user,'compliance_documents','update')} AND ${active==='all'?sql`true`:sql`h.active=${active==='active'}`} ORDER BY h.id DESC LIMIT 51 OFFSET ${offset}`)).rows;
  res.json({items:rows.slice(0,50),hasMore:rows.length>50});
}));
router.post('/holds',handle(async(req,res)=>{
  const input=retentionHoldInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    await employeeFor(tx,req,input.employeeId,true);
    if(input.documentId){const [doc]=await tx.select().from(documents).where(and(eq(documents.id,input.documentId),eq(documents.employeeId,input.employeeId))).for('update');if(!doc)throw new WorkflowError(404,'Choose a document belonging to this employee');}
    const row=(await tx.execute(sql`INSERT INTO hr_retention_holds(employee_id,document_id,reason,created_by) VALUES (${input.employeeId},${input.documentId},${input.reason},${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'retention_hold',row,input.reason);return row;
  }));
}));
router.post('/holds/:id/release',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const old=(await tx.execute(sql`SELECT * FROM hr_retention_holds WHERE id=${id}`)).rows[0];if(!old)throw new WorkflowError(404,'Hold not found');
    await employeeFor(tx,req,Number(old.employee_id),true);
    const row=(await tx.execute(sql`UPDATE hr_retention_holds SET active=false,version=version+1,released_by=${req.user.userId},released_at=now(),release_reason=${input.reason} WHERE id=${id} AND version=${input.version} AND active RETURNING *`)).rows[0];
    if(!row)throw new WorkflowError(409,'Hold changed or already released; reload');
    await recordHistory(tx,req,'retention_hold',row,input.reason);return row;
  }));
}));
router.get('/requests',handle(async(req,res)=>{
  const input=retentionReviewInput.parse(req.query);
  const rows=(await db.execute(sql`SELECT r.*,r.review_due_date::text AS review_due_date,employees.first_name||' '||employees.last_name AS employee_name,documents.document_type,
    r.requested_by<>${req.user.userId} AND (employees.user_id IS NULL OR employees.user_id<>${req.user.userId}) AS independent
    FROM hr_retention_requests r JOIN employees ON employees.id=r.employee_id JOIN documents ON documents.id=r.document_id
    WHERE ${employeeScope(req.user,'compliance_documents','update')} AND ${input.status==='all'?sql`true`:sql`r.status=${input.status}`} ORDER BY r.id DESC LIMIT 51 OFFSET ${input.offset}`)).rows;
  res.json({items:rows.slice(0,50).map((r:any)=>({...r,canReview:r.independent&&r.status==='pending',canWithdraw:r.requested_by===req.user.userId&&r.status==='pending',overdue:r.status==='pending'&&String(r.review_due_date).slice(0,10)<qatarToday()})),hasMore:rows.length>50});
}));
router.post('/requests',handle(async(req,res)=>{
  const input=retentionRequestInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const {document,employee,state}=await documentFor(tx,req,input.documentId);
    if(input.action==='archive'&&!state.eligible)throw new WorkflowError(409,'Archiving requires an enabled policy, elapsed retention, no active hold or pending renewal, and an unarchived document');
    if(input.action==='restore'&&!state.archived)throw new WorkflowError(409,'This document is already active');
    const due=new Date(Date.parse(qatarToday())+Number(state.policy?.review_days||7)*86400000).toISOString().slice(0,10);
    const row=(await tx.execute(sql`INSERT INTO hr_retention_requests(document_id,employee_id,action,requested_by,reason,document_snapshot,policy_snapshot,review_due_date)
      VALUES (${document.id},${employee.id},${input.action},${req.user.userId},${input.reason},${JSON.stringify(state.snapshot)}::jsonb,${JSON.stringify(state.policy)}::jsonb,${due}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'retention_request',row,input.reason);return row;
  }));
}));
router.post('/requests/:id/decision',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=retentionDecisionInput.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const lookup=(await tx.execute(sql`SELECT * FROM hr_retention_requests WHERE id=${id}`)).rows[0];if(!lookup)throw new WorkflowError(404,'Request not found');
    const {document,employee,state}=await documentFor(tx,req,Number(lookup.document_id));
    const current=(await tx.execute<{[key:string]:unknown;policy_snapshot:{id:number;version:number}|null}>(sql`SELECT * FROM hr_retention_requests WHERE id=${id} FOR UPDATE`)).rows[0];
    if(!current)throw new WorkflowError(404,'Request not found');
    if(current.status!=='pending'||Number(current.version)!==input.version)throw new WorkflowError(409,'Request changed or already decided');
    if(input.decision==='withdraw'){if(current.requested_by!==req.user.userId)throw new WorkflowError(403,'Only the requester can withdraw');}
    else if(current.requested_by===req.user.userId||employee.userId===req.user.userId)throw new WorkflowError(403,'An independent HR reviewer must decide');
    if(input.decision==='approve'){
      const pinned=current.document_snapshot as any;
      if(Object.keys(state.snapshot).some(k=>String((state.snapshot as any)[k])!==String(pinned[k])))throw new WorkflowError(409,'The document or employee changed; reject or withdraw and submit a fresh request');
      if(current.action==='archive'){
        if(!state.eligible||state.policy?.id!==current.policy_snapshot?.id||state.policy?.version!==current.policy_snapshot?.version)throw new WorkflowError(409,'Retention eligibility or policy changed; submit a fresh request');
        const referenced=await tx.execute(sql`SELECT t.id FROM lifecycle_tasks t JOIN lifecycle_cases c ON c.id=t.case_id WHERE t.document_id=${document.id} AND c.status='in_progress' LIMIT 1`);
        if(referenced.rows.length)throw new WorkflowError(409,'This document is referenced by an open employee checklist');
        const certificate=await tx.execute(sql`SELECT ev.renewal_id FROM workforce_renewal_evidence ev JOIN workforce_renewals r ON r.id=ev.renewal_id LEFT JOIN employee_qualifications q ON q.id=r.new_credential_id WHERE ev.document_id=${document.id} AND (r.status IN ('submitted','returned') OR (r.status='verified' AND q.revoked_at IS NULL AND (q.valid_through IS NULL OR q.valid_through>=${qatarToday()}::date))) LIMIT 1`);
        if(certificate.rows.length)throw new WorkflowError(409,'This document supports a pending qualification renewal or an active credential');
      }else if(!state.archived)throw new WorkflowError(409,'Document is already active');
      const archive=(await tx.execute(sql`INSERT INTO hr_document_archives(document_id,employee_id,archived,changed_by) VALUES (${document.id},${employee.id},${current.action==='archive'},${req.user.userId})
        ON CONFLICT(document_id) DO UPDATE SET version=hr_document_archives.version+1,archived=excluded.archived,changed_by=excluded.changed_by,changed_at=now() RETURNING *`)).rows[0];
      await recordHistory(tx,req,'document_archive',archive,input.reason);
    }
    const row=(await tx.execute(sql`UPDATE hr_retention_requests SET status=${input.decision==='approve'?'approved':input.decision==='reject'?'rejected':'withdrawn'},version=version+1,decided_by=${req.user.userId},decided_at=now(),decision_reason=${input.reason} WHERE id=${id} RETURNING *`)).rows[0];
    await recordHistory(tx,req,'retention_request',row,input.reason);return row;
  }));
}));
router.get('/history/:kind/:id',handle(async(req,res)=>{
  const kind=z.enum(['retention_policy','retention_hold','retention_request','document_archive']).parse(req.params.kind),id=positiveId.parse(req.params.id);
  const offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
  if(kind==='retention_policy')requireAdmin(req);
  else {const table=kind==='retention_hold'?sql`hr_retention_holds`:kind==='retention_request'?sql`hr_retention_requests`:sql`hr_document_archives`;
    const row=(await db.execute(sql`SELECT employee_id FROM ${table} WHERE id=${id}`)).rows[0];if(!row)throw new WorkflowError(404,'Record not found');await employeeFor(db,req,Number(row.employee_id));}
  const rows=(await db.execute(sql`SELECT version,snapshot,reason,created_at FROM hr_workflow_history WHERE kind=${kind} AND record_id=${id} ORDER BY version DESC LIMIT 26 OFFSET ${offset}`)).rows;
  res.json({items:rows.slice(0,25),hasMore:rows.length>25});
}));
export default router;
