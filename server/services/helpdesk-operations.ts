import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { employees, users, helpdeskPolicies as policies } from '@shared/schema';
import { helpdeskResponder, helpdeskTriage } from '@shared/helpdesk';
import { reject, type HelpdeskTransaction } from './helpdesk';
import type { HelpdeskAutomationPolicy } from '@shared/helpdesk-automation';
import { helpdeskDeadline } from './helpdesk-automation';

export async function validHandler(tx:HelpdeskTransaction,userId:number|null,confidential:boolean,requesterId?:number){
  if(!userId||userId===requesterId)return null;
  const [user]=await tx.select({id:users.id,role:users.role}).from(users).where(and(eq(users.id,userId),eq(users.isActive,true),eq(users.approvalStatus,'approved'))).for('share');
  // Automatic confidential routing is restricted to directors/system owners. An explicit case assignment can grant another responder access.
  return user&&helpdeskResponder(user.role)&&(!confidential||helpdeskTriage(user.role,true))?user:null;
}
export async function requireHandler(tx:HelpdeskTransaction,userId:number|null,confidential:boolean){
  if(userId&&!await validHandler(tx,userId,confidential))reject(400,confidential?'Choose an active HR director or system owner for confidential routing':'Choose an active HR responder');
}
export async function casePolicy(tx:HelpdeskTransaction,requesterId:number,category:string,confidential:boolean,now:Date,automation?:HelpdeskAutomationPolicy){
  const [employee]=await tx.select({id:employees.id}).from(employees).where(eq(employees.userId,requesterId));
  const rows=await tx.select().from(policies).where(and(eq(policies.category,category),eq(policies.confidential,confidential),lte(policies.effectiveAt,now),
    employee?or(isNull(policies.employeeId),eq(policies.employeeId,employee.id)):isNull(policies.employeeId))).orderBy(desc(policies.effectiveAt),desc(policies.id));
  const policy=rows.find(p=>employee&&p.employeeId===employee.id)||rows.find(p=>p.employeeId===null);
  if(!policy?.enabled)return {};
  const handler=await validHandler(tx,policy.defaultAssigneeId,confidential,requesterId);
  return {assigneeId:handler?.id||null,status:handler?'in_progress' as const:'open' as const,
    policySnapshot:{policyId:policy.id,firstResponseHours:policy.firstResponseHours,resolutionHours:policy.resolutionHours,escalationAssigneeId:policy.escalationAssigneeId},
    firstResponseDueAt:helpdeskDeadline(now,policy.firstResponseHours,automation),resolutionDueAt:helpdeskDeadline(now,policy.resolutionHours,automation)};
}
