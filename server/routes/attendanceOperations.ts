import {Router} from 'express';
import {and,eq,gte,lte,lt,gt,or,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {attendance,employees,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceSites as sites,workforceTimesheets as sheets} from '@shared/schema';
import {civilDate,calculateTime,managementLate} from '@shared/calculation-rules';
import {positiveId} from '@shared/workforce';
import {employeeScope} from '../services/access';
import {calculationSnapshot} from '../services/calculation-rules';
import {lockEmployee,fail,audit} from '../services/workforce';
import {operationsHandle as handle} from './operationsPolicies';
const router=Router();
const period=(req:any)=>z.object({from:civilDate,to:civilDate}).refine(v=>v.to>=v.from&&Date.parse(v.to)-Date.parse(v.from)<90*86400000,'Choose up to 90 days').parse(req.query);
const actual=z.object({checkIn:z.string().datetime({offset:true}),checkOut:z.string().datetime({offset:true}),totalBreakMinutes:z.number().int().min(0).max(1439)}).strict().refine(v=>Date.parse(v.checkOut)>Date.parse(v.checkIn)&&Date.parse(v.checkOut)-Date.parse(v.checkIn)<=86400000&&Date.parse(v.checkOut)<=Date.now()&&(Date.parse(v.checkOut)-Date.parse(v.checkIn))/60000>v.totalBreakMinutes,'Use completed time of up to 24 hours with a shorter break');
router.get('/records',handle(async(req,res)=>{const range=period(req);const rows=await db.select({record:attendance,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,own:sql<boolean>`${employees.userId}=${req.user.userId}`}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id)).where(and(gte(attendance.date,range.from),lte(attendance.date,range.to),employeeScope(req.user,'attendance_time_tracking'))).orderBy(attendance.date,attendance.id).limit(300);res.json(rows);}));
router.get('/corrections',handle(async(req,res)=>{
 const range=period(req);const result=await db.select({id:attendance.id}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id)).where(and(gte(attendance.date,range.from),lte(attendance.date,range.to),or(eq(employees.userId,req.user.userId),employeeScope(req.user,'attendance_time_tracking','approve'))));
 if(!result.length)return res.json([]);
 res.json((await db.execute(sql`SELECT c.*,e.first_name || ' ' || e.last_name AS employee_name,e.user_id=${req.user.userId} AS own FROM attendance_corrections c JOIN employees e ON e.id=c.employee_id WHERE c.attendance_id IN (${sql.join(result.map(r=>sql`${r.id}`),sql`,`)}) ORDER BY c.id DESC LIMIT 300`)).rows);
}));
router.post('/records/:id/corrections',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({version:z.number().int().positive(),proposed:actual,reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{const [person]=await tx.select().from(employees).where(eq(employees.userId,req.user.userId)).for('update');if(!person)fail(404,'Employee link required');
  const [record]=await tx.select().from(attendance).where(and(eq(attendance.id,id),eq(attendance.employeeId,person.id))).for('update');if(!record)fail(404,'Attendance not found');if(record.version!==input.version)fail(409,'Attendance changed; reload');
  if(record.checkIn&&!record.checkOut)fail(409,'Finish the active clock session before requesting a correction');
  if((await tx.execute(sql`SELECT id FROM attendance_corrections WHERE attendance_id=${id} AND status='pending'`)).rows.length)fail(409,'A correction is already pending');
  // A correction belongs to the record date, allowing overnight checkout.
  const timezone=process.env.APP_TIMEZONE||'UTC';if(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.proposed.checkIn))!==record.date)fail(400,'Check-in must belong to the attendance date in '+timezone);
  const row=(await tx.execute(sql`INSERT INTO attendance_corrections(attendance_id,employee_id,original_version,proposed,original,reason,requested_by) VALUES(${id},${person.id},${record.version},${JSON.stringify(input.proposed)}::jsonb,${JSON.stringify(record)}::jsonb,${input.reason},${req.user.userId}) RETURNING id`)).rows[0];await audit(tx,req.user,'attendance_correction',Number(row.id),'Attendance correction requested');return row;
 });res.status(201).json(result);
}));
router.post('/corrections/:id/decide',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({decision:z.enum(['approved','rejected','withdrawn']),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
 await db.transaction(async tx=>{const first=(await tx.execute(sql`SELECT employee_id,attendance_id FROM attendance_corrections WHERE id=${id}`)).rows[0];if(!first)fail(404,'Correction not found');
  const [person]=await tx.select().from(employees).where(and(eq(employees.id,Number(first.employee_id)),input.decision==='withdrawn'?eq(employees.userId,req.user.userId):employeeScope(req.user,'attendance_time_tracking','approve'))).for('update');if(!person)fail(404,'Correction not found');
  if(input.decision!=='withdrawn'&&person.userId===req.user.userId)fail(403,'An independent reviewer must decide your correction');
  const [record]=await tx.select().from(attendance).where(eq(attendance.id,Number(first.attendance_id))).for('update');const row=(await tx.execute(sql`SELECT * FROM attendance_corrections WHERE id=${id} FOR UPDATE`)).rows[0];if(row.status!=='pending')fail(409,'Correction already decided');
  if(input.decision==='approved'){
   if(record.version!==Number(row.original_version))fail(409,'Attendance changed; reject or withdraw this proposal and create a fresh request');
   const proposed=actual.parse(row.proposed),snapshot=record.calculationSnapshot||await calculationSnapshot(person,record.date,tx,true);
   const overlap=await tx.select({id:attendance.id}).from(attendance).where(and(eq(attendance.employeeId,person.id),sql`${attendance.id}<>${record.id}`,lt(attendance.checkIn,new Date(proposed.checkOut)),gt(attendance.checkOut,new Date(proposed.checkIn))));if(overlap.length)fail(409,'Corrected time overlaps another attendance record');
   await tx.execute(sql`SELECT set_config('app.attendance_actor',${String(req.user.userId)},true)`);
   await tx.update(attendance).set({checkIn:new Date(proposed.checkIn),checkOut:new Date(proposed.checkOut),checkInMethod:'manual',checkOutMethod:'manual',totalBreakMinutes:proposed.totalBreakMinutes,totalWorkHours:calculateTime(Math.round((Date.parse(proposed.checkOut)-Date.parse(proposed.checkIn))/60000),proposed.totalBreakMinutes,snapshot.rules.attendance).calculatedMinutes,calculationSnapshot:snapshot,status:managementLate(new Date(proposed.checkIn),snapshot)?'late':'present',breakStartTime:null,breakEndTime:null,updatedAt:new Date()}).where(eq(attendance.id,record.id));
  }
  await tx.execute(sql`UPDATE attendance_corrections SET status=${input.decision},decided_by=${req.user.userId},decision_reason=${input.reason},decided_at=now() WHERE id=${id}`);await audit(tx,req.user,'attendance_correction',id,'Correction '+input.decision);
 });res.json({success:true});
}));
router.get('/records/:id/history',handle(async(req,res)=>{const id=positiveId.parse(req.params.id);const [row]=await db.select({id:attendance.id}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id)).where(and(eq(attendance.id,id),employeeScope(req.user,'attendance_time_tracking')));if(!row)fail(404,'Attendance not found');res.json((await db.execute(sql`SELECT version,snapshot,actor_id,created_at FROM attendance_history WHERE attendance_id=${id} ORDER BY version DESC LIMIT 100`)).rows);}));
router.get('/roster-reconciliation',handle(async(req,res)=>{
 const range=period(req),rows=await db.select({assignmentId:assignments.id,employeeId:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,role:shifts.role,startAt:shifts.startAt,endAt:shifts.endAt,timezone:sites.timezone,team:teams.name,sheetId:sheets.id,timeStatus:sheets.status,actualStartAt:sheets.actualStartAt,actualEndAt:sheets.actualEndAt,breakMinutes:sheets.breakMinutes}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).leftJoin(sheets,eq(sheets.assignmentId,assignments.id)).where(and(eq(assignments.status,'accepted'),lte(shifts.endAt,new Date()),gte(shifts.startAt,new Date(range.from+'T00:00:00Z')),lt(shifts.startAt,new Date(Date.parse(range.to)+86400000)),employeeScope(req.user,'attendance_time_tracking'))).orderBy(shifts.startAt,assignments.id).limit(300);
 const result=[];for(const r of rows){const clocks=await db.select({id:attendance.id,version:attendance.version,checkIn:attendance.checkIn,checkOut:attendance.checkOut,totalBreakMinutes:attendance.totalBreakMinutes}).from(attendance).where(and(eq(attendance.employeeId,r.employeeId),lt(attendance.checkIn,r.endAt),or(gt(attendance.checkOut,r.startAt),sql`${attendance.checkOut} IS NULL`)));
  const exact=clocks.length===1&&r.actualStartAt&&r.actualEndAt&&clocks[0].checkIn?.getTime()===r.actualStartAt.getTime()&&clocks[0].checkOut?.getTime()===r.actualEndAt.getTime()&&clocks[0].totalBreakMinutes===r.breakMinutes;
  result.push({...r,clocks,issue:!clocks.length?'No overlapping clock record':!r.sheetId?'Timesheet missing':exact?'Clock and timesheet match':'Review clock / timesheet difference'});
 }res.json(result);
}));
export default router;
