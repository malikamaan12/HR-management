import {Router} from 'express';
import {z} from 'zod';
import {eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,users,authSessions,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {OnboardingError} from '../services/onboarding-workflow';
import {fromExitTemplateSchema,expandExitTemplate} from '../services/employmentContinuity';
const router=Router();router.use(authenticate);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!['super_admin','admin','hr_director','hr'].includes(req.user!.role))return res.status(403).json({message:'HR management access is required'});next();});
const id=z.number().int().positive();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const task=z.object({title:z.string().trim().min(2).max(160),kind:z.enum(['checklist','asset']),ownerId:id,dueDate:date,status:z.enum(['pending','done']),notes:z.string().trim().max(1000)}).strict().refine(t=>t.status!=='done'||t.notes.length>=5,'Record completion or asset-return evidence in notes');
type Task=z.infer<typeof task>;
type Row={id:number;employee_id:number;version:number;status:string;tasks:Task[];reason:string;account_deactivated:boolean};
function fail(res:any,error:unknown){const code=(error as any)?.code||(error as any)?.cause?.code;res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:code==='23505'?409:500).json({message:error instanceof OnboardingError?error.message:error instanceof z.ZodError?error.issues.map(i=>i.message).join('; '):code==='23505'?'Employee already has an open offboarding case':'Unable to save offboarding'});}
router.get('/',async(req,res)=>{try{
 const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const result=await db.execute(sql`SELECT o.*,(SELECT count(*)::int FROM equipment_custody c WHERE c.employee_id=o.employee_id AND c.status<>'closed') AS outstanding_assets, e.first_name || ' ' || e.last_name AS employee_name FROM offboarding_cases o JOIN employees e ON e.id=o.employee_id ORDER BY o.id DESC LIMIT 25 OFFSET ${(page-1)*25}`);
 res.json({items:result.rows,page});
}catch(error){fail(res,error);}});
router.post('/',async(req,res)=>{try{
 const input=z.union([fromExitTemplateSchema,z.object({employeeId:id,reason:z.string().trim().min(5).max(1000),tasks:z.array(task).min(1).max(100)}).strict()]).parse(req.body);
 if('tasks' in input&&input.tasks.some(t=>t.status!=='pending'))throw new OnboardingError(400,'New checklist tasks must start pending');
 const result=await db.transaction(async tx=>{
  const [employee]=await tx.select().from(employees).where(eq(employees.id,input.employeeId)).for('update');if(!employee)throw new OnboardingError(404,'Employee not found');
  if(employee.userId===req.user!.userId)throw new OnboardingError(403,'Another HR manager must handle your offboarding');
  if('targetExitDate' in input&&input.targetExitDate<employee.joiningDate)throw new OnboardingError(400,'Target exit date must be on or after joining');
  const expanded='templateId' in input?await expandExitTemplate(tx,input,employee.type):null;
  const tasks=expanded?z.array(task).parse(expanded.tasks):('tasks' in input?input.tasks:[]);
  for(const t of tasks){const [owner]=await tx.select().from(employees).where(eq(employees.id,t.ownerId));if(!owner||owner.status!=='active'||owner.id===employee.id)throw new OnboardingError(400,'Each task needs an active owner other than the departing employee');}
  const rows=await tx.execute(sql`INSERT INTO offboarding_cases(employee_id,tasks,reason,created_by,template_snapshot,target_exit_date) VALUES (${input.employeeId},${JSON.stringify(tasks)}::jsonb,${input.reason},${req.user!.userId},${expanded?JSON.stringify(expanded.snapshot):null}::jsonb,${'targetExitDate' in input?input.targetExitDate:null}) RETURNING *`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'offboarding',entityId:Number(rows.rows[0].id),details:'Offboarding checklist created'});return rows.rows[0];
 });res.status(201).json(result);
}catch(error){fail(res,error);}});
router.post('/:id/actions',async(req,res)=>{try{
 const caseId=z.coerce.number().int().positive().parse(req.params.id);
 const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('task'),version:id,index:z.number().int().min(0),task}).strict(),
  z.object({action:z.literal('complete'),version:id,deactivateAccount:z.boolean(),reason:z.string().trim().min(5).max(1000)}).strict(),
  z.object({action:z.literal('cancel'),version:id,reason:z.string().trim().min(5).max(1000)}).strict()
 ]).parse(req.body);
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT set_config('app.actor_id',${String(req.user!.userId)},true)`);
  const lookup=await tx.execute(sql`SELECT employee_id FROM offboarding_cases WHERE id=${caseId}`);if(!lookup.rows.length)throw new OnboardingError(404,'Offboarding case not found');
  const [employee]=await tx.select().from(employees).where(eq(employees.id,Number(lookup.rows[0].employee_id))).for('update');
  const rows=await tx.execute(sql`SELECT * FROM offboarding_cases WHERE id=${caseId} FOR UPDATE`);const row=rows.rows[0] as unknown as Row;
  if(employee.userId===req.user!.userId)throw new OnboardingError(403,'Another HR manager must handle your offboarding');
  if(row.version!==input.version||row.status!=='open')throw new OnboardingError(409,'Case changed or is no longer open; reload before saving');
  let status=row.status,deactivated=false;
  if(input.action==='task'){
   if(!row.tasks[input.index])throw new OnboardingError(404,'Task not found');
   const old=row.tasks[input.index];if(old.title!==input.task.title||old.kind!==input.task.kind)throw new OnboardingError(400,'Task title and type remain fixed after creation');
   const [owner]=await tx.select().from(employees).where(eq(employees.id,input.task.ownerId));if(!owner||owner.status!=='active'||owner.id===employee.id)throw new OnboardingError(400,'Choose an active owner other than the departing employee');
   row.tasks[input.index]=input.task;
  }else if(input.action==='cancel'){status='cancelled';}
  else{
   if(row.tasks.some(t=>t.status!=='done'))throw new OnboardingError(409,'Complete all checklist and asset-return tasks first');
   const equipment=await tx.execute(sql`SELECT id FROM equipment_custody WHERE employee_id=${employee.id} AND status<>'closed' LIMIT 1`);if(equipment.rows.length)throw new OnboardingError(409,'Resolve outstanding equipment in the equipment register before completing offboarding');
   status='completed';
   if(input.deactivateAccount){
    if(!['admin','super_admin'].includes(req.user!.role))throw new OnboardingError(403,'An administrator must deactivate the account');
    if(employee.userId){const [account]=await tx.select().from(users).where(eq(users.id,employee.userId)).for('update');
     if(account.role==='super_admin'&&req.user!.role!=='super_admin')throw new OnboardingError(403,'A Super Admin must deactivate another Super Admin');
     await tx.update(users).set({isActive:false}).where(eq(users.id,account.id));await tx.update(authSessions).set({isActive:false,updatedAt:new Date()}).where(eq(authSessions.userId,account.id));deactivated=true;
    }
   }
  }
  const saved=await tx.execute(sql`UPDATE offboarding_cases SET tasks=${JSON.stringify(row.tasks)}::jsonb,version=version+1,status=${status},completed_at=${status==='completed'?new Date():null},account_deactivated=${deactivated},decision_reason=${input.action==='task'?null:input.reason} WHERE id=${caseId} RETURNING *`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'offboarding',entityId:caseId,details:input.action==='task'?`Task ${input.index+1} ${input.task.status}`:`Offboarding ${status}; account deactivated: ${deactivated}`});return saved.rows[0];
 });res.json(result);
}catch(error){fail(res,error);}});
export default router;
