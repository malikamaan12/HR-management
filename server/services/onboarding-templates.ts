import {z} from 'zod';
import {eq,and,sql} from 'drizzle-orm';
import {db} from '../db';
import {onboardingChecklists,checklistTasks,activityLogs} from '@shared/schema';
import {OnboardingError} from './onboarding-workflow';
const task=z.object({taskName:z.string().trim().min(2).max(160),description:z.string().trim().max(5000),category:z.string().trim().min(1).max(80),assignedTo:z.string().trim().min(1).max(80),daysFromStart:z.number().int().min(-365).max(730),isRequired:z.boolean()}).strict();
const input=z.object({name:z.string().trim().min(2).max(160),description:z.string().trim().max(5000),departmentSpecific:z.string().trim().max(100),employeeTypeSpecific:z.enum(['','permanent','temporary','contract']),tasks:z.array(task).min(1).max(100),expectedVersion:z.number().int().min(0),reason:z.string().trim().min(5).max(500)}).strict();
export async function saveTemplate(id:number|null,body:unknown,userId:number){
 const data=input.parse(body);
 return db.transaction(async tx=>{
  const values={name:data.name,description:data.description,departmentSpecific:data.departmentSpecific||null,employeeTypeSpecific:data.employeeTypeSpecific||null};
  let row;
  if(id){
   const [current]=await tx.select().from(onboardingChecklists).where(eq(onboardingChecklists.id,id)).for('update');
   if(!current)throw new OnboardingError(404,'Checklist not found');
   if(current.version!==data.expectedVersion)throw new OnboardingError(409,'Checklist changed; reload before saving');
   const oldTasks=await tx.select().from(checklistTasks).where(and(eq(checklistTasks.checklistId,id),eq(checklistTasks.active,true)));
   // Preserve the initial version of legacy templates before the first edit.
   await tx.execute(sql`INSERT INTO onboarding_template_versions(checklist_id,version,snapshot,created_by) VALUES (${id},${current.version},${JSON.stringify({...current,tasks:oldTasks,reason:'Prior version preserved before edit'})}::jsonb,${userId}) ON CONFLICT(checklist_id,version) DO NOTHING`);
   [row]=await tx.update(onboardingChecklists).set({...values,version:current.version+1,updatedAt:new Date()}).where(eq(onboardingChecklists.id,id)).returning();
   await tx.update(checklistTasks).set({active:false}).where(and(eq(checklistTasks.checklistId,id),eq(checklistTasks.active,true)));
  }else{
   if(data.expectedVersion!==0)throw new OnboardingError(409,'New checklists start at version zero');
   [row]=await tx.insert(onboardingChecklists).values(values).returning();
  }
  await tx.insert(checklistTasks).values(data.tasks.map(t=>({...t,checklistId:row.id})));
  await tx.execute(sql`INSERT INTO onboarding_template_versions(checklist_id,version,snapshot,created_by) VALUES (${row.id},${row.version},${JSON.stringify({...row,tasks:data.tasks,reason:data.reason})}::jsonb,${userId})`);
  await tx.insert(activityLogs).values({userId,action:id?'update':'create',entityType:'onboarding_checklist',entityId:row.id,details:'Checklist version '+row.version+' saved'});
  return row;
 });
}
