import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {OnboardingError} from './onboarding-workflow';
import {civilDate} from '@shared/calculation-rules';
import {recordId,shortText} from './workplaceRecords';

// Clearance applies only to the specifically reviewed completed exit cases.
// A later exit or a revoked clearance always blocks fresh equipment issuance.
export async function blockingExits(tx:any,employeeId:number,issueDate:string){
 // PostgreSQL now() is the transaction start, possibly before a waited-on exit
 // completes. Match the reviewed version instead of comparing those clocks.
 const r=await tx.execute(sql`SELECT o.id,o.version,o.status,o.completed_at,to_char(o.completed_at AT TIME ZONE 'Asia/Qatar','YYYY-MM-DD') AS completed_date FROM offboarding_cases o WHERE o.employee_id=${employeeId} AND (o.status='open' OR (o.status='completed' AND NOT EXISTS(SELECT 1 FROM return_work_clearances c WHERE c.employee_id=o.employee_id AND c.status='approved' AND o.id=ANY(c.exit_ids) AND c.return_date<=${issueDate}::date AND c.exit_snapshot @> jsonb_build_array(jsonb_build_object('id',o.id,'version',o.version))))) ORDER BY o.id`);
 return r.rows as any[];
}
export const exitTaskSchema=z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),title:z.string().trim().min(2).max(160),kind:z.enum(['checklist','asset']),daysFromExit:z.number().int().min(-365).max(365)}).strict();
export const exitTemplateSchema=z.object({name:shortText,employeeTypes:z.array(z.enum(['permanent','temporary','contract'])).min(1).max(3).refine(v=>new Set(v).size===v.length,'Remove duplicate employment types'),enabled:z.boolean(),tasks:z.array(exitTaskSchema).min(1).max(100).refine(v=>new Set(v.map(t=>t.key)).size===v.length,'Task keys must be unique')}).strict();
export const fromExitTemplateSchema=z.object({employeeId:recordId,reason:z.string().trim().min(5).max(1000),templateId:recordId,templateVersion:recordId,targetExitDate:civilDate,owners:z.array(z.object({key:exitTaskSchema.shape.key,ownerId:recordId}).strict()).min(1).max(100)}).strict();
export async function expandExitTemplate(tx:any,input:z.infer<typeof fromExitTemplateSchema>,employeeType:string){
 const rows=await tx.execute(sql`SELECT * FROM exit_checklist_templates WHERE id=${input.templateId} FOR SHARE`),row=rows.rows[0] as any;
 if(!row||!row.enabled||row.version!==input.templateVersion)throw new OnboardingError(409,'Template changed or is disabled; reload before starting the case');
 if(!row.employee_types.includes(employeeType))throw new OnboardingError(400,'Template does not apply to this employment type');
 const owners=new Map(input.owners.map(o=>[o.key,o.ownerId]));
 if(owners.size!==input.owners.length||owners.size!==row.tasks.length||row.tasks.some((t:any)=>!owners.has(t.key)))throw new OnboardingError(400,'Assign exactly one owner to each template task');
 const tasks=row.tasks.map((t:any)=>({title:t.title,kind:t.kind,ownerId:owners.get(t.key),dueDate:new Date(Date.parse(input.targetExitDate)+t.daysFromExit*86400000).toISOString().slice(0,10),status:'pending',notes:''}));
 return {tasks,snapshot:row};
}
