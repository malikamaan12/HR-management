import {and,eq,gte,lte,sql} from 'drizzle-orm';
import {db} from '../db';
import {leaveLedger,leaves} from '@shared/schema';
import {calculateLeave} from '@shared/calculation-rules';
import {WorkforceError} from './workforce';
type Connection=Pick<typeof db,'select'|'execute'>;
export async function leaveAccount(connection:Connection,employeeId:number,leaveType:string,year:number){
  const [credit]=await connection.select({days:sql<number>`round(coalesce(sum(${leaveLedger.days}),0)::numeric,2)::float8`,entries:sql<number>`count(*)::int`,version:sql<number>`coalesce(max(${leaveLedger.id}),0)::int`}).from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId,employeeId),eq(leaveLedger.leaveType,leaveType),eq(leaveLedger.year,year)));
  const rows=await connection.select().from(leaves).where(and(eq(leaves.employeeId,employeeId),eq(leaves.leaveType,leaveType),lte(leaves.startDate,`${year}-12-31`),gte(leaves.endDate,`${year}-01-01`)));
  let used=0,pending=0;let needsReconciliation=false;
  for(const row of rows){
    if(row.status!=='approved'&&row.status!=='pending')continue;
    const start=row.startDate<`${year}-01-01`?`${year}-01-01`:row.startDate,end=row.endDate>`${year}-12-31`?`${year}-12-31`:row.endDate;
    let days=row.totalDays;
    if(start!==row.startDate||end!==row.endDate){
      if(!row.calculationSnapshot){const split=await connection.execute(sql`SELECT days FROM leave_year_splits WHERE leave_id=${row.id} AND year=${year}`);if(!split.rows.length){needsReconciliation=true;continue;}days=Number(split.rows[0].days);}else
      days=calculateLeave(start,end,row.calculationSnapshot!).totalDays*(row.dayFraction||1);
    }
    if(row.status==='approved')used+=days;else pending+=days;
  }
  return {year,leaveType,allocated:credit.days,used,pending,available:Math.round((credit.days-used-pending)*100)/100,managed:credit.entries>0,version:credit.version,needsReconciliation};
}
export async function assertLeaveFunds(connection:Connection,employeeId:number,leaveType:string,start:string,end:string,snapshot:NonNullable<typeof leaves.$inferSelect.calculationSnapshot>,fraction=1){
  for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){
    const account=await leaveAccount(connection,employeeId,leaveType,year);
    if(!account.managed)continue;
    if(account.needsReconciliation)throw new WorkforceError(409,'HR must reconcile legacy cross-year leave before requesting more leave');
    const days=calculateLeave(start<`${year}-01-01`?`${year}-01-01`:start,end>`${year}-12-31`?`${year}-12-31`:end,snapshot).totalDays*fraction;
    if(days>account.available)throw new WorkforceError(409,`Insufficient allocated ${leaveType} balance for ${year}`);
  }
}
