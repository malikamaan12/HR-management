import {Router} from 'express';
import {and,asc,eq,gt,inArray,isNull,lt,sql} from 'drizzle-orm';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {assignmentReviews as reviews,leaves,leaveSnapshots,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceTimesheets as timesheets,employees} from '@shared/schema';
import {positiveId,localDate} from '@shared/workforce';
import {halfDayWindow,leaveOverlaps} from '@shared/leave-workflow';
import {teamAccess} from '../services/workforce';
import {candidateQuery,candidateScope,reviewWindow,withinWindow,permissionScope,otherEmployee,hasReviewGrant,verifiedTime} from '../services/assignmentReviews';
import {reviewHandle} from './assignmentReviews';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',reviewHandle(async(req,res)=>{
  const teamId=positiveId.parse(req.query.teamId),range=reviewWindow(req),now=new Date(),staffingThrough=new Date(+now+14*86400000);
  const result=await db.transaction(async tx=>{
    const team=await teamAccess(tx,req.user!,teamId,'view');
    const coverage=tx.select({id:shifts.id,role:shifts.role,startAt:shifts.startAt,endAt:shifts.endAt,headcount:shifts.headcount,
      accepted:sql<number>`(select count(*)::int from ${assignments} where ${assignments.shiftId}=${shifts.id} and ${assignments.status}='accepted')`.as('accepted'),
      pending:sql<number>`case when ${shifts.startAt}>${now} then (select count(*)::int from ${assignments} where ${assignments.shiftId}=${shifts.id} and ${assignments.status}='offered') else 0 end`.as('pending'),
    }).from(shifts).innerJoin(teams,eq(shifts.teamId,teams.id)).where(and(eq(teams.id,teamId),eq(shifts.status,'scheduled'),gt(shifts.endAt,now),lt(shifts.startAt,staffingThrough),permissionScope(req.user!))).as('coverage');
    const [staffingCounts]=await tx.select({shifts:sql<number>`count(*)::int`,required:sql<number>`coalesce(sum(${coverage.headcount}),0)::int`,accepted:sql<number>`coalesce(sum(${coverage.accepted}),0)::int`,unfilled:sql<number>`coalesce(sum(greatest(${coverage.headcount}-${coverage.accepted},0)),0)::int`,pendingOffers:sql<number>`coalesce(sum(${coverage.pending}),0)::int`}).from(coverage);
    const gaps=await tx.select({id:coverage.id,role:coverage.role,startAt:coverage.startAt,endAt:coverage.endAt,unfilled:sql<number>`greatest(${coverage.headcount}-${coverage.accepted},0)::int`}).from(coverage).where(sql`${coverage.headcount}>${coverage.accepted}`).orderBy(coverage.startAt,coverage.id).limit(10);
    const today=localDate(now,team.timezone),throughDate=localDate(staffingThrough,team.timezone);
    const absenceCandidates=await tx.select({leaveId:leaves.id,employeeId:leaves.employeeId,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`.as('employee_name'),leaveType:leaves.leaveType,startDate:leaves.startDate,endDate:leaves.endDate,totalDays:leaves.totalDays,snapshot:leaveSnapshots,shiftId:shifts.id,role:shifts.role,shiftStartAt:shifts.startAt,shiftEndAt:shifts.endAt}).from(leaves).leftJoin(leaveSnapshots,eq(leaveSnapshots.leaveId,leaves.id)).innerJoin(employees,eq(leaves.employeeId,employees.id)).innerJoin(assignments,eq(assignments.employeeId,leaves.employeeId)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).where(and(eq(teams.id,teamId),eq(leaves.status,'approved'),eq(assignments.status,'accepted'),eq(shifts.status,'scheduled'),sql`${leaves.startDate} <= ${throughDate}`,sql`${leaves.endDate} >= ${today}`,sql`(${shifts.startAt} AT TIME ZONE ${team.timezone})::date <= ${leaves.endDate}`,sql`((${shifts.endAt}-interval '1 millisecond') AT TIME ZONE ${team.timezone})::date >= ${leaves.startDate}`,gt(shifts.endAt,now),lt(shifts.startAt,staffingThrough),permissionScope(req.user!))).orderBy(asc(shifts.startAt),asc(leaves.id));
    const matchingAbsences=absenceCandidates.filter(row=>leaveOverlaps(row.snapshot,row.startDate,row.endDate,new Date(Math.max(+row.shiftStartAt,+now)),row.shiftEndAt,team.timezone));
    const absences=matchingAbsences.slice(0,50).map(({snapshot,...row})=>{const window=halfDayWindow(snapshot);return {...row,totalDays:Number(row.totalDays),dayPortion:snapshot?.dayPortion||'full',absenceStartAt:window?.start||null,absenceEndAt:window?.end||null};});
    let time=null;
    if(await hasReviewGrant(req.user!,'review_time',teamId,tx)){
      const pendingCondition=and(eq(teams.id,teamId),withinWindow(range),eq(timesheets.status,'submitted'),otherEmployee(req.user!),permissionScope(req.user!,'review_time'));
      const pending=tx.select({id:timesheets.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`.as('employee_name'),role:shifts.role,startAt:shifts.startAt,workedMinutes:timesheets.workedMinutes}).from(timesheets).innerJoin(assignments,eq(timesheets.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).where(pendingCondition).as('pending_time');
      const [total]=await tx.select({count:sql<number>`count(*)::int`}).from(pending);
      const items=await tx.select().from(pending).orderBy(pending.startAt,pending.id).limit(10);time={pending:total.count,items};
    }
    let reviewSummary=null;
    if(await hasReviewGrant(req.user!,'review_performance',teamId,tx)){
      const missingScope=and(eq(teams.id,teamId),withinWindow(range),candidateScope(req.user!));
      const missingQuery=candidateQuery(tx).where(missingScope).as('missing_reviews');const [missing]=await tx.select({count:sql<number>`count(*)::int`}).from(missingQuery);
      const missingItems=await candidateQuery(tx).where(missingScope).orderBy(asc(shifts.startAt),asc(assignments.id)).limit(10);
      const currentScope=and(eq(teams.id,teamId),withinWindow(range),otherEmployee(req.user!),permissionScope(req.user!,'review_performance'));
      const included=and(inArray(reviews.status,['published','resolved']),verifiedTime());
      const [counts]=await tx.select({disputed:sql<number>`count(*) filter (where ${reviews.status}='disputed')::int`,withdrawn:sql<number>`count(*) filter (where ${reviews.status}='withdrawn')::int`,included:sql<number>`count(*) filter (where ${included})::int`,awaitingResponse:sql<number>`count(*) filter (where ${included} and ${isNull(reviews.responseKind)})::int`,unverified:sql<number>`count(*) filter (where ${reviews.status} in ('published','resolved') and not (${verifiedTime()}))::int`})
        .from(reviews).innerJoin(assignments,eq(reviews.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(timesheets,eq(timesheets.assignmentId,assignments.id)).where(currentScope);
      const month=sql<string>`to_char(${shifts.startAt} at time zone 'UTC','YYYY-MM')`;
      const trend=await tx.select({month,reviews:sql<number>`count(*)::int`,punctuality:sql<number|null>`round(avg(${reviews.punctuality}),2)::float8`,punctualityCount:sql<number>`count(${reviews.punctuality})::int`,service:sql<number|null>`round(avg(${reviews.service}),2)::float8`,serviceCount:sql<number>`count(${reviews.service})::int`,teamwork:sql<number|null>`round(avg(${reviews.teamwork}),2)::float8`,teamworkCount:sql<number>`count(${reviews.teamwork})::int`})
        .from(reviews).innerJoin(assignments,eq(reviews.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(timesheets,eq(timesheets.assignmentId,assignments.id)).where(and(currentScope,included,eq(reviews.rubricVersion,1))).groupBy(month).orderBy(month);
      reviewSummary={missing:missing.count,...counts,missingItems,trend};
    }
    return {team,...range,staffingThrough,staffing:{...staffingCounts,gaps,absences,absencesMore:matchingAbsences.length>50},time,reviews:reviewSummary};
  });res.json(result);
}));
export default router;
