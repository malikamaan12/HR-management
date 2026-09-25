import {Router} from 'express';
import {z} from 'zod';
import {and,eq,sql} from 'drizzle-orm';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../db';
import {employees,payroll,payrollReviews,leaveLedger,appSettings,users} from '@shared/schema';
import {civilDate} from '@shared/hr-rules';
import {moneyCents} from '@shared/money';
import {isDemoPayroll} from '@shared/payroll-exports';
import {requireAdmin,recordHandler,recordHistory,qatarToday,WorkflowError} from '../services/workflowRecords';
import {WorkforceError} from '../services/workforce';
import {settlementReconciliation} from '../services/separation-reconciliation';
import {recordPayrollPayment} from '../services/payroll-payment';
import {paymentModeError} from '../services/data-mode';

const router=Router({mergeParams:true});
const fail=(status:number,message:string):never=>{throw new WorkflowError(status,message);};
const id=z.coerce.number().int().positive(),reason=z.string().trim().min(5).max(2000);
const proposal=z.object({version:z.number().int().nonnegative(),reference:z.string().trim().min(3).max(100),paidOn:civilDate,amount:z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),payrollIds:z.array(z.number().int().positive()).max(100),leaveDebits:z.array(z.object({type:z.string().min(1).max(100),year:z.number().int(),days:z.number().positive().max(1000).multipleOf(0.5)}).strict()).max(20),reason,confirmed:z.literal(true)}).strict();
// Both handlers run inside the authenticated separation router. Administrators
// are required because this operation spans payroll, leave and exit records.
const handle=(fn:(req:any,res:any)=>Promise<any>)=>recordHandler(async(req,res)=>{requireAdmin(req);res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){if(e instanceof WorkforceError)throw new WorkflowError(e.status,e.message);throw e;}});
async function load(tx:any,req:any){
 const caseId=id.parse(req.params.id);
 const initial=(await tx.execute(sql`SELECT employee_id FROM employee_separations WHERE id=${caseId}`)).rows[0];
 if(!initial)fail(404,'Separation case not found');
 const [employee]=await tx.select().from(employees).where(eq(employees.id,Number(initial.employee_id))).for('update');
 const row=(await tx.execute(sql`SELECT * FROM employee_separations WHERE id=${caseId} FOR UPDATE`)).rows[0];
 if(employee.userId===req.user.userId)fail(403,'You cannot manage your own settlement payment');
 if(row.status!=='completed')fail(409,'Complete the independently reviewed separation first');
 const payment=(await tx.execute(sql`SELECT *,paid_on::text AS paid_on FROM settlement_payments WHERE case_id=${caseId} FOR UPDATE`)).rows[0];
 return {row,payment};
}
async function linkedPayroll(tx:any,caseId:number){return (await tx.execute(sql`SELECT payroll_id FROM settlement_payroll_allocations WHERE case_id=${caseId} ORDER BY payroll_id`)).rows.map((r:any)=>Number(r.payroll_id));}
router.get('/',handle(async(req,res)=>res.json(await db.transaction(async tx=>{
 const {row,payment}=await load(tx,req);
 const current=await settlementReconciliation(tx,Number(row.employee_id),row.input.lastDay);
 const history=(await tx.execute(sql`SELECT h.version,h.reason,h.created_at,h.snapshot->>'status' AS status,h.snapshot->>'reference' AS reference,u.first_name || ' ' || u.last_name AS actor FROM hr_workflow_history h JOIN users u ON u.id=h.actor_id WHERE h.kind='settlement_payment' AND h.record_id=${row.id} ORDER BY h.version DESC LIMIT 100`)).rows;
 return {payment:payment||null,payrollIds:payment?await linkedPayroll(tx,row.id):[],history,current,netCents:row.snapshot.netCents,currency:row.snapshot.currency,unpaidSalary:row.input.unpaidSalary,leaveDays:row.input.leaveDays,leaveYear:Number(row.input.lastDay.slice(0,4)),today:qatarToday(),canReview:!!payment&&payment.status==='pending'&&Number(payment.prepared_by)!==req.user.userId,modeError:paymentModeError()};
}))));
router.post('/propose',handle(async(req,res)=>{
 const input=proposal.parse(req.body),modeError=paymentModeError();if(modeError)fail(409,modeError);
 if(input.paidOn>qatarToday())fail(400,'A recorded payment cannot be future-dated');
 if(isDemoPayroll({paymentReference:input.reference}))fail(400,'Demo references cannot record a settlement payment');
 res.json(await db.transaction(async tx=>{
  const {row,payment}=await load(tx,req);
  if(Number(payment?.version||0)!==input.version)fail(409,'Payment review changed. Reload before continuing');
  if(payment&&payment.status!=='rejected')fail(409,'This settlement already has a pending or recorded payment');
  if(input.paidOn<row.input.lastDay)fail(400,'Payment date must be on or after the leaving date');
  if(row.snapshot.netCents<=0||moneyCents(input.amount)!==row.snapshot.netCents)fail(400,'Payment must equal the positive reviewed net settlement');
  const sources=await settlementReconciliation(tx,Number(row.employee_id),row.input.lastDay);
  if(sources.pendingLeave.length)fail(409,'Resolve pending leave before reconciling settlement payment');
  if(new Set(input.payrollIds).size!==input.payrollIds.length)fail(400,'Select each payroll once');
  if(new Set(input.leaveDebits.map(l=>l.type+':'+l.year)).size!==input.leaveDebits.length)fail(400,'Select each leave balance once');
  let salary=0;const approvers=new Set<number>();
  for(const payrollId of [...input.payrollIds].sort((a,b)=>a-b)){
   const [pay]=await tx.select().from(payroll).where(and(eq(payroll.id,payrollId),eq(payroll.employeeId,Number(row.employee_id)))).for('update');
   const source=sources.payroll.find((p:any)=>Number(p.id)===payrollId);
   if(!pay||!source||source.status!=='approved'||source.currency!==row.snapshot.currency||isDemoPayroll({paymentReference:pay.wpsReference}))fail(409,'Select approved unpaid payroll for this employee and settlement currency');
   const [review]=await tx.select().from(payrollReviews).where(eq(payrollReviews.payrollId,payrollId));
   if(!review||review.approverId===req.user.userId||review.approverId===review.createdBy)fail(409,'An independent payroll preparer must propose this settlement payment');
   approvers.add(review.approverId);
   if((await tx.select().from(appSettings).where(eq(appSettings.key,'payroll_wps_export:'+payrollId))).length)fail(409,'A selected payroll was exported to WPS. Reconcile its bank outcome before including it in a settlement');
   if((await tx.execute(sql`SELECT payroll_id FROM settlement_payroll_allocations WHERE payroll_id=${payrollId}`)).rows.length)fail(409,'A selected payroll is already allocated to another settlement');
   salary+=moneyCents(pay.netSalary);
  }
  if(approvers.size>1)fail(409,'Included payroll must share one independent designated pay approver');
  if(approvers.size){
   const [reviewer]=await tx.select().from(users).where(eq(users.id,[...approvers][0]));
   if(!reviewer?.isActive||reviewer.approvalStatus!=='approved'||!['admin','super_admin'].includes(reviewer.role))fail(409,'The designated pay approver must be an active administrator for this cross-module settlement review');
  }
  if(salary!==moneyCents(row.input.unpaidSalary))fail(400,'Selected payroll must exactly match the reviewed outstanding salary');
  if(input.leaveDebits.reduce((sum,l)=>sum+Math.round(l.days*100),0)!==Math.round(row.input.leaveDays*100))fail(400,'Leave debits must exactly match the reviewed encashed days');
  for(const debit of input.leaveDebits){
   const source=sources.leave.find(l=>l.type===debit.type&&l.year===debit.year);
   if(debit.year!==Number(row.input.lastDay.slice(0,4))||!source||source.availableDays<debit.days)fail(409,'Use available leave from the leaving year; reconcile carried balances first');
  }
  const saved=(await tx.execute(sql`INSERT INTO settlement_payments(case_id,version,status,reference,paid_on,amount_cents,currency,leave_debits,sources,prepared_by,reason) VALUES(${row.id},${input.version+1},'pending',${input.reference},${input.paidOn}::date,${row.snapshot.netCents},${row.snapshot.currency},${JSON.stringify(input.leaveDebits)}::jsonb,${JSON.stringify(sources)}::jsonb,${req.user.userId},${input.reason}) ON CONFLICT(case_id) DO UPDATE SET version=excluded.version,status='pending',reference=excluded.reference,paid_on=excluded.paid_on,amount_cents=excluded.amount_cents,currency=excluded.currency,leave_debits=excluded.leave_debits,sources=excluded.sources,prepared_by=excluded.prepared_by,reason=excluded.reason,reviewed_by=NULL,reviewed_at=NULL,created_at=now() RETURNING *`)).rows[0];
  for(const payrollId of input.payrollIds)await tx.execute(sql`INSERT INTO settlement_payroll_allocations(payroll_id,case_id) VALUES(${payrollId},${row.id})`);
  await recordHistory(tx,req,'settlement_payment',{...saved,id:row.id,payrollIds:input.payrollIds},input.reason);
  return {status:saved.status,version:saved.version};
 }));
}));
router.post('/:action',handle(async(req,res)=>{
 const action=z.enum(['record','reject']).parse(req.params.action),input=z.object({version:z.number().int().positive(),reason,confirmed:z.literal(true)}).strict().parse(req.body);
 if(action==='record'){const modeError=paymentModeError();if(modeError)fail(409,modeError);}
 res.json(await db.transaction(async tx=>{
  const {row,payment}=await load(tx,req);
  if(!payment||payment.status!=='pending'||Number(payment.version)!==input.version)fail(409,'This payment was already reviewed or changed');
  if(Number(payment.prepared_by)===req.user.userId)fail(403,'A different administrator must review the payment evidence');
  const payrollIds=await linkedPayroll(tx,row.id);
  if(action==='record'){
   const current=await settlementReconciliation(tx,Number(row.employee_id),row.input.lastDay);
   if(!isDeepStrictEqual(current,payment.sources))fail(409,'Payroll or leave changed. Reject this proposal and prepare a fresh reconciliation');
   for(const payrollId of payrollIds){
    const [pay]=await tx.select({record:payroll,review:payrollReviews,owner:employees.userId}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).leftJoin(payrollReviews,eq(payrollReviews.payrollId,payroll.id)).where(eq(payroll.id,payrollId)).for('update',{of:payroll});
    await recordPayrollPayment(tx,pay,req.user,payment.reference);
   }
   for(const debit of payment.leave_debits as {type:string;year:number;days:number}[])await tx.insert(leaveLedger).values({employeeId:Number(row.employee_id),leaveType:debit.type,year:debit.year,units:-Math.round(debit.days*100),sourceKey:`settlement:${row.id}:${debit.type}:${debit.year}`,reason:`Settlement ${row.reference}: ${input.reason}`,actorId:req.user.userId});
  }else await tx.execute(sql`DELETE FROM settlement_payroll_allocations WHERE case_id=${row.id}`);
  const saved=(await tx.execute(sql`UPDATE settlement_payments SET status=${action==='record'?'recorded':'rejected'},version=version+1,reviewed_by=${req.user.userId},reviewed_at=now() WHERE case_id=${row.id} RETURNING *`)).rows[0];
  await recordHistory(tx,req,'settlement_payment',{...saved,id:row.id,payrollIds,action},input.reason);
  return {status:saved.status,version:saved.version};
 }));
}));
export default router;
