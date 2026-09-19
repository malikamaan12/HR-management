import { compensationDetailedReaders } from '@shared/compensation';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, or, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { employees, users, employeeLifecycleEvents, lifecycleCases as cases, lifecycleTasks as tasks, lifecycleTemplates as templates } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { employeeScope } from '../services/access';
import { positiveId, civilDate, reason } from '@shared/hr-rules';
import { audit, scopedEmployee, businessToday } from '../services/hr-rules';
import { fail, type WorkforceTransaction } from '../services/workforce';
import { hasPermission } from '@shared/permissions';
import type { TokenPayload } from '../services/auth';
import governance, {canLifecycleTemplates} from './lifecycleGovernance';
import {lifecyclePolicy, lifecycleHistory, requireLifecycleOwner, lifecyclePermission, lockedLifecycle, independentLifecycleReviewer, publicLifecycleTask, validateLifecycleEvidence} from '../services/lifecycle';
import {equipmentClearance} from '../services/equipment';
import {pendingHandbookAssignments} from '../services/handbook';
import {syncEmploymentService,endEmploymentAccess} from '../services/employment';
import {assignOnboardingInduction,pendingInduction} from '../services/induction-learning';
import {requireOnboardingCompensation,compensationOnboardingStatus} from '../services/compensation';
const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(governance);
const canManage = (u: TokenPayload) => hasPermission(u.role, 'recruitment_onboarding', 'update');
const caseScope = (u: TokenPayload) => or(employeeScope(u, 'recruitment_onboarding'), eq(employees.userId, u.userId), sql `exists(select 1 from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.ownerId}=${u.userId})`);
export async function createLifecycle(tx: WorkforceTransaction, user: TokenPayload, input: {
    employeeId: number;
    templateId: number;
    startDate: string;
    reason: string;
    ownerId: number;
    templateVersion?: number;
}) {
    const e = await scopedEmployee(tx, user, input.employeeId, 'recruitment_onboarding', 'update', true);
    const [template] = await tx.select().from(templates).where(eq(templates.id, input.templateId)).for('share');
    if (!template)
        fail(404, 'Template not found');
    if (!template.active) fail(409, 'Template is archived; choose an active checklist');
    if (input.templateVersion && input.templateVersion !== template.version) fail(409, 'Template changed; reload and review the current version');
    const policy = await lifecyclePolicy(tx);
    if (input.startDate < e.joiningDate)
        fail(400, 'Workflow date must be on or after joining');
    if (template.kind === 'offboarding' && (!['admin', 'super_admin', 'hr', 'hr_director'].includes(user.role) || e.userId === user.userId))
        fail(403, 'An independent HR administrator must manage offboarding');
    const [active] = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.employeeId, e.id), eq(cases.kind, template.kind), eq(cases.status, 'in_progress')));
    if (active)
        fail(409, 'An active workflow of this type already exists');
    await requireLifecycleOwner(tx, input.ownerId);
    const [row] = await tx.insert(cases).values({ employeeId: e.id, kind: template.kind, templateId: template.id, templateSnapshot: template, reviewPolicySnapshot: policy, startDate: input.startDate, createdBy: user.userId, reason: input.reason }).returning();
    const createdTasks = await tx.insert(tasks).values(template.tasks.map(t => ({ caseId: row.id, title: t.title, kind: t.kind, required: t.required, ownerId: input.ownerId, dueDate: new Date(Date.parse(input.startDate) + t.offsetDays * 86400000).toISOString().slice(0, 10), reviewRequired: !!t.reviewRequired || policy.taskKinds.includes(t.kind), reviewState: t.reviewRequired || policy.taskKinds.includes(t.kind) ? 'required' : 'not_required', documentType: t.documentType || '' }))).returning();
    await lifecycleHistory(tx,user,'lifecycle_case',row,input.reason);
    for(const task of createdTasks) await lifecycleHistory(tx,user,'lifecycle_task',publicLifecycleTask(task),'Checklist task created');
    if(template.kind==='onboarding')await assignOnboardingInduction(tx,user,e);
    await audit(tx, user, 'lifecycle', row.id, 'Started ' + template.kind);
    return row;
}
router.get('/options', handle(async (req, res) => res.json({ businessDate: businessToday(), canManage: canManage(req.user!), canTemplates: canLifecycleTemplates(req.user!.role), canPolicy: ['admin','super_admin'].includes(req.user!.role), canReview: hasPermission(req.user!.role,'recruitment_onboarding','approve'), employees: await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(employees).where(employeeScope(req.user!, 'recruitment_onboarding', 'update')).orderBy(employees.id).limit(1000), owners: canManage(req.user!) ? await db.select({ id: users.id, name: sql<string> `${users.firstName} || ' ' || ${users.lastName}` }).from(users).where(and(eq(users.isActive, true), eq(users.approvalStatus, 'approved'))).orderBy(users.id).limit(1000) : [] })));
router.get('/', handle(async (req, res) => { res.json(await db.select({ record: {id:cases.id,employeeId:cases.employeeId,kind:cases.kind,startDate:cases.startDate,status:cases.status,version:cases.version}, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, overdue: sql<number>`(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.status}='pending' and ${tasks.dueDate}<${businessToday()})`, pendingReviews: sql<number>`(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.reviewState}='pending')`, required: sql<number> `(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.required}=true)`, completed: sql<number> `(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.required}=true and ${tasks.status}='completed')` }).from(cases).innerJoin(employees, eq(cases.employeeId, employees.id)).where(caseScope(req.user!)).orderBy(desc(cases.id)).limit(500)); }));
router.post('/', handle(async (req, res) => { const input = z.object({ employeeId: positiveId, templateId: positiveId, startDate: civilDate, reason, ownerId: positiveId, templateVersion: positiveId.optional() }).strict().parse(req.body); res.status(201).json(await db.transaction(tx => createLifecycle(tx, req.user!, input))); }));
router.get('/:id', handle(async (req, res) => {
  const id=positiveId.parse(req.params.id),u=req.user!;
  const [row]=await db.select({record:cases,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,owner:employees.userId}).from(cases).innerJoin(employees,eq(cases.employeeId,employees.id)).where(and(eq(cases.id,id),caseScope(u)));
  if(!row)fail(404,'Workflow not found');
  const manage=await lifecyclePermission(db,u,row.record.employeeId,'update'),approve=await lifecyclePermission(db,u,row.record.employeeId,'approve'),read=await lifecyclePermission(db,u,row.record.employeeId,'read');
  const all=read||row.owner===u.userId;
  const list=await db.select({task:tasks,ownerName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`}).from(tasks).innerJoin(users,eq(tasks.ownerId,users.id)).where(and(eq(tasks.caseId,id),all?undefined:eq(tasks.ownerId,u.userId))).orderBy(tasks.dueDate,tasks.id);
  const independentCase=row.owner!==u.userId;
  const {induction,compensation}=all&&row.record.kind==='onboarding'?await db.transaction(async tx=>({
    induction:await pendingInduction(tx,row.record.employeeId),
    compensation:await compensationOnboardingStatus(tx,row.record.employeeId,row.record.startDate),
  })):{induction:null,compensation:null};
  const handbookPending=all&&row.record.kind==='onboarding'?(await pendingHandbookAssignments(db,row.record.employeeId)).length:null;
  const clearance=all&&row.record.kind==='offboarding'?await equipmentClearance(db,row.record.employeeId):null;
  const [compensationAccess]=row.record.kind==='onboarding'?await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,row.record.employeeId),or(eq(employees.userId,u.userId),compensationDetailedReaders(u.role)?employeeScope(u,'payroll_management'):sql`false`))):[];
  const readiness=all?{
    requiredPending:list.filter(({task})=>task.required&&(task.status!=='completed'||task.reviewRequired&&task.reviewState!=='approved')).length,
    pendingReviews:list.filter(({task})=>task.reviewState==='pending').length,
    inductionPending:induction?.length||0,handbookPending:handbookPending||0,
    compensationMissing:row.record.kind==='onboarding'&&!compensation?.recorded,
    equipmentOpen:clearance?.blocked?clearance.openCount:0,
    futureExit:row.record.kind==='offboarding'&&row.record.startDate>businessToday(),
  }:null;
  res.json({canCompensation:!!compensationAccess,allTasksVisible:all,readiness,record:all?row.record:{id:row.record.id,employeeId:row.record.employeeId,kind:row.record.kind,status:row.record.status,version:row.record.version,startDate:row.record.startDate},name:row.name,induction,compensation,canManage:manage,canCancel:manage&&(row.record.kind!=='offboarding'||(['admin','super_admin','hr','hr_director'].includes(u.role)&&independentCase)),canFinish:approve && (row.record.kind!=='offboarding'||(['admin','super_admin','hr','hr_director'].includes(u.role)&&independentCase)),canDocuments:await lifecyclePermissionForDocuments(u,row.record.employeeId),tasks:list.map(({task,ownerName})=>({...publicLifecycleTask(task),ownerName,canComplete:manage||(task.ownerId===u.userId&&task.status!=='completed'),canSubmit:task.ownerId===u.userId,canReview:approve&&independentLifecycleReviewer(u,{userId:row.owner},task)}))});
}));
async function lifecyclePermissionForDocuments(u:TokenPayload,id:number){const [e]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),employeeScope(u,'compliance_documents')));return !!e;}
router.post('/:id/induction',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {record,employee}=await lockedLifecycle(tx,id);
    if(!await lifecyclePermission(tx,req.user!,employee.id,'update'))fail(404,'Workflow not found within your management access');
    if(record.kind!=='onboarding'||record.status!=='in_progress'||record.version!==input.version)fail(409,'Refresh and choose an open onboarding workflow');
    const assignments=await assignOnboardingInduction(tx,req.user!,employee);
    const [saved]=await tx.update(cases).set({version:record.version+1}).where(eq(cases.id,id)).returning();
    await lifecycleHistory(tx,req.user!,'lifecycle_case',saved,input.reason);
    await audit(tx,req.user!,'lifecycle',id,'Assigned current required induction courses: '+input.reason);
    return {assignments,pending:await pendingInduction(tx,employee.id)};
  }));
}));
router.get('/:id/history',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset),u=req.user!;
  const [row]=await db.select({record:cases,owner:employees.userId}).from(cases).innerJoin(employees,eq(cases.employeeId,employees.id)).where(and(eq(cases.id,id),caseScope(u)));if(!row)fail(404,'Workflow not found');
  const all=row.owner===u.userId||await lifecyclePermission(db,u,row.record.employeeId,'read');
  const result=await db.execute(sql`SELECT kind,record_id,version,snapshot,reason,created_at FROM hr_workflow_history h WHERE (h.kind='lifecycle_case' AND h.record_id=${id} AND ${all}) OR (h.kind='lifecycle_task' AND h.record_id IN (SELECT id FROM lifecycle_tasks WHERE case_id=${id} AND (${all} OR owner_id=${u.userId}))) ORDER BY h.id DESC LIMIT 25 OFFSET ${offset}`);res.json(result.rows);
}));
router.patch('/:id/tasks/:taskId',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),taskId=positiveId.parse(req.params.taskId),u=req.user!;
  const input=z.object({version:positiveId,ownerId:positiveId.optional(),dueDate:civilDate.optional(),status:z.enum(['pending','completed']).optional(),evidence:reason,documentId:positiveId.nullable().optional(),assetTag:z.string().trim().max(150).optional()}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {record,employee}=await lockedLifecycle(tx,id);
    const [task]=await tx.select().from(tasks).where(and(eq(tasks.id,taskId),eq(tasks.caseId,id)));if(!task)fail(404,'Task not found');
    const manage=await lifecyclePermission(tx,u,employee.id,'update');
    if(!manage&&task.ownerId!==u.userId)fail(404,'Assigned task not found');
    if(record.version!==input.version||record.status!=='in_progress')fail(409,'Workflow changed or is closed; refresh');
    if(!manage&&((input.ownerId!==undefined&&input.ownerId!==task.ownerId)||(input.dueDate!==undefined&&input.dueDate!==task.dueDate)))fail(403,'Only managers assign owners and dates');
    if(task.status==='completed'&&(!manage||input.status!=='pending'))fail(409,'A manager must reopen a completed task before changing evidence');
    if(task.reviewState==='pending'&&input.status!=='pending')fail(409,'Review or withdraw the pending submission first');
    if(input.ownerId!==undefined)await requireLifecycleOwner(tx,input.ownerId);
    const {version,...patch}=input;
    let next={...task,...patch,version:task.version+1};
    if(input.status==='completed'){
      if(task.reviewRequired&&(task.ownerId!==u.userId||next.ownerId!==task.ownerId))fail(403,'The assigned owner must submit this task for independent review');
      next.documentSnapshot=await validateLifecycleEvidence(tx,employee.id,next,true);
      next.completedBy=task.reviewRequired?null:u.userId;next.completedAt=task.reviewRequired?null:new Date();
      next.status=task.reviewRequired?'pending':'completed';next.reviewState=task.reviewRequired?'pending':'not_required';
      next.submittedBy=u.userId;next.submittedAt=new Date();next.reviewedBy=null;next.reviewedAt=null;next.reviewNote=null;
      const policy=record.reviewPolicySnapshot as {reviewDays?:number}|null;
      next.reviewDueDate=task.reviewRequired?new Date(Date.parse(businessToday())+(policy?.reviewDays||7)*86400000).toISOString().slice(0,10):null;
    }else{
      next={...next,status:'pending',completedBy:null,completedAt:null,documentSnapshot:null,reviewState:task.reviewRequired?'required':'not_required',submittedBy:null,submittedAt:null,reviewDueDate:null,reviewedBy:null,reviewedAt:null,reviewNote:null};
    }
    await lifecycleHistory(tx,u,'lifecycle_task',publicLifecycleTask(task),'Prior task state',true);
    const [saved]=await tx.update(tasks).set(next).where(eq(tasks.id,task.id)).returning();
    await tx.update(cases).set({version:record.version+1}).where(eq(cases.id,id));
    await lifecycleHistory(tx,u,'lifecycle_task',publicLifecycleTask(saved),input.evidence);return publicLifecycleTask(saved);
  }));
}));
router.post('/:id/tasks/:taskId/review',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),taskId=positiveId.parse(req.params.taskId),u=req.user!,input=z.object({version:positiveId,decision:z.enum(['approve','return']),reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {record,employee}=await lockedLifecycle(tx,id);
    if(!await lifecyclePermission(tx,u,employee.id,'approve'))fail(404,'Workflow not found within your review access');
    const [task]=await tx.select().from(tasks).where(and(eq(tasks.id,taskId),eq(tasks.caseId,id)));if(!task)fail(404,'Task not found');
    if(!independentLifecycleReviewer(u,employee,task))fail(403,'An independent HR reviewer is required');
    if(record.version!==input.version||record.status!=='in_progress'||!task.reviewRequired||task.reviewState!=='pending')fail(409,'Select a current pending submission');
    if(input.decision==='approve')await validateLifecycleEvidence(tx,employee.id,task,false);
    const approved=input.decision==='approve';
    const [saved]=await tx.update(tasks).set({version:task.version+1,status:approved?'completed':'pending',reviewState:approved?'approved':'returned',reviewedBy:u.userId,reviewedAt:new Date(),reviewNote:input.reason,completedBy:approved?u.userId:null,completedAt:approved?new Date():null}).where(eq(tasks.id,taskId)).returning();
    await tx.update(cases).set({version:record.version+1}).where(eq(cases.id,id));
    await lifecycleHistory(tx,u,'lifecycle_task',publicLifecycleTask(saved),input.reason);return publicLifecycleTask(saved);
  }));
}));
router.post('/:id/cancel', handle(async (req, res) => { const id = positiveId.parse(req.params.id), input = z.object({ version: positiveId, reason }).strict().parse(req.body); res.json(await db.transaction(async (tx) => { const [initial] = await tx.select().from(cases).where(eq(cases.id, id)); if (!initial)
    fail(404, 'Workflow not found'); const employee = await scopedEmployee(tx, req.user!, initial.employeeId, 'recruitment_onboarding', 'update', true); const [row] = await tx.select().from(cases).where(eq(cases.id, id)).for('update'); if (row.version !== input.version || row.status !== 'in_progress')
    fail(409, 'Workflow changed or is closed'); if (row.kind === 'offboarding' && (!['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role) || employee.userId === req.user!.userId))
    fail(403, 'An independent HR administrator must manage offboarding'); const [saved] = await tx.update(cases).set({ status: 'cancelled', version: row.version + 1 }).where(eq(cases.id, id)).returning(); await lifecycleHistory(tx,req.user!,'lifecycle_case',row,'Prior workflow state',true); await lifecycleHistory(tx,req.user!,'lifecycle_case',saved,input.reason); await audit(tx, req.user!, 'lifecycle', id, 'Cancelled ' + row.kind + ': ' + input.reason); return saved; })); }));
router.post('/:id/complete', handle(async (req, res) => {
    const id = positiveId.parse(req.params.id), input = z.object({ version: z.number().int().positive(), reason, confirmed: z.literal(true) }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const [initial] = await tx.select().from(cases).where(eq(cases.id, id));
        if (!initial)
            fail(404, 'Workflow not found');
        const employee = await scopedEmployee(tx, req.user!, initial.employeeId, 'recruitment_onboarding', 'approve', true);
        const [row] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
        if (row.version !== input.version || row.status !== 'in_progress')
            fail(409, 'Workflow changed or is already closed');
        const [pending] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.caseId, id), eq(tasks.required, true), eq(tasks.status, 'pending')));
        if (pending)
            fail(409, 'Complete every required task first');
        const reviewPending=await tx.select({id:tasks.id}).from(tasks).where(and(eq(tasks.caseId,id),eq(tasks.reviewState,'pending')));if(reviewPending.length)fail(409,'Review or withdraw every pending submission first');
        const requiredTasks=await tx.select().from(tasks).where(and(eq(tasks.caseId,id),eq(tasks.required,true)));
        for(const task of requiredTasks){if(task.reviewRequired&&task.reviewState!=='approved')fail(409,'Complete required independent reviews first');await validateLifecycleEvidence(tx,employee.id,task,false);}
        if(row.kind==='onboarding'){
            await requireOnboardingCompensation(tx,employee.id,row.startDate);
            const requiredInduction=await pendingInduction(tx,employee.id);
            if(requiredInduction.length)fail(409,'Complete required induction courses and passing quizzes, or record an independent HR exemption, before finishing onboarding');
            const pendingHandbooks=await pendingHandbookAssignments(tx,employee.id);
            if(pendingHandbooks.length)fail(409,'Complete required handbook acknowledgements before finishing onboarding');
            await syncEmploymentService(tx,req.user!,employee,'onboarding',row.startDate,input.reason,{kind:'lifecycle_case',caseId:row.id},fail);
        }
        if (row.kind === 'offboarding') {
            const clearance=await equipmentClearance(tx,employee.id);
            if(clearance.blocked)fail(409,`Resolve ${clearance.openCount} open equipment issue(s) before completing offboarding`);
            if (!['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role) || employee.userId === req.user!.userId)
                fail(403, 'An independent HR administrator must complete offboarding');
            if (row.startDate > businessToday())
                fail(409, 'Complete offboarding on or after the last employment date');
            if(employee.status==='inactive')fail(409,'This employee has already left; review the lifecycle record before closing this checklist');
            const [event]=await tx.insert(employeeLifecycleEvents).values({employeeId:employee.id,eventType:'termination',effectiveDate:row.startDate,reason:input.reason,metadata:{lifecycleCaseId:row.id},createdBy:req.user!.userId}).returning();
            await syncEmploymentService(tx,req.user!,employee,'termination',row.startDate,input.reason,{kind:'lifecycle_case',caseId:row.id,lifecycleEventId:event.id},fail);
            await endEmploymentAccess(tx,employee,row.startDate,fail);
            await tx.update(employees).set({ status: 'inactive', terminationDate: row.startDate, updatedAt: new Date() }).where(eq(employees.id, employee.id));
        }
        const [saved] = await tx.update(cases).set({ status: 'completed', version: row.version + 1, completedAt: new Date() }).where(eq(cases.id, id)).returning();
        await lifecycleHistory(tx,req.user!,'lifecycle_case',row,'Prior workflow state',true);
        await lifecycleHistory(tx,req.user!,'lifecycle_case',saved,input.reason);
        await audit(tx, req.user!, 'lifecycle', id, 'Completed ' + row.kind + ': ' + input.reason);
        return saved;
    }));
}));
export default router;
