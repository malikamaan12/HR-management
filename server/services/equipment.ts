import { and, eq, or, sql } from 'drizzle-orm';
import { employees } from '@shared/schema';
import { defaultEquipmentPolicy, type EquipmentPolicy, type EquipmentAsset, type EquipmentAssignment } from '@shared/equipment';
import { employeeScope } from './access';
import { WorkflowError, qatarToday } from './workflowRecords';

export const canManageEquipment = (user: {role: string}) => ['admin','super_admin','hr_director','hr'].includes(user.role);
export const equipmentAssetColumns = sql`*, purchase_date::text, warranty_until::text`;
export const equipmentAssignmentColumns = sql`*, issued_on::text, due_on::text, acknowledgement_due_on::text, returned_on::text`;
export const equipmentEmployeeScope = (user: any) => or(eq(employees.userId,user.userId),employeeScope(user,'employee_database'))!;
export const equipmentDaysAfter = (date: string, days: number) => { const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
export async function equipmentPolicy(tx: any): Promise<EquipmentPolicy & {version:number}> {
  const row=(await tx.execute(sql`SELECT version,definition FROM hr_equipment_policies ORDER BY version DESC LIMIT 1`)).rows[0];
  return {...defaultEquipmentPolicy,...(row?.definition||{}),version:row?.version||0};
}
// Called after locking the employee row, so issue and lifecycle completion serialize together.
export async function equipmentClearance(tx: any, employeeId: number) {
  const policy=await equipmentPolicy(tx);
  const row=(await tx.execute(sql`SELECT count(*)::integer AS count FROM hr_equipment_assignments WHERE employee_id=${employeeId} AND status IN ('issued','return_requested')`)).rows[0];
  return {blocked:policy.blockOffboarding&&Number(row.count)>0,openCount:Number(row.count),policyVersion:policy.version};
}
export function requireEquipmentManager(user: any) {
  if(!canManageEquipment(user))throw new WorkflowError(403,'HR inventory administrator access is required');
}
export async function equipmentEmployee(tx: any,user:any,id:number,lock=false) {
  let query=tx.select({id:employees.id,userId:employees.userId,firstName:employees.firstName,lastName:employees.lastName,
    employeeId:employees.employeeId,status:employees.status,joiningDate:employees.joiningDate})
    .from(employees).where(and(eq(employees.id,id),equipmentEmployeeScope(user)));
  if(lock)query=query.for('update');
  const [employee]=await query;
  if(!employee)throw new WorkflowError(404,'Employee not found');
  return employee;
}
export async function equipmentAsset(tx:any,id:number,lock=false):Promise<EquipmentAsset>{
  const row=(await tx.execute(sql`SELECT ${equipmentAssetColumns} FROM hr_equipment_assets WHERE id=${id} ${lock?sql`FOR UPDATE`:sql``}`)).rows[0];
  if(!row)throw new WorkflowError(404,'Equipment asset not found');
  return row;
}
export async function equipmentAssignment(tx:any,user:any,id:number,lock=false):Promise<{row:EquipmentAssignment;employee:any;asset:EquipmentAsset}>{
  // Lock order is employee → asset → custody record everywhere.
  const initial=(await tx.execute(sql`SELECT employee_id,asset_id FROM hr_equipment_assignments WHERE id=${id}`)).rows[0];
  if(!initial)throw new WorkflowError(404,'Equipment assignment not found');
  const employee=await equipmentEmployee(tx,user,initial.employee_id,lock);
  const asset=await equipmentAsset(tx,initial.asset_id,lock);
  const row=(await tx.execute(sql`SELECT ${equipmentAssignmentColumns} FROM hr_equipment_assignments WHERE id=${id} ${lock?sql`FOR UPDATE`:sql``}`)).rows[0];
  return {row,employee,asset};
}
export function requireEquipmentVersion(row:{version:number},version:number){
  if(row.version!==version)throw new WorkflowError(409,'This equipment record changed. Reload it before saving.');
}
export function requireOpenAssignment(row:EquipmentAssignment){
  if(!['issued','return_requested'].includes(row.status))throw new WorkflowError(409,'This custody record is already closed');
}
export function validateLoanDates(issuedOn:string,dueOn:string|null,policy:EquipmentPolicy){
  if(issuedOn>qatarToday())throw new WorkflowError(400,'Equipment can only be issued today or on a past date');
  if(dueOn&&dueOn<issuedOn)throw new WorkflowError(400,'Return due date must be on or after issue date');
  if(policy.maxLoanDays&&(!dueOn||dueOn>equipmentDaysAfter(issuedOn,policy.maxLoanDays)))throw new WorkflowError(400,`The equipment policy requires a return date within ${policy.maxLoanDays} days of issue`);
}
