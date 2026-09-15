import {and,desc,eq,isNull,lte,or} from 'drizzle-orm';
import {workforceArrivalRules as rules,workforcePresence as presence,workforceAssignments as assignments} from '@shared/schema';
import {arrivalRules,defaultArrivalRules} from '@shared/workforce-operations';
import {fail,type WorkforceTransaction} from './workforce';

export async function arrivalPolicy(tx:WorkforceTransaction,teamId:number,employeeId:number,at=new Date()) {
  const rows=await tx.select().from(rules).where(and(eq(rules.teamId,teamId),lte(rules.effectiveAt,at),or(isNull(rules.employeeId),eq(rules.employeeId,employeeId))))
    .orderBy(desc(rules.effectiveAt),desc(rules.id));
  const selected=rows.find(r=>r.employeeId===employeeId)||rows.find(r=>r.employeeId===null);
  return {id:selected?.id||null,rules:arrivalRules.parse(selected?.rules||defaultArrivalRules)};
}
// Every caller already holds the shift lock, shared with mobile arrival writes.
export async function assertNoRecordedArrival(tx:WorkforceTransaction,shiftId:number,assignmentId?:number) {
  const [recorded]=await tx.select({id:presence.id}).from(presence).innerJoin(assignments,eq(presence.assignmentId,assignments.id))
    .where(and(eq(assignments.shiftId,shiftId),assignmentId?eq(assignments.id,assignmentId):undefined)).limit(1);
  if(recorded)fail(409,'Arrival has been recorded. Preserve this assignment and use the operational log for follow-up.');
}
export const presenceFields={id:presence.id,assignmentId:presence.assignmentId,version:presence.version,arrivedAt:presence.arrivedAt,departedAt:presence.departedAt,
  departureReason:presence.departureReason,flags:presence.flags,reviewedAt:presence.reviewedAt,reviewNote:presence.reviewNote};
