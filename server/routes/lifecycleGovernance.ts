import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { lifecycleTemplates as templates, lifecycleTasks as tasks, lifecycleCases as cases, employees, users } from '@shared/schema';
import { lifecycleTemplateInput, lifecyclePolicyInput } from '@shared/lifecycle';
import { positiveId, reason } from '@shared/hr-rules';
import { hasPermission } from '@shared/permissions';
import { handle } from './hr-rules';
import { fail } from '../services/workforce';
import { employeeScope } from '../services/access';
import { lifecycleHistory, lifecyclePolicy, publicLifecycleTask } from '../services/lifecycle';
import { businessToday } from '../services/hr-rules';

const router = Router();
export const canLifecycleTemplates = (role: string) => ['admin','super_admin','hr_director','hr'].includes(role);
const templateManager = (req:any) => { if(!canLifecycleTemplates(req.user.role)) fail(403,'HR administrator access required'); };
const manager = (req:any) => { if(!hasPermission(req.user.role,'recruitment_onboarding','update')) fail(403,'Recruitment management access required'); };
const policyAdmin = (req:any) => { if(!['admin','super_admin'].includes(req.user.role)) fail(403,'Administrator access required'); };
router.get('/templates',handle(async(req,res)=>{manager(req);res.json(await db.select().from(templates).orderBy(desc(templates.id)));}));
router.post('/templates',handle(async(req,res)=>{
  templateManager(req); const {reason:note,...input}=lifecycleTemplateInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const [row]=await tx.insert(templates).values({...input,createdBy:req.user!.userId}).returning();
    await lifecycleHistory(tx,req.user!,'lifecycle_template',row,note || 'Created reusable checklist');return row;
  }));
}));
router.patch('/templates/:id',handle(async(req,res)=>{
  templateManager(req);const id=positiveId.parse(req.params.id);
  const {version,reason:note,active,...input}=lifecycleTemplateInput.extend({version:positiveId,reason,active:z.boolean()}).parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [old]=await tx.select().from(templates).where(eq(templates.id,id)).for('update');if(!old)fail(404,'Template not found');
    if(old.version!==version)fail(409,'Template changed; reload before saving');
    if(old.kind!==input.kind)fail(400,'Workflow type cannot change; create a separate template');
    await lifecycleHistory(tx,req.user!,'lifecycle_template',old,'Original template preserved before revision',true);
    const [row]=await tx.update(templates).set({...input,active,version:version+1}).where(eq(templates.id,id)).returning();
    await lifecycleHistory(tx,req.user!,'lifecycle_template',row,note);return row;
  }));
}));
router.get('/templates/:id/history',handle(async(req,res)=>{
  manager(req);const id=positiveId.parse(req.params.id),offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
  const rows=await db.execute(sql`SELECT version,snapshot,reason,created_at FROM hr_workflow_history WHERE kind='lifecycle_template' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${offset}`);res.json(rows.rows);
}));
router.get('/review-policy',handle(async(req,res)=>{manager(req);res.json(await lifecyclePolicy(db));}));
router.post('/review-policy',handle(async(req,res)=>{
  policyAdmin(req);const input=lifecyclePolicyInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE lifecycle_review_policies IN EXCLUSIVE MODE`);const current=await lifecyclePolicy(tx);
    if(current.version!==input.version)fail(409,'Approval rules changed; reload before saving');
    const result=await tx.execute(sql`INSERT INTO lifecycle_review_policies(version,task_kinds,review_days,created_by,reason) VALUES (${input.version+1},${JSON.stringify(input.taskKinds)}::jsonb,${input.reviewDays},${req.user!.userId},${input.reason}) RETURNING id`);
    const row={id:Number(result.rows[0].id),version:input.version+1,taskKinds:input.taskKinds,reviewDays:input.reviewDays};
    await lifecycleHistory(tx,req.user!,'lifecycle_review_policy',row,input.reason);return row;
  }));
}));
router.get('/review-policy/history',handle(async(req,res)=>{
  manager(req);const offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
  res.json((await db.execute(sql`SELECT version,task_kinds,review_days,reason,created_at FROM lifecycle_review_policies ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows);
}));
router.get('/tasks/queue',handle(async(req,res)=>{
  const input=z.object({view:z.enum(['mine','review','overdue']).default('mine'),offset:z.coerce.number().int().min(0).default(0)}).parse(req.query),u=req.user!;
  const eligible=and(employeeScope(u,'recruitment_onboarding','approve'),sql`${employees.userId} IS DISTINCT FROM ${u.userId}`,sql`${tasks.ownerId}<>${u.userId}`,sql`${tasks.submittedBy} IS DISTINCT FROM ${u.userId}`);
  const filter=input.view==='mine'?eq(tasks.ownerId,u.userId):and(eligible,eq(tasks.reviewState,'pending'),input.view==='overdue'?sql`${tasks.reviewDueDate}<${businessToday()}`:undefined);
  const rows=await db.select({task:tasks,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,kind:cases.kind,ownerName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`}).from(tasks).innerJoin(cases,eq(tasks.caseId,cases.id)).innerJoin(employees,eq(cases.employeeId,employees.id)).innerJoin(users,eq(tasks.ownerId,users.id)).where(and(eq(cases.status,'in_progress'),eq(tasks.status,'pending'),filter)).orderBy(tasks.dueDate,tasks.id).limit(51).offset(input.offset);
  res.json({items:rows.slice(0,50).map(r=>({...r,task:publicLifecycleTask(r.task)})),hasMore:rows.length>50});
}));
export default router;
