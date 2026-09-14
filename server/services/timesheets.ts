import {and,eq,gt,lt,ne,inArray,or,sql} from 'drizzle-orm';
import {workforceTimesheets as sheets,timesheetRevisions as revisions,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceSites as sites,workforceGrants as grants,employees} from '@shared/schema';
import {workforceAdmin} from '@shared/workforce';
import {payrollTimeAccess} from '@shared/timesheets';
import {currentGrants,fail,lockEmployee,teamAccess,type WorkforceTransaction} from './workforce';
import type {TokenPayload} from './auth';

export const assignmentFields={assignmentId:assignments.id,employeeId:employees.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,teamId:teams.id,teamName:teams.name,siteName:sites.name,timezone:sites.timezone,role:shifts.role,startAt:shifts.startAt,endAt:shifts.endAt,plannedBreakMinutes:shifts.breakMinutes};
export const sheetFields={...assignmentFields,calculationSnapshot:sheets.calculationSnapshot,id:sheets.id,status:sheets.status,version:sheets.version,actualStartAt:sheets.actualStartAt,actualEndAt:sheets.actualEndAt,breakMinutes:sheets.breakMinutes,workedMinutes:sheets.workedMinutes,employeeNote:sheets.employeeNote,payableMinutes:sheets.payableMinutes,policyReference:sheets.policyReference,reviewNote:sheets.reviewNote,reviewedAt:sheets.reviewedAt,submittedAt:sheets.submittedAt,payrollId:sheets.payrollId,lockedAt:sheets.lockedAt,updatedAt:sheets.updatedAt};
export const reviewScope=(user:TokenPayload)=>workforceAdmin(user.role)?sql`true`:sql`exists (select 1 from ${grants} where ${grants.teamId}=${teams.id} and ${grants.permission}='review_time' and ${currentGrants(user)} and ${grants.startAt}<=${shifts.startAt} and ${grants.endAt}>=${shifts.endAt})`;
export const ownScope=(user:TokenPayload)=>eq(employees.userId,user.userId);
export const paidStatuses=()=>inArray(sheets.status,['approved','payroll_locked']);
export const sheetScope=(user:TokenPayload)=>or(ownScope(user),and(ne(sheets.status,'draft'),reviewScope(user)),payrollTimeAccess(user.role,'read')?paidStatuses():undefined);
export function sheetQuery(tx:WorkforceTransaction){return tx.select({...sheetFields,ownerUserId:employees.userId}).from(sheets).innerJoin(assignments,eq(sheets.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id));}
export async function readSheet(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false){
  const query=sheetQuery(tx).where(and(eq(sheets.id,id),sheetScope(user)));
  const [row]=lock?await query.for('update',{of:sheets}):await query;
  return row||fail(404,'Timesheet not found or outside your current access');
}
export function checkVersion(row:{version:number},version:number){if(row.version!==version)fail(409,'This timesheet changed. Refresh and review the latest version.');}
export function validateActuals(input:{actualStartAt:Date;actualEndAt:Date;breakMinutes:number},shift:{startAt:Date;endAt:Date}){
  const elapsed=(+input.actualEndAt-+input.actualStartAt)/60000;
  if(!Number.isInteger(elapsed)||elapsed<=0||elapsed>1440||input.breakMinutes>=elapsed)fail(400,'Actual time must be up to 24 hours with breaks shorter than the duration');
  if(input.actualEndAt>new Date()||shift.endAt>new Date())fail(409,'Report completed work after the scheduled shift has ended');
  if(input.actualStartAt>=shift.endAt||input.actualEndAt<=shift.startAt)fail(400,'Actual time must overlap this assignment');
  return elapsed-input.breakMinutes;
}
export async function assertTimeOverlap(tx:WorkforceTransaction,row:Awaited<ReturnType<typeof readSheet>>){
  await lockEmployee(tx,row.employeeId);
  const [overlap]=await tx.select({id:sheets.id}).from(sheets).innerJoin(assignments,eq(sheets.assignmentId,assignments.id)).where(and(eq(assignments.employeeId,row.employeeId),ne(sheets.id,row.id),inArray(sheets.status,['submitted','approved','payroll_locked']),lt(sheets.actualStartAt,row.actualEndAt),gt(sheets.actualEndAt,row.actualStartAt))).limit(1);
  if(overlap)fail(409,'Reported time overlaps another submitted or approved timesheet. Correct the overlapping hours first.');
}
export async function requireReviewer(tx:WorkforceTransaction,user:TokenPayload,row:Awaited<ReturnType<typeof readSheet>>){
  if(row.ownerUserId===user.userId)fail(403,'You cannot review your own timesheet');
  await teamAccess(tx,user,row.teamId,'review_time',row);
}
export async function recordRevision(tx:WorkforceTransaction,user:TokenPayload,row:typeof sheets.$inferSelect,action:string,reason:string){
  // Store a complete snapshot in the same transaction; there is no revision update/delete API.
  await tx.insert(revisions).values({timesheetId:row.id,version:row.version,actorId:user.userId,action,reason,snapshot:row});
}
export async function changeSheet(tx:WorkforceTransaction,user:TokenPayload,row:Awaited<ReturnType<typeof readSheet>>,values:Partial<typeof sheets.$inferInsert>,action:string,reason:string){
  const [saved]=await tx.update(sheets).set({...values,version:row.version+1,updatedAt:new Date()}).where(eq(sheets.id,row.id)).returning();
  await recordRevision(tx,user,saved,action,reason);return {id:saved.id,version:saved.version};
}
