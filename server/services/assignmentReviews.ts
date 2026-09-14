import {and,eq,gte,inArray,isNull,lt,lte,or,sql,getTableColumns} from 'drizzle-orm';
import {db} from '../db';
import {assignmentReviews as reviews,assignmentReviewHistory as history,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceSites as sites,workforceGrants as grants,workforceTimesheets as timesheets,employees,users} from '@shared/schema';
import {workforceAdmin} from '@shared/workforce';
import {assignmentFields} from './timesheets';
import {currentGrants,fail,teamAccess,type WorkforceTransaction} from './workforce';
import type {TokenPayload} from './auth';
import type {Request} from 'express';
import {z} from 'zod';

export const permissionScope=(user:TokenPayload,permission?:'review_performance'|'review_time')=>workforceAdmin(user.role)?sql`true`:sql`exists (select 1 from ${grants} where ${grants.teamId}=${teams.id} and ${currentGrants(user)} ${permission?sql`and ${grants.permission}=${permission}`:sql``} and ${grants.startAt}<=${shifts.startAt} and ${grants.endAt}>=${shifts.endAt})`;
export const otherEmployee=(user:TokenPayload)=>sql`${employees.userId} IS DISTINCT FROM ${user.userId}`;
export const ownReview=(user:TokenPayload)=>eq(employees.userId,user.userId);
export const reviewScope=(user:TokenPayload)=>or(ownReview(user),permissionScope(user,'review_performance'));
export const verifiedTime=()=>inArray(timesheets.status,['approved','payroll_locked']);
export const candidateFields={...assignmentFields,timesheetId:timesheets.id,workedMinutes:timesheets.workedMinutes,timeStatus:timesheets.status};
export const reviewFields={...candidateFields,...getTableColumns(reviews),authorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`};
export function candidateQuery(tx:WorkforceTransaction){return tx.select(candidateFields).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).innerJoin(timesheets,eq(timesheets.assignmentId,assignments.id)).leftJoin(reviews,eq(reviews.assignmentId,assignments.id));}
export function candidateScope(user:TokenPayload){return and(eq(assignments.status,'accepted'),lte(shifts.endAt,new Date()),verifiedTime(),isNull(reviews.id),otherEmployee(user),permissionScope(user,'review_performance'));}
export function reviewQuery(tx:WorkforceTransaction){return tx.select({...reviewFields,ownerUserId:employees.userId}).from(reviews).innerJoin(assignments,eq(reviews.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).innerJoin(timesheets,eq(timesheets.assignmentId,assignments.id)).innerJoin(users,eq(reviews.authorId,users.id));}
export async function readReview(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false){
  const query=reviewQuery(tx).where(and(eq(reviews.id,id),reviewScope(user)));const [row]=lock?await query.for('update',{of:reviews}):await query;
  return row||fail(404,'Review not found or outside your current access');
}
export async function reviewCandidate(tx:WorkforceTransaction,user:TokenPayload,assignmentId:number,lock=false){
  // Lock the assignment to serialize first publication; eligibility is checked again under the lock.
  if(lock)await tx.select({id:assignments.id}).from(assignments).where(eq(assignments.id,assignmentId)).for('update');
  const [row]=await candidateQuery(tx).where(and(eq(assignments.id,assignmentId),candidateScope(user)));
  if(!row)fail(404,'Choose an unreviewed assignment with approved time inside your review access');
  if(lock){await teamAccess(tx,user,row.teamId,'review_performance',row);
    const [time]=await tx.select({id:timesheets.id}).from(timesheets).where(and(eq(timesheets.id,row.timesheetId),verifiedTime())).for('share');
    if(!time)fail(409,'The assignment time is no longer approved');
  }return row;
}
export function reviewCapabilities(user:TokenPayload,row:Awaited<ReturnType<typeof readReview>>){
  const own=row.ownerUserId===user.userId,active=['published','resolved'].includes(row.status);
  return {respond:own&&active&&row.responseKind===null,dispute:own&&active,resolve:workforceAdmin(user.role)&&!own&&row.authorId!==user.userId&&row.status!=='withdrawn'};
}
export async function recordReviewHistory(tx:WorkforceTransaction,user:TokenPayload,row:typeof reviews.$inferSelect,action:string,reason:string){
  await tx.insert(history).values({reviewId:row.id,version:row.version,actorId:user.userId,action,reason,snapshot:row});
}
export async function changeReview(tx:WorkforceTransaction,user:TokenPayload,row:Awaited<ReturnType<typeof readReview>>,values:Partial<typeof reviews.$inferInsert>,action:string,reason:string){
  const [saved]=await tx.update(reviews).set({...values,version:row.version+1,updatedAt:new Date()}).where(eq(reviews.id,row.id)).returning();
  await recordReviewHistory(tx,user,saved,action,reason);return {id:saved.id,version:saved.version};
}
export function reviewWindow(req:Request){const now=new Date(),midnight=new Date(now.toISOString().slice(0,10)+'T00:00:00Z');
  return z.object({from:z.coerce.date(),to:z.coerce.date()}).refine(v=>v.to>v.from&&+v.to-+v.from<=90*86400000,'Choose a window of up to 90 days').parse({from:req.query.from||new Date(+midnight-30*86400000),to:req.query.to||new Date(+midnight+86400000)});
}
export const withinWindow=(range:{from:Date;to:Date})=>and(gte(shifts.startAt,range.from),lt(shifts.startAt,range.to));
export async function hasReviewGrant(user:TokenPayload,permission:'review_performance'|'review_time',teamId?:number,runner:Pick<WorkforceTransaction,'select'>=db){
  if(workforceAdmin(user.role))return true;
  const [grant]=await runner.select({id:grants.id}).from(grants).where(and(currentGrants(user),eq(grants.permission,permission),teamId?eq(grants.teamId,teamId):undefined)).limit(1);return !!grant;
}
