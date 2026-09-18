import {z} from 'zod';
import {eq,and,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,employeeOnboarding,onboardingChecklists,checklistTasks,onboardingTasks,activityLogs} from '@shared/schema';
export class OnboardingError extends Error{constructor(public status:number,message:string){super(message);}}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const id=z.number().int().positive();
export async function editOnboarding(recordId:number,body:unknown,userId:number){
 const input=z.object({expectedUpdatedAt:z.string().datetime(),action:z.enum(['notes','cancel']),notes:z.string().trim().max(5000),reason:z.string().trim().min(5).max(1000)}).strict().parse(body);
 return db.transaction(async tx=>{
  const [parent]=await tx.select().from(employeeOnboarding).where(eq(employeeOnboarding.id,recordId)).for('update');
  if(!parent)throw new OnboardingError(404,'Onboarding not found');
  if(parent.updatedAt.toISOString()!==input.expectedUpdatedAt)throw new OnboardingError(409,'Onboarding changed; reload before saving');
  if(parent.status!=='in_progress')throw new OnboardingError(409,'Only active onboarding can be edited');
  // Dates, template, employee, progress and completion are controlled by the
  // start/task/document workflows. This endpoint cannot overwrite them.
  const [row]=await tx.update(employeeOnboarding).set({notes:input.notes,status:input.action==='cancel'?'cancelled':parent.status,
   updatedAt:new Date(Math.max(Date.now(),parent.updatedAt.getTime()+1))}).where(eq(employeeOnboarding.id,recordId)).returning();
  await tx.execute(sql`INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason)
   SELECT 'onboarding_edit',${recordId},coalesce(max(version),0)+1,${JSON.stringify({before:parent,after:row})}::jsonb,${userId},${input.reason}
   FROM lifecycle_history WHERE kind='onboarding_edit' AND record_id=${recordId}`);
  await tx.insert(activityLogs).values({userId,action:'update',entityType:'employee_onboarding',entityId:recordId,details:input.action==='cancel'?'Onboarding cancelled with reason':'Onboarding notes updated with reason'});
  return row;
 });
}
export async function startOnboarding(body:unknown,userId:number){
 const input=z.object({employeeId:id,checklistId:id,startDate:date,notes:z.string().trim().max(5000).optional(),status:z.literal('in_progress').optional()}).strict().parse(body);
 return db.transaction(async tx=>{
  const [employee]=await tx.select().from(employees).where(eq(employees.id,input.employeeId)).for('update');
  if(!employee)throw new OnboardingError(404,'Employee not found');
  const [template]=await tx.select().from(onboardingChecklists).where(eq(onboardingChecklists.id,input.checklistId)).for('share');
  if(!template)throw new OnboardingError(404,'Checklist not found');
  if((template.departmentSpecific&&template.departmentSpecific!==employee.department)||(template.employeeTypeSpecific&&template.employeeTypeSpecific!==employee.type))throw new OnboardingError(400,'Checklist does not match this employee');
  const [active]=await tx.select().from(employeeOnboarding).where(and(eq(employeeOnboarding.employeeId,input.employeeId),eq(employeeOnboarding.status,'in_progress')));
  if(active)throw new OnboardingError(409,'This employee already has active onboarding');
  const tasks=await tx.select().from(checklistTasks).where(and(eq(checklistTasks.checklistId,input.checklistId),eq(checklistTasks.active,true)));
  if(!tasks.length)throw new OnboardingError(400,'Add tasks to this checklist before starting onboarding');
  const [row]=await tx.insert(employeeOnboarding).values({...input,status:'in_progress',progress:0}).returning();
  const policies=await tx.execute(sql`SELECT * FROM onboarding_review_policies ORDER BY version DESC LIMIT 1`);
  const policy=policies.rows[0] as any;
  await tx.insert(onboardingTasks).values(tasks.map(task=>{
   const due=new Date(input.startDate+'T00:00:00Z');due.setUTCDate(due.getUTCDate()+task.daysFromStart);
   const required=!!policy?.owner_groups.includes(task.assignedTo);
   return {onboardingId:row.id,taskId:task.id,assignedTo:task.assignedTo,assigneeId:task.assignedTo==='new_hire'?employee.id:null,dueDate:due.toISOString().slice(0,10),status:'not_started' as const,reviewRequired:required,reviewState:required?'required':'not_required',reviewPolicyId:policy?.id||null};
  }));
  const requirements=await tx.execute(sql`SELECT * FROM onboarding_requirement_templates WHERE checklist_id=${template.id} ORDER BY version DESC LIMIT 1`);
  if(requirements.rows.length){const required=requirements.rows[0] as any;await tx.execute(sql`UPDATE employee_onboarding SET requirement_template_id=${required.id} WHERE id=${row.id}`);for(const type of required.document_types)await tx.execute(sql`INSERT INTO onboarding_document_checks(onboarding_id,document_type) VALUES (${row.id},${type})`);}
  await tx.insert(activityLogs).values({userId,action:'create',entityType:'employee_onboarding',entityId:row.id,details:'Onboarding checklist started'});
  return row;
 });
}
export async function changeOnboardingTask(taskId:number,body:unknown,userId:number,ownerOnly=false,reviewDecision?:'approve'|'return'){
 const input=z.object({expectedVersion:id,status:z.enum(['not_started','in_progress','completed']),comments:z.string().trim().max(5000),assigneeId:id.nullable(),dueDate:date}).strict().parse(body);
 return db.transaction(async tx=>{
  const [lookup]=await tx.select().from(onboardingTasks).where(eq(onboardingTasks.id,taskId));
  if(!lookup)throw new OnboardingError(404,'Task not found');
  // Serialize every task change for this checklist before computing progress.
  const [parent]=await tx.select().from(employeeOnboarding).where(eq(employeeOnboarding.id,lookup.onboardingId)).for('update');
  if(parent.status==='cancelled')throw new OnboardingError(409,'Cancelled onboarding cannot be changed');
  const [task]=await tx.select().from(onboardingTasks).where(eq(onboardingTasks.id,taskId)).for('update');
  if(task.version!==input.expectedVersion)throw new OnboardingError(409,'Task changed; reload before saving');
  let reviewState=task.reviewState,submittedBy=task.submittedBy,reviewedBy=task.reviewedBy;
  if(ownerOnly){
   const [owner]=await tx.select().from(employees).where(and(eq(employees.userId,userId),eq(employees.status,'active')));
   if(!owner||task.assigneeId!==owner.id)throw new OnboardingError(404,'Assigned task not found');
   if(parent.status!=='in_progress'||task.status==='completed')throw new OnboardingError(409,'Ask HR to reopen a completed task');
   if(input.assigneeId!==task.assigneeId||input.dueDate!==task.dueDate)throw new OnboardingError(403,'Only HR can change ownership or due dates');
  }
  if(task.reviewRequired){
   if(reviewDecision){
    if(ownerOnly||task.reviewState!=='pending'||parent.status!=='in_progress')throw new OnboardingError(409,'Select a pending submission');
    const [subject]=await tx.select().from(employees).where(eq(employees.id,parent.employeeId));
    const [owner]=task.assigneeId?await tx.select().from(employees).where(eq(employees.id,task.assigneeId)):[];
    if(task.submittedBy===userId||subject?.userId===userId||owner?.userId===userId)throw new OnboardingError(403,'An independent HR reviewer is required');
    if(input.comments.trim().length<5)throw new OnboardingError(400,'Record a review reason');
    reviewState=reviewDecision==='approve'?'approved':'returned';reviewedBy=userId;
   }else{
    if(task.reviewState==='pending')throw new OnboardingError(409,'Review or return the pending submission first');
    if(input.status==='completed'){
     if(!ownerOnly)throw new OnboardingError(409,'The assigned owner must submit this task for review');
     if(input.comments.trim().length<5)throw new OnboardingError(400,'Record completion evidence');
     input.status='in_progress';reviewState='pending';submittedBy=userId;reviewedBy=null;
    }else {reviewState='required';submittedBy=null;reviewedBy=null;}
   }
  }else if(reviewDecision)throw new OnboardingError(409,'This task does not require review');
  if(input.assigneeId){
   const [owner]=await tx.select().from(employees).where(eq(employees.id,input.assigneeId)).for('share');
   if(!owner||owner.status!=='active')throw new OnboardingError(400,'Choose an active employee as task owner');
  }
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const {expectedVersion,...values}=input;
  await tx.execute(sql`INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason) VALUES ('onboarding_task',${taskId},${task.version},${JSON.stringify(task)}::jsonb,${userId},'Prior task state before controlled change') ON CONFLICT DO NOTHING`);
  const [row]=await tx.update(onboardingTasks).set({...values,reviewState,submittedBy,reviewedBy,version:task.version+1,completedDate:input.status==='completed'?(task.completedDate||today):null,updatedAt:new Date()}).where(eq(onboardingTasks.id,taskId)).returning();
  const [stats]=await tx.select({total:sql<number>`count(*)::int`,completed:sql<number>`count(*) filter (where status = 'completed')::int`}).from(onboardingTasks).where(eq(onboardingTasks.onboardingId,parent.id));
  const progress=Math.round(stats.completed/stats.total*100),complete=stats.total===stats.completed;
  if(complete){const unmet=await tx.execute(sql`SELECT c.id FROM onboarding_document_checks c LEFT JOIN documents d ON d.id=c.document_id WHERE c.onboarding_id=${parent.id} AND c.status<>'waived' AND (c.status<>'verified' OR d.id IS NULL OR d.updated_at IS DISTINCT FROM c.document_updated_at OR d.expiry_date<CURRENT_DATE OR d.issue_date>CURRENT_DATE OR d.document_file IS NULL) LIMIT 1`);if(unmet.rows.length)throw new OnboardingError(409,'Verify every required current document before completing onboarding');}
  await tx.update(employeeOnboarding).set({progress,status:complete?'completed':'in_progress',endDate:complete?(parent.endDate||today):null,updatedAt:new Date()}).where(eq(employeeOnboarding.id,parent.id));
  await tx.insert(activityLogs).values({userId,action:'update',entityType:'onboarding_task',entityId:taskId,details:`Task ${input.status}; owner, due date and progress reconciled`});
  await tx.execute(sql`INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason) VALUES ('onboarding_task',${taskId},${row.version},${JSON.stringify(row)}::jsonb,${userId},${input.comments||'HR task update'})`);
  return row;
 });
}
