import { and, eq, isNull, isNotNull, desc, lte, gte } from 'drizzle-orm';
import { attendance, employees, leaves,workforceAssignments,workforceShifts,workforceTeams,workforceSites } from '@shared/schema';
import {attendancePolicy} from './hr-rules';
import {dayAt} from '@shared/hr-rules';
import {siteTimeToIso} from '@shared/workforce';
import type {WorkforceTransaction} from './workforce';
import { db } from '../db';
import {calculationSnapshot} from './calculation-rules';
import {calculateTime,managementLate} from '@shared/calculation-rules';

export function attendanceDate(now=new Date()):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.APP_TIMEZONE || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export async function clockAttendance(userId:number,action:'in'|'out'|'break_start'|'break_end',location?:string,notes?:string,now=new Date()){
  return db.transaction(async tx=>{
    // Lock the employee so simultaneous clock-ins cannot create duplicate daily records.
    const [employee]=await tx.select().from(employees).where(eq(employees.userId,userId)).for('update');
    if(!employee)throw new Error('Your account needs to be linked to an employee record');
    const policy=await attendancePolicy(tx,employee,attendanceDate(now)),date=dayAt(now,policy.timezone);
    const [active]=await tx.select().from(attendance).where(and(eq(attendance.employeeId,employee.id),isNotNull(attendance.checkIn),isNull(attendance.checkOut))).orderBy(desc(attendance.date));
    const [daily]=await tx.select().from(attendance).where(and(eq(attendance.employeeId,employee.id),eq(attendance.date,date)));
    const record=active||daily;
    if(active&&+now-+active.checkIn!>86400000)throw new Error('An old clock-in is still open; submit an attendance correction');
    const snapshot=record?.calculationSnapshot||await calculationSnapshot(employee,record?.date||date,tx,!!record?.checkIn);
    if(action==='in'){
      if(employee.status!=='active'||date<employee.joiningDate||(employee.contractEndDate&&date>employee.contractEndDate)||(employee.terminationDate&&date>employee.terminationDate))throw new Error('Attendance must fall within active employment');
      const [leave]=await tx.select({id:leaves.id}).from(leaves).where(and(eq(leaves.employeeId,employee.id),eq(leaves.status,'approved'),lte(leaves.startDate,date),gte(leaves.endDate,date)));
      if(leave)throw new Error('Approved leave covers today; contact HR to resolve it');
      if(record?.checkIn)throw new Error('Already clocked in today');
      const status=policy.id!==null||employee.workSchedule==='shift_based'?await clockStatus(tx,employee,date,now,policy):managementLate(now,snapshot)?'late' as const:'present' as const;
      const value={checkIn:now,status,calculationSnapshot:snapshot,checkInMethod:'mobile_app' as const,location:location || null,notes:notes || null};
      const [saved]=record ? await tx.update(attendance).set(value).where(eq(attendance.id,record.id)).returning():await tx.insert(attendance).values({...value,date,employeeId:employee.id}).returning();return saved;
    }
    if(!record?.checkIn)throw new Error('Clock in first');
    if(record.checkOut)throw new Error('Already clocked out today');
    const activeBreak=record.breakStartTime && !record.breakEndTime;
    if(action==='break_start'){
      if(activeBreak)throw new Error('A break is already active');
      const [saved]=await tx.update(attendance).set({breakStartTime:now,breakEndTime:null,updatedAt:now}).where(eq(attendance.id,record.id)).returning();return saved;
    }
    const activeMinutes=activeBreak?Math.max(0,Math.round((now.getTime()-record.breakStartTime!.getTime())/60000)):0;
    if(action==='break_end'){
      if(!activeBreak)throw new Error('There is no active break');
      const [saved]=await tx.update(attendance).set({breakEndTime:now,totalBreakMinutes:record.totalBreakMinutes+activeMinutes,updatedAt:now}).where(eq(attendance.id,record.id)).returning();return saved;
    }
    const breaks=record.totalBreakMinutes+activeMinutes;
    const elapsed=Math.max(breaks,Math.round((now.getTime()-record.checkIn.getTime())/60000));
    const worked=calculateTime(elapsed,breaks,snapshot.rules.attendance).calculatedMinutes;
    const [saved]=await tx.update(attendance).set({checkOut:now,checkOutMethod:'mobile_app',totalWorkHours:worked,totalBreakMinutes:breaks,calculationSnapshot:snapshot,
      breakEndTime:activeBreak?now:record.breakEndTime,location:location || record.location,notes:notes || record.notes,updatedAt:now}).where(eq(attendance.id,record.id)).returning();return saved;
  });
}

export async function clockStatus(tx:WorkforceTransaction,employee:typeof employees.$inferSelect,date:string,at:Date,policy:Awaited<ReturnType<typeof attendancePolicy>>):Promise<'late'|'present'>{
 let start:number|undefined;
 if(employee.workSchedule==='shift_based'){
  const rows=await tx.select({start:workforceShifts.startAt,timezone:workforceSites.timezone}).from(workforceAssignments).innerJoin(workforceShifts,eq(workforceAssignments.shiftId,workforceShifts.id)).innerJoin(workforceTeams,eq(workforceShifts.teamId,workforceTeams.id)).innerJoin(workforceSites,eq(workforceTeams.siteId,workforceSites.id)).where(and(eq(workforceAssignments.employeeId,employee.id),eq(workforceAssignments.status,'accepted'),gte(workforceShifts.startAt,new Date(Date.parse(date)-86400000)),lte(workforceShifts.startAt,new Date(Date.parse(date)+2*86400000))));const local=rows.filter(r=>dayAt(r.start,r.timezone)===date);if(local.length)start=Math.min(...local.map(r=>+r.start));
 }else if(policy.hasSchedule&&policy.workingDays.includes(new Date(date).getUTCDay())&&!policy.holidays.some(h=>h.date===date))start=Date.parse(siteTimeToIso(date+'T'+policy.startTime,policy.timezone));
 return start!==undefined&&+at>start+policy.graceMinutes*60000?'late':'present';
}
