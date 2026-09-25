import {Router} from 'express';
import {z} from 'zod';
import {and,eq,or,sql} from 'drizzle-orm';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../db';
import {employees,employeeLifecycleEvents} from '@shared/schema';
import {separationManager,separationPolicyManager,separationInputSchema,separationPolicySchema,separationStatuses,documentKinds,type SeparationSnapshot} from '@shared/separation';
import {civilDate} from '@shared/hr-rules';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {recordHandler as handle,recordHistory,qatarToday} from '../services/workflowRecords';
import {separationFail as fail,separationPolicy,settlementSnapshot,readyToReview,printableSeparation,fingerprint} from '../services/separation';
import {syncEmploymentService,endEmploymentAccess} from '../services/employment';
import {equipmentClearance} from '../services/equipment';
import type {TokenPayload} from '../services/auth';
import {settlementReconciliation} from '../services/separation-reconciliation';
import settlementPayments from './settlement-payments';

const router=Router();router.use(authenticate);
router.use('/:id/payment',settlementPayments);
const id=z.coerce.number().int().positive(),version=z.number().int().positive(),reason=z.string().trim().min(3).max(2000);
const manager=(req:any)=>{if(!separationManager(req.user.role))fail(403,'HR separation access is required');};
const policyManager=(req:any)=>{if(!separationPolicyManager(req.user.role))fail(403,'Administrator or HR director policy access is required');};
const manageScope=(user:TokenPayload)=>separationManager(user.role)?employeeScope(user,'employee_database','update'):sql`false`;
const readScope=(user:TokenPayload)=>or(manageScope(user),and(eq(employees.userId,user.userId),sql`s.reviewed_at IS NOT NULL`))!;
const checkVersion=(row:any,v:number)=>{if(Number(row.version)!==v)fail(409,'This case changed. Reload before continuing.');};
async function person(tx:any,req:any,employeeId:number,lock=false){
  const query=tx.select().from(employees).where(and(eq(employees.id,employeeId),manageScope(req.user)));
  const [employee]=lock?await query.for('update'):await query;if(!employee)fail(404,'Employee not found');return employee;
}
async function record(tx:any,req:any,caseId:number,lock=false){
  const row=(await tx.execute(sql`SELECT s.*,employees.first_name || ' ' || employees.last_name AS employee_name,employees.user_id AS employee_user_id,
    (${manageScope(req.user)}) AS can_manage FROM employee_separations s JOIN employees ON employees.id=s.employee_id WHERE s.id=${caseId} AND ${readScope(req.user)}`)).rows[0];
  if(!row)fail(404,'Separation case not found');
  if(lock){await person(tx,req,Number(row.employee_id),true);const fresh=(await tx.execute(sql`SELECT * FROM employee_separations WHERE id=${caseId} FOR UPDATE`)).rows[0];return {...row,...fresh};}return row;
}
const canReview=(req:any,row:any)=>!!row.can_manage&&![Number(row.prepared_by),Number(row.created_by),Number(row.employee_user_id)].includes(req.user.userId)&&(!row.snapshot?.policy.requireDirectorApproval||['admin','super_admin','hr_director'].includes(req.user.role));
async function history(tx:any,req:any,row:any,action:string,note:string){await recordHistory(tx,req,'employee_separation',{...row,action},note);}
router.get('/context',handle(async(req,res)=>{
  const q=z.string().trim().max(100).parse(req.query.q||''),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const candidates=separationManager(req.user.role)?(await db.execute(sql`SELECT employees.id,employees.employee_id AS reference,employees.first_name || ' ' || employees.last_name AS name,employees.status,employees.termination_date AS "lastDay"
    FROM employees WHERE ${manageScope(req.user)} AND (employees.first_name || ' ' || employees.last_name || ' ' || employees.employee_id) ILIKE ${pattern} ORDER BY employees.first_name,employees.id LIMIT 50`)).rows:[];
  res.json({canManage:separationManager(req.user.role),employees:candidates,today:qatarToday()});
}));
router.get('/policy',handle(async(req,res)=>{manager(req);res.json(await separationPolicy(db));}));
router.put('/policy',handle(async(req,res)=>{
  policyManager(req);const input=z.object({version:z.number().int().nonnegative(),definition:separationPolicySchema,reason,effectiveFrom:civilDate,legalBasis:z.string().trim().min(20).max(2000),confirmed:z.literal(true)}).strict().parse(req.body);
  if(input.effectiveFrom<qatarToday())fail(400,'A policy change cannot be backdated');
  res.json(await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE separation_policies IN EXCLUSIVE MODE`);
    const head=Number((await tx.execute(sql`SELECT coalesce(max(version),0) AS version FROM separation_policies`)).rows[0].version);checkVersion({version:head},input.version);
    const row=(await tx.execute(sql`INSERT INTO separation_policy_proposals(base_version,definition,effective_from,legal_basis,reason,proposed_by) VALUES(${head},${JSON.stringify(input.definition)}::jsonb,${input.effectiveFrom}::date,${input.legalBasis},${input.reason},${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'separation_policy_proposal',row,input.reason);return {id:row.id,status:'pending'};
  }));
}));
router.get('/policy-proposals',handle(async(req,res)=>{
  manager(req);
  const head=Number((await db.execute(sql`SELECT coalesce(max(version),0) AS version FROM separation_policies`)).rows[0].version);
  const rows=(await db.execute(sql`SELECT p.*,u.first_name || ' ' || u.last_name AS proposer_name FROM separation_policy_proposals p JOIN users u ON u.id=p.proposed_by ORDER BY p.id DESC LIMIT 100`)).rows;
  res.json({headVersion:head,canPropose:separationPolicyManager(req.user.role),today:qatarToday(),items:rows.map((p:any)=>({...p,canReview:p.status==='pending'&&p.proposed_by!==req.user.userId&&separationPolicyManager(req.user.role)}))});
}));
router.post('/policy-proposals/:id/:action',handle(async(req,res)=>{
  policyManager(req);const action=z.enum(['approve','reject']).parse(req.params.action),input=z.object({version,reason,confirmed:z.literal(true)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE separation_policies IN EXCLUSIVE MODE`);
    const row=(await tx.execute(sql`SELECT * FROM separation_policy_proposals WHERE id=${id.parse(req.params.id)} FOR UPDATE`)).rows[0];
    if(!row)fail(404,'Policy proposal not found');checkVersion(row,input.version);
    if(row.status!=='pending')fail(409,'This proposal was already reviewed');if(Number(row.proposed_by)===req.user.userId)fail(403,'A different eligible reviewer must decide this policy');
    if(action==='approve'){
      const head=Number((await tx.execute(sql`SELECT coalesce(max(version),0) AS version FROM separation_policies`)).rows[0].version);
      if(head!==Number(row.base_version))fail(409,'A policy was published since this proposal. Reject it and prepare a fresh proposal.');
      if(String(row.effective_from)<qatarToday())fail(409,'The effective date has passed. Prepare a new proposal.');
      const scheduled=(await tx.execute(sql`SELECT effective_from::text AS date FROM separation_policies ORDER BY effective_from DESC,version DESC LIMIT 1`)).rows[0];
      if(scheduled&&String(row.effective_from)<String(scheduled.date))fail(409,'A published policy has a later effective date. Prepare a proposal effective on or after that date.');
      const published=(await tx.execute(sql`INSERT INTO separation_policies(version,definition,created_by,reason,effective_from) VALUES(${head+1},${JSON.stringify(separationPolicySchema.parse(row.definition))}::jsonb,${req.user.userId},${row.reason},${row.effective_from}::date) RETURNING *`)).rows[0];
      await recordHistory(tx,req,'separation_policy',published,input.reason);
    }
    const saved=(await tx.execute(sql`UPDATE separation_policy_proposals SET status=${action==='approve'?'approved':'rejected'},version=version+1,reviewed_by=${req.user.userId},review_reason=${input.reason},reviewed_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await recordHistory(tx,req,'separation_policy_proposal',saved,input.reason);return {id:row.id,status:saved.status};
  }));
}));
router.post('/calculate',handle(async(req,res)=>{
  manager(req);const input=z.object({employeeId:id,input:separationInputSchema}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>settlementSnapshot(tx,await person(tx,req,input.employeeId,true),input.input)));
}));
router.get('/',handle(async(req,res)=>{
  const input=z.object({status:z.enum(['',...separationStatuses]).default(''),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query),pattern='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await db.execute(sql`SELECT s.id,s.reference,s.status,s.input->>'kind' AS kind,s.input->>'lastDay' AS last_day,s.snapshot->>'currency' AS currency,s.snapshot->>'netCents' AS net_cents,
    employees.first_name || ' ' || employees.last_name AS employee_name FROM employee_separations s JOIN employees ON employees.id=s.employee_id
    WHERE ${readScope(req.user)} AND (${input.status===''} OR s.status=${input.status}) AND (s.reference ILIKE ${pattern} OR (employees.first_name || ' ' || employees.last_name) ILIKE ${pattern}) ORDER BY s.id DESC LIMIT 26 OFFSET ${(input.page-1)*25}`)).rows;
  const counts=(await db.execute(sql`SELECT s.status,count(*)::integer AS count FROM employee_separations s JOIN employees ON employees.id=s.employee_id WHERE ${readScope(req.user)} GROUP BY s.status`)).rows;
  res.json({items:rows.slice(0,25),hasMore:rows.length>25,counts});
}));
router.post('/',handle(async(req,res)=>{
  manager(req);const input=z.object({employeeId:id,input:separationInputSchema,submissionKey:z.string().uuid()}).strict().parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const employee=await person(tx,req,input.employeeId,true);
    const prior=(await tx.execute(sql`SELECT id,employee_id FROM employee_separations WHERE created_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];
    if(prior){if(Number(prior.employee_id)!==employee.id)fail(409,'Submission key was already used');return {id:prior.id};}
    if((await tx.execute(sql`SELECT id FROM employee_separations WHERE employee_id=${employee.id} AND (status IN ('draft','in_review','approved') OR (status='completed' AND input->>'lastDay'=${input.input.lastDay})) LIMIT 1`)).rows.length)fail(409,'This employee already has an open case or a completed settlement for this leaving date');
    const snapshot=await settlementSnapshot(tx,employee,input.input);
    const row=(await tx.execute(sql`INSERT INTO employee_separations(reference,employee_id,input,snapshot,created_by,prepared_by,submission_key)
      VALUES(${'EOS-'+randomUUID().slice(0,12).toUpperCase()},${employee.id},${JSON.stringify(input.input)}::jsonb,${JSON.stringify(snapshot)}::jsonb,${req.user.userId},${req.user.userId},${input.submissionKey}) RETURNING *`)).rows[0];
    await history(tx,req,row,'created','Separation draft created');return {id:row.id};
  }));
}));
router.get('/:id',handle(async(req,res)=>{
  const row=await record(db,req,id.parse(req.params.id));
  const events=row.can_manage?(await db.execute(sql`SELECT h.snapshot->>'action' AS action,h.reason AS note,h.created_at,u.first_name || ' ' || u.last_name AS actor_name FROM hr_workflow_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.kind='employee_separation' AND h.record_id=${row.id} ORDER BY h.version DESC LIMIT 100`)).rows:[];
  res.json({...row,employee_user_id:undefined,canManage:!!row.can_manage,canReview:canReview(req,row),history:events});
}));
router.get('/:id/reconciliation',handle(async(req,res)=>{
 manager(req);res.json(await db.transaction(async tx=>{const row=await record(tx,req,id.parse(req.params.id),true),current=await settlementReconciliation(tx,Number(row.employee_id),row.input.lastDay);return {current,reviewed:row.reconciliation||null,changed:!!row.reconciliation&&!isDeepStrictEqual(current,row.reconciliation),enteredSalary:row.input.unpaidSalary,enteredLeaveDays:row.input.leaveDays,currency:row.snapshot?.currency||null};}));
}));
router.patch('/:id',handle(async(req,res)=>{
  manager(req);const input=z.object({version,input:separationInputSchema}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);if(row.status!=='draft')fail(409,'Only a draft can be edited');
    const snapshot=await settlementSnapshot(tx,await person(tx,req,Number(row.employee_id)),input.input);
    const saved=(await tx.execute(sql`UPDATE employee_separations SET input=${JSON.stringify(input.input)}::jsonb,snapshot=${JSON.stringify(snapshot)}::jsonb,prepared_by=${req.user.userId},version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,'edited','Draft calculation and documents updated');return {id:row.id};
  }));
}));
router.post('/:id/:action',handle(async(req,res)=>{
  manager(req);const action=z.enum(['submit','approve','return','cancel','complete']).parse(req.params.action),input=z.object({version,reason,confirmed:z.literal(true)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);
    const employee=await person(tx,req,Number(row.employee_id)),draft=separationInputSchema.parse(row.input);
    let status=row.status,snapshot=row.snapshot,reconciliation=row.reconciliation,reviewedBy=row.reviewed_by,reviewedAt=row.reviewed_at,preparedBy=row.prepared_by,completedBy=null,completedAt=null;
    if(action==='submit'){
      if(status!=='draft')fail(409,'Only a draft can be submitted');readyToReview(draft);snapshot=await settlementSnapshot(tx,employee,draft);status='in_review';preparedBy=req.user.userId;
      reconciliation=await settlementReconciliation(tx,employee.id,draft.lastDay);
      if(reconciliation.pendingLeave.length)fail(409,'Resolve pending leave before submitting a settlement.');
    }else if(action==='approve'){
      if(status!=='in_review')fail(409,'Only a submitted case can be approved');if(!canReview(req,row))fail(403,'An independent eligible HR reviewer must approve this case');
      readyToReview(draft);const current=await settlementSnapshot(tx,employee,draft,snapshot.policy);
      if(current.sourceHash!==snapshot.sourceHash)fail(409,'Employment, service or compensation changed. Return this case to draft and recalculate.');
      if(!reconciliation||!isDeepStrictEqual(reconciliation,await settlementReconciliation(tx,employee.id,draft.lastDay)))fail(409,'Payroll or leave sources changed, or this legacy case has no reconciliation snapshot. Return to draft and reconcile again.');
      status='approved';reviewedBy=req.user.userId;reviewedAt=new Date();
    }else if(action==='return'){
      if(status!=='in_review')fail(409,'Only a submitted case can be returned');status='draft';snapshot=null;
    }else if(action==='cancel'){
      if(!['draft','in_review','approved'].includes(status))fail(409,'This case is already closed');if(employee.userId===req.user.userId)fail(403,'Another HR colleague must cancel your case');status='cancelled';
    }else{
      if(status!=='approved')fail(409,'Approve the case before completing separation');if(employee.userId===req.user.userId)fail(403,'Another HR colleague must complete your separation');
      if(draft.lastDay>qatarToday())fail(409,'Complete separation on or after the last employment date');
      const current=await settlementSnapshot(tx,employee,draft,snapshot.policy);
      // A completed offboarding checklist can close the same service period without changing the approved money.
      const financial=(s:SeparationSnapshot)=>({service:{start:s.service.start,end:s.service.end,days:s.service.days,years:s.service.years,eligible:s.service.eligible,continuityPolicyVersion:s.service.continuityPolicyVersion,bridgedDays:s.service.bridgedDays},notice:s.notice,basicCents:s.basicCents,currency:s.currency,compensationId:s.compensationId,lines:s.lines});
      // JSONB may reorder nested object keys. Compare values, not serialization order.
      if(!isDeepStrictEqual(financial(current),financial(snapshot)))fail(409,'The approved calculation no longer matches current records. Cancel and prepare a new reviewed case.');
      if(!reconciliation||!isDeepStrictEqual(reconciliation,await settlementReconciliation(tx,employee.id,draft.lastDay)))fail(409,'Payroll or leave changed after review. Cancel and prepare a newly reconciled case.');
      const clearance=await equipmentClearance(tx,employee.id);if(clearance.blocked)fail(409,'Resolve open equipment returns before completing separation');
      const openCases=(await tx.execute(sql`SELECT id FROM lifecycle_cases WHERE employee_id=${employee.id} AND kind='offboarding' AND status IN ('draft','in_progress') LIMIT 1`)).rows;
      if(openCases.length)fail(409,'Complete the existing offboarding checklist first, then return here to close the settlement');
      if(employee.status!=='inactive'){
        const [event]=await tx.insert(employeeLifecycleEvents).values({employeeId:employee.id,eventType:'termination',effectiveDate:draft.lastDay,reason:input.reason,metadata:{separationCaseId:row.id},createdBy:req.user.userId}).returning();
        await syncEmploymentService(tx,req.user,employee,'termination',draft.lastDay,input.reason,{kind:'separation',caseId:row.id,lifecycleEventId:event.id});
        await tx.update(employees).set({status:'inactive',terminationDate:draft.lastDay,recordVersion:sql`${employees.recordVersion}+1`,updatedAt:new Date()}).where(eq(employees.id,employee.id));
      }
      await endEmploymentAccess(tx,employee,draft.lastDay);
      status='completed';completedBy=req.user.userId;completedAt=new Date();
    }
    const saved=(await tx.execute(sql`UPDATE employee_separations SET status=${status},snapshot=${JSON.stringify(snapshot)}::jsonb,reconciliation=${JSON.stringify(reconciliation)}::jsonb,prepared_by=${preparedBy},reviewed_by=${reviewedBy},reviewed_at=${reviewedAt},completed_by=${completedBy},completed_at=${completedAt},version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,action,input.reason);return {id:row.id};
  }));
}));
router.get('/:id/documents/:kind',handle(async(req,res)=>{
  const row=await record(db,req,id.parse(req.params.id)),kind=z.enum(documentKinds).parse(req.params.kind);
  if(!row.snapshot)fail(409,'Save and calculate this draft before opening its documents');
  if(kind==='service'&&row.input.lastDay>qatarToday())fail(409,'A completed-service certificate is available on or after the leaving date');
  res.setHeader('Content-Type','text/html; charset=utf-8');
  if(req.query.download==='true')res.setHeader('Content-Disposition',`attachment; filename="${row.reference}-${kind}.html"`);
  res.send(printableSeparation(row,kind));
}));
export default router;
