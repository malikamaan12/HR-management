import {Router} from 'express';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {employees,leaves,leaveLedger,leaveBalances} from '@shared/schema';
import {positiveId} from '@shared/workforce';
import {civilDate,ruleDate} from '@shared/calculation-rules';
import {accrualPolicy,hundredths,dayAmount} from '@shared/operations-policies';
import {operationPolicy} from '../services/operations-policies';
import {leaveAccount} from '../services/leave-ledger';
import {lockEmployee,fail,audit} from '../services/workforce';
import {operationsHandle as handle,admin} from './operationsPolicies';
const router=Router(),yearSchema=z.number().int().min(2001).max(2199),typeSchema=z.string().trim().min(1).max(100),reasonSchema=z.string().trim().min(5).max(500);
router.get('/ledger-reconciliation/:employeeId',handle(async(req,res)=>{
 admin(req.user);const employeeId=positiveId.parse(req.params.employeeId);const pending=await db.select().from(leaves).where(and(eq(leaves.employeeId,employeeId),sql`${leaves.calculationSnapshot} IS NULL AND left(${leaves.startDate}::text,4)<>left(${leaves.endDate}::text,4) AND ${leaves.status} IN ('pending','approved')`));
 const splits=(await db.execute(sql`SELECT s.* FROM leave_year_splits s JOIN leaves l ON l.id=s.leave_id WHERE l.employee_id=${employeeId}`)).rows;
 res.json({legacyBalances:await db.select().from(leaveBalances).where(eq(leaveBalances.employeeId,employeeId)),unresolved:pending.filter(l=>!splits.some(s=>s.leave_id===l.id)),splits});
}));
router.post('/ledger-reconciliation/:employeeId/split',handle(async(req,res)=>{
 admin(req.user);const employeeId=positiveId.parse(req.params.employeeId),input=z.object({leaveId:positiveId,splits:z.array(z.object({year:yearSchema,days:hundredths.refine(n=>n>=0&&n<=367)}).strict()).min(2).max(10),reason:reasonSchema}).strict().parse(req.body);
 await db.transaction(async tx=>{await lockEmployee(tx,employeeId);const [row]=await tx.select().from(leaves).where(and(eq(leaves.id,input.leaveId),eq(leaves.employeeId,employeeId))).for('update');if(!row||row.calculationSnapshot)fail(409,'Choose a legacy request without a saved calendar');
  const start=Number(row.startDate.slice(0,4)),end=Number(row.endDate.slice(0,4));
  if(start===end||input.splits.length!==end-start+1||new Set(input.splits.map(s=>s.year)).size!==input.splits.length||input.splits.some(s=>s.year<start||s.year>end)||Math.round(input.splits.reduce((n,s)=>n+s.days,0)*100)!==Math.round(row.totalDays*100))fail(400,'Include each affected year exactly once and preserve the original total days');
  if((await tx.execute(sql`SELECT leave_id FROM leave_year_splits WHERE leave_id=${row.id}`)).rows.length)fail(409,'This legacy request was already reconciled');
  for(const split of input.splits){const a=Date.parse(row.startDate>`${split.year}-01-01`?row.startDate:`${split.year}-01-01`),b=Date.parse(row.endDate<`${split.year}-12-31`?row.endDate:`${split.year}-12-31`);if(split.days>(b-a)/86400000+1)fail(400,'Year allocation exceeds the calendar span');
   await tx.execute(sql`INSERT INTO leave_year_splits(leave_id,year,days,reason,created_by) VALUES(${row.id},${split.year},${split.days},${input.reason},${req.user.userId})`);
  }
  for(const split of input.splits){const account=await leaveAccount(tx,employeeId,row.leaveType,split.year);if(account.managed&&account.available<0)fail(409,'Increase the year allocation before reconciling this request');}
  await audit(tx,req.user,'leave',row.id,'Legacy leave allocated across years: '+input.reason);
 });res.json({success:true});
}));
router.post('/ledger-run',handle(async(req,res)=>{
 admin(req.user);const input=z.object({employeeId:positiveId,leaveType:typeSchema,year:yearSchema,month:z.number().int().min(1).max(12).optional(),kind:z.enum(['opening','accrual','carryover']),verifiedAvailable:hundredths.refine(n=>n>=0&&n<=3660).optional(),expectedVersion:z.number().int().nonnegative(),expectedPolicyId:z.number().int().nonnegative().optional(),reason:reasonSchema,expectedQuote:z.string().max(20000).optional(),preview:z.boolean()}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const employee=await lockEmployee(tx,input.employeeId),account=await leaveAccount(tx,employee.id,input.leaveType,input.year);
  if(!(await tx.execute(sql`SELECT id FROM leave_types WHERE name=${input.leaveType} AND active=true`)).rows.length)fail(400,'Choose an active leave type');
  const reference=input.kind==='accrual'?`accrual:${input.year}-${String(input.month).padStart(2,'0')}`:`${input.kind}:${input.year}`;
  const [prior]=await tx.select().from(leaveLedger).where(and(eq(leaveLedger.employeeId,employee.id),eq(leaveLedger.leaveType,input.leaveType),eq(leaveLedger.year,input.year),eq(leaveLedger.reference,reference)));
  if(prior){if(input.kind==='opening'&&(prior.basis as any)?.verifiedAvailable!==input.verifiedAvailable)fail(409,'Opening balance was already recorded with different input');return {posted:true,entry:prior,days:prior.days,basis:prior.basis};}
  if(account.version!==input.expectedVersion)fail(409,'Balance changed; preview again');if(account.needsReconciliation)fail(409,'Reconcile legacy cross-year requests first');
  let days=0,source:Awaited<ReturnType<typeof leaveAccount>>|undefined;let basis:any={kind:input.kind,reason:input.reason};
  if(input.kind==='opening'){
   if(account.managed)fail(409,'Opening reconciliation is only available before ledger activation');if(input.verifiedAvailable===undefined)fail(400,'Enter verified available days after pending reservations');
   days=dayAmount(input.verifiedAvailable+account.used+account.pending);basis={...basis,verifiedAvailable:input.verifiedAvailable,used:account.used,pending:account.pending};
  }else{
   if(input.kind==='accrual'&&!input.month)fail(400,'Choose a month');const period=input.kind==='accrual'?`${input.year}-${String(input.month).padStart(2,'0')}-01`:`${input.year}-01-01`;
   const policy=await operationPolicy(tx,'leave',input.leaveType,period),rules=accrualPolicy.parse(policy.rules);
   if(!rules.enabled)fail(409,'The applicable leave policy is disabled');if(!input.preview&&input.expectedPolicyId!==policy.id)fail(409,'Policy changed; preview again');basis={...basis,policy,period};
   if(input.kind==='accrual'){
    const start=new Date(period+'T00:00:00Z'),next=new Date(Date.UTC(input.year,input.month!,1));if(next.toISOString().slice(0,10)>ruleDate())fail(409,'Accrual can be posted only for a completed month');
    const serviceStart=new Date(Date.parse(employee.joiningDate)+rules.minServiceDays*86400000).toISOString().slice(0,10),finish=[employee.contractEndDate,employee.terminationDate].filter(Boolean).sort()[0];
    const lo=Math.max(+start,Date.parse(serviceStart)),hi=Math.min(+next,finish?Date.parse(finish)+86400000:+next),eligibleDays=Math.max(0,(hi-lo)/86400000),calendarDays=(+next-+start)/86400000;
    const credits=(await tx.execute(sql`SELECT coalesce(sum(days),0)::float8 AS days FROM leave_ledger WHERE employee_id=${employee.id} AND leave_type=${input.leaveType} AND year=${input.year} AND basis->>'kind'='accrual'`)).rows[0];
    days=dayAmount(Math.min(Math.max(0,rules.annualCap-Number(credits.days)),rules.monthlyDays*(rules.prorate?eligibleDays/calendarDays:eligibleDays===calendarDays?1:0)));basis={...basis,eligibleDays,calendarDays,priorAccrualDays:Number(credits.days)};
   }else{
    if(period>ruleDate())fail(409,'The destination year has not started');source=await leaveAccount(tx,employee.id,input.leaveType,input.year-1);if(!source.managed||source.needsReconciliation||source.pending>0)fail(409,'Reconcile and decide all source-year leave before carrying it forward');
    days=dayAmount(Math.min(Math.max(0,source.available),rules.carryoverCap));basis={...basis,sourceYear:input.year-1,sourceAvailable:source.available,sourceVersion:source.version};
   }
  }
  if(days>3660)fail(400,'Allocation exceeds the supported account limit');
  if(account.available+days<0)fail(409,'Allocation would not cover existing leave; reconcile the opening balance first');
  const quote=JSON.stringify({days,basis});if(input.preview)return {posted:false,days,basis,quote,expectedVersion:account.version};
  if(input.expectedQuote!==quote)fail(409,'Calculation changed; preview and review again');
  if(source&&days>0)await tx.insert(leaveLedger).values({employeeId:employee.id,leaveType:input.leaveType,year:input.year-1,days:-days,reference:`carryout:${input.year}`,reason:input.reason,createdBy:req.user.userId,basis});
  const [entry]=await tx.insert(leaveLedger).values({employeeId:employee.id,leaveType:input.leaveType,year:input.year,days,reference,reason:input.reason,createdBy:req.user.userId,basis}).returning();await audit(tx,req.user,'leave_ledger',entry.id,'Posted '+input.kind+' leave run');return {posted:true,entry,days,basis};
 });res.status(input.preview?200:201).json(result);
}));
export default router;
