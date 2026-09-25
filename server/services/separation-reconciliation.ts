import {sql} from 'drizzle-orm';
import {moneyCents} from '@shared/money';
import {isDemoPayroll} from '@shared/payroll-exports';
import {reserved} from './leave-ledger';
import {WorkflowError} from './workflowRecords';

// Caller holds the employee row lock, shared with payroll and leave writes.
// Explicit fields avoid storing bank accounts, credentials or unrelated HR notes.
export async function settlementReconciliation(tx:any,employeeId:number,lastDay:string){
 const payroll=(await tx.execute(sql`SELECT p.id,p.month,p.year,p.status,p.net_salary::text AS net,r.currency,r.version,r.period_start::text AS period_start,r.period_end::text AS period_end,p.wps_reference AS payment_reference FROM payroll p LEFT JOIN payroll_reviews r ON r.payroll_id=p.id WHERE p.employee_id=${employeeId} AND (r.period_start<=${lastDay}::date OR (r.payroll_id IS NULL AND p.year*100+p.month<=${Number(lastDay.slice(0,4))*100+Number(lastDay.slice(5,7))})) ORDER BY p.id LIMIT 1001`)).rows;
 if(payroll.length>1000)throw new WorkflowError(409,'Reconciliation exceeds 1,000 payroll records. Contact support for a complete reviewed export.');
 const ledger=(await tx.execute(sql`SELECT leave_type,year,sum(units)::integer AS units,max(id)::integer AS last_entry FROM leave_ledger WHERE employee_id=${employeeId} GROUP BY leave_type,year ORDER BY leave_type,year`)).rows;
 const leave=[];for(const row of ledger){const pending=await reserved(tx,employeeId,String(row.leave_type),Number(row.year));leave.push({type:String(row.leave_type),year:Number(row.year),postedDays:Number(row.units)/100,reservedDays:pending/100,availableDays:(Number(row.units)-pending)/100,lastEntry:Number(row.last_entry)});}
 const totals:Record<string,{approvedUnpaidCents:number;paidCents:number}>={};
 for(const row of payroll){if(isDemoPayroll({paymentReference:row.payment_reference?String(row.payment_reference):null}))continue;const currency=String(row.currency||'Unspecified');totals[currency]??={approvedUnpaidCents:0,paidCents:0};const cents=moneyCents(String(row.net));if(row.status==='approved')totals[currency].approvedUnpaidCents+=cents;if(['processed','paid'].includes(String(row.status)))totals[currency].paidCents+=cents;}
 const pending=(await tx.execute(sql`SELECT id,leave_type,start_date::text,end_date::text,status,review_version FROM leaves WHERE employee_id=${employeeId} AND status='pending' ORDER BY id`)).rows;
 return {payroll,leave,pendingLeave:pending,totals};
}
