import operations from './attendanceOperations';
import policies from './operationsPolicies';
import { Router } from 'express';
import { and, eq, gte, lte, sql, or, isNull, isNotNull, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { attendance, employees, activityLogs, insertAttendanceSchema } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { attendanceDate, clockAttendance } from '../services/attendance';
import {calculationSnapshot} from '../services/calculation-rules';
import {calculateTime,managementLate} from '@shared/calculation-rules';
const router=Router();router.use(authenticate);router.use('/policies',policies);router.use(operations);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value);
router.get('/today',async(req,res)=>{
  try{const [row]=await db.select({record:attendance}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id))
    .where(and(eq(employees.userId,req.user!.userId),or(eq(attendance.date,attendanceDate()),and(isNotNull(attendance.checkIn),isNull(attendance.checkOut))))).orderBy(desc(attendance.checkIn));return res.json(row?.record || null);
  }catch{return res.status(500).json({message:'Unable to load attendance'});}
});
for(const action of ['in','out','break_start','break_end'] as const)router.post('/clock-'+action,async(req,res)=>{
  try{const input=z.object({location:z.string().max(300).optional(),notes:z.string().max(2000).optional()}).parse(req.body);
    return res.json(await clockAttendance(req.user!.userId,action,input.location,input.notes));
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Clock action failed'});}
});
router.get('/date/:date',async(req,res)=>{
  try{const day=date.parse(req.params.date);const rows=await db.select({record:attendance,firstName:employees.firstName,lastName:employees.lastName}).from(attendance)
    .innerJoin(employees,eq(attendance.employeeId,employees.id)).where(and(eq(attendance.date,day),employeeScope(req.user!,'attendance_time_tracking')));
    return res.json(rows.map(({record,firstName,lastName})=>({...record,employeeName:`${firstName} ${lastName}`})));
  }catch{return res.status(400).json({message:'Unable to load attendance'});}
});
router.post('/',async(req,res)=>{
  try{const input=insertAttendanceSchema.omit({version:true}).parse({...req.body,employeeId:Number(req.body.employeeId),checkIn:req.body.checkIn?new Date(req.body.checkIn):null,checkOut:req.body.checkOut?new Date(req.body.checkOut):null});
    const [employee]=await db.select({id:employees.id,userId:employees.userId,workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,input.employeeId),employeeScope(req.user!,'attendance_time_tracking','update')));
    if(!employee||employee.userId===req.user!.userId)return res.status(403).json({message:'Use the clock or request an independent correction for your own attendance'});
    if(input.checkIn && input.checkOut && input.checkOut<input.checkIn)return res.status(400).json({message:'Check-out must follow check-in'});
    const result=await db.transaction(async tx=>{
      await tx.select({id:employees.id}).from(employees).where(eq(employees.id,employee.id)).for('update');
      await tx.execute(sql`SELECT set_config('app.attendance_actor',${String(req.user!.userId)},true)`);
      date.parse(input.date);
      const [existing]=await tx.select().from(attendance).where(and(eq(attendance.employeeId,employee.id),eq(attendance.date,input.date)));
      const snapshot=existing?.calculationSnapshot||await calculationSnapshot(employee,input.date,tx,!!existing);
      const breakMinutes=z.number().int().min(0).parse(input.totalBreakMinutes??existing?.totalBreakMinutes??0);
      const totalWorkHours=input.checkIn&&input.checkOut?calculateTime(Math.round((input.checkOut.getTime()-input.checkIn.getTime())/60000),breakMinutes,snapshot.rules.attendance).calculatedMinutes:null;
      const value={...input,totalWorkHours,totalBreakMinutes:breakMinutes,calculationSnapshot:snapshot,overtimeHours:existing?.overtimeHours??null,
        status:input.status==='present'&&input.checkIn&&managementLate(input.checkIn,snapshot)?'late' as const:input.status,checkInMethod:'manual' as const,checkOutMethod:input.checkOut?'manual' as const:null};
      const [saved]=existing?await tx.update(attendance).set(value).where(eq(attendance.id,existing.id)).returning():await tx.insert(attendance).values(value).returning();await tx.insert(activityLogs).values({userId:req.user!.userId,action:existing?'update':'create',entityType:'attendance',entityId:saved.id,details:'Manual attendance recorded'});return saved;
    });return res.status(201).json(result);
  }catch{return res.status(400).json({message:'Check the attendance fields'});}
});
router.get('/reports/:type',async(req,res)=>{
  try{z.enum(['daily','weekly','monthly']).parse(req.params.type);const start=date.parse(req.query.start),end=date.parse(req.query.end);
    if(end<start || Date.parse(end)-Date.parse(start)>366*86400000)return res.status(400).json({message:'Choose a date range of at most one year'});
    const rows=await db.select({record:attendance,firstName:employees.firstName,lastName:employees.lastName,department:employees.department}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id))
      .where(and(gte(attendance.date,start),lte(attendance.date,end),employeeScope(req.user!,'attendance_time_tracking')));
    return res.json({summary:{present:rows.filter(r=>r.record.status==='present').length,absent:rows.filter(r=>r.record.status==='absent').length,late:rows.filter(r=>r.record.status==='late').length,onLeave:rows.filter(r=>r.record.status==='on_leave').length},
      details:rows.map(({record,firstName,lastName,department})=>({...record,employeeName:`${firstName} ${lastName}`,department,totalHours:`${Math.floor((record.totalWorkHours || 0)/60)}:${String((record.totalWorkHours || 0)%60).padStart(2,'0')}`}))});
  }catch{return res.status(400).json({message:'Unable to generate attendance report'});}
});
export default router;
