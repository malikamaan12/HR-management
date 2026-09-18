import {and,eq,sql} from 'drizzle-orm';
import {employees,users} from '@shared/schema';
import {hasPermission} from '@shared/permissions';
import {leaveApprovalChain} from '@shared/leave-workflow';
import {employeeScope} from './access';
import {fail,type WorkforceTransaction} from './workforce';

export async function validateLeaveApprovers(tx:WorkforceTransaction,employee:typeof employees.$inferSelect,chain:Array<number|null>){
 for(const id of chain){if(!id)continue;
  const [user]=await tx.select().from(users).where(and(eq(users.id,id),eq(users.isActive,true),eq(users.approvalStatus,'approved')));
  if(!user||id===employee.userId||!hasPermission(user.role,'leave_absence_management','approve'))fail(409,'An administrator must assign active independent leave approvers');
  const [allowed]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,employee.id),employeeScope({userId:user.id,role:user.role,department:user.department||undefined} as any,'leave_absence_management','approve')));
  if(!allowed)fail(409,'An assigned leave approver cannot access this employee; revise the rule');
 }
}
export async function decideLeaveStage(tx:WorkforceTransaction,userId:number,leave:any,snapshot:any,decision:'approved'|'rejected',reason:string){
 const chain=leaveApprovalChain(snapshot),stage=leave.approvalStage||0;
 if(chain[stage]&&chain[stage]!==userId)fail(403,'Only the current stage approver can decide');
 if(chain.slice(stage+1).includes(userId))fail(403,'Another independent reviewer must complete this stage before your assigned stage');
 const earlier=await tx.execute(sql`SELECT id FROM hr_leave_stage_decisions WHERE leave_id=${leave.id} AND actor_id=${userId}`);
 if(earlier.rows.length)fail(403,'Each approval stage requires a different reviewer');
 await tx.execute(sql`INSERT INTO hr_leave_stage_decisions(leave_id,stage,actor_id,decision,reason) VALUES (${leave.id},${stage},${userId},${decision},${reason})`);
 return stage+1>=chain.length;
}
