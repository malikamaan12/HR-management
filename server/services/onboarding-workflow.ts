import {z} from 'zod';
import {eq,and,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,employeeOnboarding,onboardingChecklists,checklistTasks,onboardingTasks,activityLogs} from '@shared/schema';
export class OnboardingError extends Error{constructor(public status:number,message:string){super(message);}}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const id=z.number().int().positive();
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
  await tx.insert(onboardingTasks).values(tasks.map(task=>{
   const due=new Date(input.startDate+'T00:00:00Z');due.setUTCDate(due.getUTCDate()+task.daysFromStart);
   return {onboardingId:row.id,taskId:task.id,assignedTo:task.assignedTo,dueDate:due.toISOString().slice(0,10),status:'not_started' as const};
  }));
  await tx.insert(activityLogs).values({userId,action:'create',entityType:'employee_onboarding',entityId:row.id,details:'Onboarding checklist started'});
  return row;
 });
}
export async function changeOnboardingTask(taskId:number,body:unknown,userId:number){
 const input=z.object({expectedVersion:id,status:z.enum(['not_started','in_progress','completed']),comments:z.string().trim().max(5000),assigneeId:id.nullable(),dueDate:date}).strict().parse(body);
 return db.transaction(async tx=>{
  const [lookup]=await tx.select().from(onboardingTasks).where(eq(onboardingTasks.id,taskId));
  if(!lookup)throw new OnboardingError(404,'Task not found');
  // Serialize every task change for this checklist before computing progress.
  const [parent]=await tx.select().from(employeeOnboarding).where(eq(employeeOnboarding.id,lookup.onboardingId)).for('update');
  if(parent.status==='cancelled')throw new OnboardingError(409,'Cancelled onboarding cannot be changed');
  const [task]=await tx.select().from(onboardingTasks).where(eq(onboardingTasks.id,taskId)).for('update');
  if(task.version!==input.expectedVersion)throw new OnboardingError(409,'Task changed; reload before saving');
  if(input.assigneeId){
   const [owner]=await tx.select().from(employees).where(eq(employees.id,input.assigneeId)).for('share');
   if(!owner||owner.status!=='active')throw new OnboardingError(400,'Choose an active employee as task owner');
  }
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const {expectedVersion,...values}=input;
  const [row]=await tx.update(onboardingTasks).set({...values,version:task.version+1,completedDate:input.status==='completed'?(task.completedDate||today):null,updatedAt:new Date()}).where(eq(onboardingTasks.id,taskId)).returning();
  const [stats]=await tx.select({total:sql<number>`count(*)::int`,completed:sql<number>`count(*) filter (where status = 'completed')::int`}).from(onboardingTasks).where(eq(onboardingTasks.onboardingId,parent.id));
  const progress=Math.round(stats.completed/stats.total*100),complete=stats.total===stats.completed;
  await tx.update(employeeOnboarding).set({progress,status:complete?'completed':'in_progress',endDate:complete?(parent.endDate||today):null,updatedAt:new Date()}).where(eq(employeeOnboarding.id,parent.id));
  await tx.insert(activityLogs).values({userId,action:'update',entityType:'onboarding_task',entityId:taskId,details:`Task ${input.status}; owner, due date and progress reconciled`});
  return row;
 });
}
