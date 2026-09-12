import { and, eq } from 'drizzle-orm';
import { attendance, employees } from '@shared/schema';
import { db } from '../db';

export function attendanceDate(now=new Date()):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.APP_TIMEZONE || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export async function clockAttendance(userId:number,action:'in'|'out'|'break_start'|'break_end',location?:string,notes?:string,now=new Date()){
  const date=attendanceDate(now);
  return db.transaction(async tx=>{
    // Lock the employee so simultaneous clock-ins cannot create duplicate daily records.
    const [employee]=await tx.select().from(employees).where(eq(employees.userId,userId)).for('update');
    if(!employee)throw new Error('Your account needs to be linked to an employee record');
    const [record]=await tx.select().from(attendance).where(and(eq(attendance.employeeId,employee.id),eq(attendance.date,date)));
    if(action==='in'){
      if(record?.checkIn)throw new Error('Already clocked in today');
      const value={checkIn:now,status:'present' as const,checkInMethod:'mobile_app' as const,location:location || null,notes:notes || null};
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
    const worked=Math.max(0,Math.round((now.getTime()-record.checkIn.getTime())/60000)-breaks);
    const [saved]=await tx.update(attendance).set({checkOut:now,checkOutMethod:'mobile_app',totalWorkHours:worked,totalBreakMinutes:breaks,
      breakEndTime:activeBreak?now:record.breakEndTime,location:location || record.location,notes:notes || record.notes,updatedAt:now}).where(eq(attendance.id,record.id)).returning();return saved;
  });
}
