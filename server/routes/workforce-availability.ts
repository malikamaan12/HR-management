import {Router} from 'express';
import {and,desc,eq,gt,isNull,lt,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,workforceAvailabilitySeries as series,workforceUnavailable as unavailable,workforceAssignments as assignments,workforceShifts as shifts} from '@shared/schema';
import {positiveId,workforceAdmin} from '@shared/workforce';
import {availabilityPattern,availabilitySeriesInput,expandAvailability,type AvailabilityPattern} from '@shared/workforce-renewals';
import {staffingReason} from '@shared/workforce-staffing';
import {audit,fail,type WorkforceTransaction} from '../services/workforce';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';

const router=Router();
async function employeeAccess(tx:WorkforceTransaction,user:TokenPayload,id:number){
  const [employee]=await tx.select().from(employees).where(and(eq(employees.id,id),workforceAdmin(user.role)?undefined:eq(employees.userId,user.userId))).for('update');
  return employee||fail(404,'Employee not found or outside your access');
}
async function preview(tx:WorkforceTransaction,id:number,pattern:AvailabilityPattern){
  let rows:ReturnType<typeof expandAvailability>;try{rows=expandAvailability(pattern);}catch(e){return fail(400,e instanceof Error?e.message:'Invalid pattern');}
  const start=rows[0].startAt,end=rows[rows.length-1].endAt;
  const blocked=await tx.select({startAt:unavailable.startAt,endAt:unavailable.endAt}).from(unavailable).where(and(eq(unavailable.employeeId,id),isNull(unavailable.cancelledAt),lt(unavailable.startAt,end),gt(unavailable.endAt,start)));
  const accepted=await tx.select({startAt:shifts.startAt,endAt:shifts.endAt}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).where(and(eq(assignments.employeeId,id),eq(assignments.status,'accepted'),lt(shifts.startAt,end),gt(shifts.endAt,start)));
  const overlaps=(a:{startAt:Date;endAt:Date},b:{startAt:Date;endAt:Date})=>a.startAt<b.endAt&&a.endAt>b.startAt;
  return rows.map(row=>({...row,issue:row.startAt<=new Date()?'Every occurrence must start in the future':blocked.some(b=>overlaps(row,b))?'Overlaps existing unavailability':accepted.some(b=>overlaps(row,b))?'An accepted shift must be released or replaced first':null}));
}
router.post('/staffing/employees/:id/availability-series/preview',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),pattern=availabilityPattern.parse(req.body);
  res.json(await db.transaction(async tx=>{const employee=await employeeAccess(tx,req.user!,id);if(employee.status!=='active')fail(409,'Choose an active employee');return {occurrences:await preview(tx,id,pattern)};}));
}));
router.post('/staffing/employees/:id/availability-series',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=availabilitySeriesInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    const employee=await employeeAccess(tx,req.user!,id);
    const [existing]=await tx.select().from(series).where(and(eq(series.employeeId,id),eq(series.requestKey,input.requestKey)));
    if(existing){if(JSON.stringify(availabilityPattern.parse(existing.pattern))!==JSON.stringify(input.pattern))fail(409,'This request key was already used with a different pattern');return {id:existing.id,replayed:true};}
    if(employee.status!=='active')fail(409,'Choose an active employee');
    const rows=await preview(tx,id,input.pattern),conflict=rows.find(r=>r.issue);if(conflict)fail(409,conflict.issue!);
    const [saved]=await tx.insert(series).values({...input,employeeId:id,createdBy:req.user!.userId}).returning();
    await tx.insert(unavailable).values(rows.map(({startAt,endAt})=>({startAt,endAt,seriesId:saved.id,employeeId:id,note:input.pattern.note,createdBy:req.user!.userId})));
    await audit(tx,req.user!,'availability_series',saved.id,'Recurring unavailable periods recorded');return {id:saved.id,count:rows.length,replayed:false};
  });res.status(result.replayed?200:201).json(result);
}));
router.get('/staffing/employees/:id/availability-series',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),page=req.query.page?positiveId.parse(req.query.page):1;
  res.json(await db.transaction(async tx=>{
    await employeeAccess(tx,req.user!,id);
    const rows=await tx.select({id:series.id,pattern:series.pattern,createdAt:series.createdAt,stoppedAt:series.stoppedAt,stopReason:series.stopReason,
      futureCount:sql<number>`(select count(*)::int from workforce_unavailable u where u.series_id=${series.id} and u.cancelled_at is null and u.start_at > now())`})
      .from(series).where(eq(series.employeeId,id)).orderBy(desc(series.id)).limit(21).offset((page-1)*20);
    return {series:rows.slice(0,20),hasMore:rows.length>20};
  }));
}));
router.get('/staffing/availability-series/:id',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id);
  res.json(await db.transaction(async tx=>{
    const [row]=await tx.select().from(series).where(eq(series.id,id));if(!row)fail(404,'Pattern not found');await employeeAccess(tx,req.user!,row.employeeId);
    return {series:row,occurrences:await tx.select({id:unavailable.id,startAt:unavailable.startAt,endAt:unavailable.endAt,cancelledAt:unavailable.cancelledAt,cancellationReason:unavailable.cancellationReason}).from(unavailable).where(eq(unavailable.seriesId,id)).orderBy(unavailable.startAt)};
  }));
}));
router.post('/staffing/availability-series/:id/stop',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{reason}=staffingReason.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [initial]=await tx.select().from(series).where(eq(series.id,id));if(!initial)fail(404,'Pattern not found');await employeeAccess(tx,req.user!,initial.employeeId);
    const [row]=await tx.select().from(series).where(eq(series.id,id)).for('update');if(row.stoppedAt)return {success:true};
    const now=new Date();
    await tx.update(unavailable).set({cancelledAt:now,cancelledBy:req.user!.userId,cancellationReason:reason}).where(and(eq(unavailable.seriesId,id),gt(unavailable.startAt,now),isNull(unavailable.cancelledAt)));
    await tx.update(series).set({stoppedAt:now,stoppedBy:req.user!.userId,stopReason:reason}).where(eq(series.id,id));
    await audit(tx,req.user!,'availability_series',id,'Future unavailable occurrences stopped');return {success:true};
  }));
}));
export default router;
