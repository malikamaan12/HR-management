import { createHash } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { employees } from '@shared/schema';
import type { HandbookPolicy } from '@shared/handbook';
import { employeeScope } from './access';
import { WorkflowError, qatarToday } from './workflowRecords';

export const canPublishHandbook=(role:string)=>['admin','super_admin','hr_director','hr'].includes(role);
export const canManageHandbook=(role:string)=>canPublishHandbook(role)||role==='hr_manager';
export const handbookHash=(body:string)=>createHash('sha256').update(body,'utf8').digest('hex');
export const handbookAssignmentScope=(user:any)=>or(eq(employees.userId,user.userId),canManageHandbook(user.role)?employeeScope(user,'compliance_documents'):sql`false`)!;
export const requireHandbookManager=(user:any)=>{if(!canManageHandbook(user.role))throw new WorkflowError(403,'HR management access required');};
export const requireHandbookPublisher=(user:any)=>{if(!canPublishHandbook(user.role))throw new WorkflowError(403,'Handbook publishing access required');};
export function handbookVersion(actual:number,expected:number){if(actual!==expected)throw new WorkflowError(409,'This record changed; reload before saving');}
export async function handbookPolicy(tx:any):Promise<HandbookPolicy>{
  const result=await tx.execute(sql`SELECT version,default_due_days AS "defaultDueDays",required_by_default AS "requiredByDefault",acknowledgement_text AS "acknowledgementText" FROM hr_handbook_policies ORDER BY version DESC LIMIT 1`);
  return result.rows[0]||{version:0,defaultDueDays:14,requiredByDefault:true,acknowledgementText:'I confirm that I have read and understood this version of the handbook.'};
}
export async function handbookEmployee(tx:any,user:any,id:number,manage=false,lock=false){
  let query=tx.select({id:employees.id,userId:employees.userId,firstName:employees.firstName,lastName:employees.lastName,status:employees.status,terminationDate:employees.terminationDate}).from(employees).where(and(eq(employees.id,id),manage?employeeScope(user,'compliance_documents'):handbookAssignmentScope(user)));
  const [employee]=lock?await query.for('update'):await query;
  if(!employee)throw new WorkflowError(404,'Employee not found');return employee;
}
export function requireHandbookEmployed(employee:any){if(['inactive','terminated'].includes(employee.status)||employee.terminationDate&&String(employee.terminationDate).slice(0,10)<=qatarToday())throw new WorkflowError(409,'This employee is no longer active');}
export async function handbookAssignment(tx:any,user:any,id:number,lock=false){
  const initial=(await tx.execute(sql`SELECT employee_id FROM hr_handbook_assignments WHERE id=${id}`)).rows[0];
  if(!initial)throw new WorkflowError(404,'Handbook assignment not found');
  const employee=await handbookEmployee(tx,user,Number(initial.employee_id),false,lock);
  const result=lock?await tx.execute(sql`SELECT * FROM hr_handbook_assignments WHERE id=${id} FOR UPDATE`):await tx.execute(sql`SELECT * FROM hr_handbook_assignments WHERE id=${id}`);
  const row=result.rows[0];if(!row)throw new WorkflowError(404,'Handbook assignment not found');
  const edition=(await tx.execute(sql`SELECT * FROM hr_handbook_editions WHERE id=${row.edition_id}`)).rows[0];
  if(!edition||edition.status!=='published'||edition.body_hash!==row.body_hash)throw new WorkflowError(409,'Published handbook evidence is unavailable');
  return {row,employee,edition};
}
// Lifecycle completion can use this helper to identify required acknowledgements.
export async function pendingHandbookAssignments(tx:any,employeeId:number){return (await tx.execute(sql`SELECT a.id,a.edition_id,a.due_date,e.title,e.edition_number FROM hr_handbook_assignments a JOIN hr_handbook_editions e ON e.id=a.edition_id WHERE a.employee_id=${employeeId} AND a.required=true AND a.status='pending' ORDER BY a.due_date,a.id`)).rows;}
