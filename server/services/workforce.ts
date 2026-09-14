import {and, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, sql} from 'drizzle-orm';
import {db} from '../db';
import {employees, leaves, shiftSchedules, eventStaffAssignments, workforceAssignments as assignments,
  workforceGrants as grants, workforceMembers as members, workforceShifts as shifts, workforceTeams as teams, workforceSites as sites, activityLogs, employeeSkills} from '@shared/schema';
import {localDate, workforceAdmin} from '@shared/workforce';
import type {TokenPayload} from './auth';

export type WorkforceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class WorkforceError extends Error {constructor(public status: number, message: string) {super(message);}}
export function fail(status: number, message: string): never {throw new WorkforceError(status, message);}
export function requireWorkforceAdmin(user:TokenPayload) {
  if (!workforceAdmin(user.role)) fail(403, 'HR administrator access is required');
}
export const currentGrants = (user:TokenPayload, now = new Date()) => and(eq(grants.userId,user.userId),isNull(grants.revokedAt),lte(grants.startAt,now),gt(grants.endAt,now));
export async function teamAccess(tx:WorkforceTransaction, user:TokenPayload, teamId:number, permission:'view'|'schedule'|'review_time'|'review_performance', window?:{startAt:Date;endAt:Date}) {
  const [team] = await tx.select({id:teams.id,name:teams.name,kind:teams.kind,siteId:teams.siteId,siteName:sites.name,timezone:sites.timezone})
    .from(teams).innerJoin(sites,eq(teams.siteId,sites.id)).where(eq(teams.id,teamId));
  if (!team) return fail(404,'Team not found');
  if (!workforceAdmin(user.role)) {
    // Lock grants for writes so revocation and a scheduling action have a definite order.
    const query = tx.select().from(grants).where(and(eq(grants.teamId,teamId),currentGrants(user),
      permission!=='view'?eq(grants.permission,permission):undefined,
      window?lte(grants.startAt,window.startAt):undefined, window?gte(grants.endAt,window.endAt):undefined));
    const rows = permission!=='view'?await query.for('update'):await query;
    if (!rows.length) return fail(404,'Team or shift is outside your current access');
  }
  return team;
}
export async function lockEmployee(tx:WorkforceTransaction, employeeId:number) {
  const [employee] = await tx.select().from(employees).where(eq(employees.id,employeeId)).for('update');
  if (!employee) return fail(404,'Employee not found');
  return employee;
}
export async function assertNoWorkforceConflict(tx:WorkforceTransaction, employeeId:number, startAt:Date, endAt:Date, excludeId?:number) {
  const [conflict] = await tx.select({id:assignments.id}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id))
    .where(and(eq(assignments.employeeId,employeeId),eq(assignments.status,'accepted'),lt(shifts.startAt,endAt),gt(shifts.endAt,startAt),
      excludeId?ne(assignments.id,excludeId):undefined)).limit(1);
  if (conflict) fail(409,'Employee already has an accepted workforce shift at this time');
}
export async function assertLeaveCompatible(tx:WorkforceTransaction, employeeId:number, startDate:string, endDate:string) {
  const rows = await tx.select({startAt:shifts.startAt,endAt:shifts.endAt,timezone:sites.timezone}).from(assignments)
    .innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id))
    .where(and(eq(assignments.employeeId,employeeId),eq(assignments.status,'accepted')));
  if (rows.some(s=>localDate(s.startAt,s.timezone)<=endDate && localDate(new Date(+s.endAt-1),s.timezone)>=startDate))
    fail(409,'Cancel the overlapping accepted workforce assignment before approving leave');
}
export async function eligible(tx:WorkforceTransaction, employeeId:number, shift:typeof shifts.$inferSelect, timezone:string, excludeId?:number) {
  const employee = await lockEmployee(tx,employeeId);
  const startDate=localDate(shift.startAt,timezone),endDate=localDate(new Date(+shift.endAt-1),timezone);
  if (employee.status!=='active' || employee.joiningDate>startDate || (employee.contractEndDate && employee.contractEndDate<endDate)
    || (employee.terminationDate && employee.terminationDate<=endDate)) fail(409,'Employee is not active for the full shift dates');
  const [member] = await tx.select({id:members.id}).from(members).where(and(eq(members.teamId,shift.teamId),eq(members.employeeId,employeeId),
    lte(members.startAt,shift.startAt),gte(members.endAt,shift.endAt))).limit(1);
  if (!member) fail(409,'Employee must belong to this team for the entire shift');
  const [leave] = await tx.select({id:leaves.id}).from(leaves).where(and(eq(leaves.employeeId,employeeId),eq(leaves.status,'approved'),
    lte(leaves.startDate,endDate),gte(leaves.endDate,startDate))).limit(1);
  if (leave) fail(409,'Employee has approved leave during this shift');
  if (shift.requiredSkills?.length) {
    const skills = await tx.select({skillId: employeeSkills.skillId, certificationExpiry: employeeSkills.certificationExpiry})
      .from(employeeSkills).where(and(eq(employeeSkills.employeeId, employeeId), inArray(employeeSkills.skillId, shift.requiredSkills)));
    const valid = new Set(skills.filter(skill => !skill.certificationExpiry || skill.certificationExpiry >= shift.endAt).map(skill => skill.skillId));
    if (shift.requiredSkills.some(skillId => !valid.has(skillId))) fail(409,'Employee does not hold all skills required for this shift');
  }
  await assertNoWorkforceConflict(tx,employeeId,shift.startAt,shift.endAt,excludeId);
  const [legacyShift] = await tx.select({id:shiftSchedules.id}).from(shiftSchedules).where(and(eq(shiftSchedules.employeeId,employeeId),
    lt(shiftSchedules.startTime,shift.endAt),gt(shiftSchedules.endTime,shift.startAt))).limit(1);
  const [legacyEvent] = await tx.select({id:eventStaffAssignments.id}).from(eventStaffAssignments).where(and(eq(eventStaffAssignments.employeeId,employeeId),
    notInArray(eventStaffAssignments.status,['declined','cancelled','no_show']),lt(eventStaffAssignments.startTime,shift.endAt),gt(eventStaffAssignments.endTime,shift.startAt))).limit(1);
  if (legacyShift || legacyEvent) fail(409,'Employee has an overlapping schedule in Attendance or Event Staff');
}
export async function audit(tx:WorkforceTransaction,user:TokenPayload,entityType:string,entityId:number,details:string) {
  await tx.insert(activityLogs).values({userId:user.userId,action:'update',entityType:'workforce_'+entityType,entityId,details});
}
export const capacityCount = async (tx:WorkforceTransaction,shiftId:number) => {
  const [row] = await tx.select({count:sql<number>`count(*)::int`}).from(assignments).where(and(eq(assignments.shiftId,shiftId),eq(assignments.status,'accepted')));
  return row.count;
};
