import {eq} from 'drizzle-orm';
import {payroll,payrollTimeLines,workforceTimesheets as sheets,timesheetRevisions} from '@shared/schema';
import {requireApprovedPresence} from './attendance-location';
import {assertUnpaidLeaveUnchanged} from './payroll-leave';
import {addHistory} from './payroll-review';
import {WorkforceError} from './workforce';

// Employee and payroll locks must be held by the caller. Shared by ordinary
// payroll and settlement payment recording so neither bypasses approved time.
export async function recordPayrollPayment(tx:any,row:any,user:any,reference:string){
 if(row.record.status!=='approved')throw new WorkforceError(409,'Only independently approved payroll can be marked paid');
 if(!row.review||row.review.approverId!==user.userId||row.owner===user.userId||row.review.createdBy===user.userId)throw new WorkforceError(403,'The independent designated pay approver must record payment');
 const savedPolicy=row.review.policy as {unpaidLeave?:unknown};
 if(savedPolicy.unpaidLeave!==undefined)await assertUnpaidLeaveUnchanged(tx,row.record.employeeId,{start:row.review.periodStart,end:row.review.periodEnd},savedPolicy.unpaidLeave);
 const lines=await tx.select().from(payrollTimeLines).where(eq(payrollTimeLines.payrollId,row.record.id));
 for(const line of lines){
  const [sheet]=await tx.select().from(sheets).where(eq(sheets.id,line.timesheetId)).for('update');
  if(!sheet)throw new WorkforceError(409,'Included time is unavailable');
  await requireApprovedPresence(tx,sheet.assignmentId,sheet.actualEndAt);
  if(sheet.status!=='approved'||sheet.version!==line.timesheetVersion)throw new WorkforceError(409,'Included time changed; return payroll for reconciliation');
  const [locked]=await tx.update(sheets).set({status:'payroll_locked',payrollId:row.record.id,lockedBy:user.userId,lockedAt:new Date(),version:sheet.version+1,updatedAt:new Date()}).where(eq(sheets.id,sheet.id)).returning();
  await tx.insert(timesheetRevisions).values({timesheetId:sheet.id,version:locked.version,actorId:user.userId,action:'Payroll paid',reason:`Paid through payroll #${row.record.id}`,snapshot:locked});
 }
 const [saved]=await tx.update(payroll).set({status:'processed',wpsReference:reference,processedBy:user.userId,processedAt:new Date(),updatedAt:new Date()}).where(eq(payroll.id,row.record.id)).returning();
 await addHistory(tx,user,row.review,'Payment recorded','External reference: '+reference);
 return saved;
}
