import {Router} from 'express';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {payroll,employees,workforceTimesheets as sheets,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceSites as sites} from '@shared/schema';
import {positiveId} from '@shared/workforce';
import {ruleDate,ruleScope,calculatePolicyPayroll} from '@shared/calculation-rules';
import {payPolicy,timeEarnings} from '@shared/operations-policies';
import {moneyText} from '@shared/money';
import {calculationSnapshot} from '../services/calculation-rules';
import {operationPolicy} from '../services/operations-policies';
import {employeeScope} from '../services/access';
import {fail,audit,type WorkforceTransaction} from '../services/workforce';
import {operationsHandle as handle} from './operationsPolicies';
export const timeAllowance='Workforce approved time';
const router=Router();
const amountsMap=(value:unknown)=>z.record(z.union([z.string(),z.number()])).parse(value||{});
export async function timeImportEntries(tx:WorkforceTransaction,id:number){return (await tx.execute(sql`SELECT * FROM payroll_time_entries WHERE payroll_id=${id} AND released_at IS NULL ORDER BY id`)).rows;}
router.get('/:id/time-import',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id);const [row]=await db.select({id:payroll.id}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user,'payroll_management')));if(!row)fail(404,'Payroll not found');res.json((await db.execute(sql`SELECT * FROM payroll_time_entries WHERE payroll_id=${id} ORDER BY id DESC LIMIT 1000`)).rows);
}));
router.post('/:id/time-import',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({preview:z.boolean(),reason:z.string().trim().min(5).max(500),adjustmentCents:z.number().int().min(-10000000).max(10000000).default(0),adjustmentReason:z.string().trim().max(500).default(''),quote:z.string().max(250000).optional()}).strict().parse(req.body);
 if(input.adjustmentCents&&input.adjustmentReason.length<5)fail(400,'Explain the earning adjustment');
 const result=await db.transaction(async tx=>{
  const [row]=await tx.select({record:payroll,employee:employees}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user,'payroll_management','update'))).for('update',{of:payroll});if(!row)fail(404,'Payroll not found');
  if(row.employee.userId===req.user.userId)fail(403,'Another payroll editor must import your time');if(row.record.status!=='pending')fail(409,'Only pending payroll accepts time imports');
  if((await timeImportEntries(tx,id)).length)fail(409,'This payroll already has an active time import; release it before recalculating');if(timeAllowance in amountsMap(row.record.allowances))fail(409,'Remove the reserved workforce allowance before importing time');
  const period=`${row.record.year}-${String(row.record.month).padStart(2,'0')}`;
  const approved=await tx.select({sheet:sheets,startAt:shifts.startAt,timezone:sites.timezone}).from(sheets).innerJoin(assignments,eq(sheets.assignmentId,assignments.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).where(and(eq(assignments.employeeId,row.employee.id),eq(sheets.status,'approved'),sql`to_char(${shifts.startAt} AT TIME ZONE ${sites.timezone},'YYYY-MM')=${period}`)).orderBy(sheets.id).limit(501).for('update',{of:sheets});
  if(!approved.length)fail(409,'No approved timesheets in this payroll month');if(approved.length>500)fail(409,'More than 500 timesheets require a separate payroll review');
  const lines=[];for(const item of approved){
   if((await tx.execute(sql`SELECT id FROM payroll_time_entries WHERE timesheet_id=${item.sheet.id} AND released_at IS NULL`)).rows.length)fail(409,'A timesheet is already included in another payroll');
   const scope=item.sheet.calculationSnapshot?.scope||ruleScope(row.employee),policy=await operationPolicy(tx,'timepay',scope,ruleDate(item.startAt,item.timezone)),rules=payPolicy.parse(policy.rules);if(!rules.enabled)fail(409,'Time-to-pay is disabled for one of the work dates');
   lines.push({timesheetId:item.sheet.id,version:item.sheet.version,payableMinutes:item.sheet.payableMinutes!,policy,...timeEarnings(item.sheet.payableMinutes!,rules)});
  }
  const totalCents=lines.reduce((n,l)=>n+l.amountCents,0)+input.adjustmentCents;if(!Number.isSafeInteger(totalCents)||totalCents<0||totalCents>100000000)fail(400,'Time earnings including adjustments must be between zero and QAR 1,000,000');
  const snapshot=row.record.calculationSnapshot||await calculationSnapshot(row.employee,period+'-01',tx,true),allowances={...amountsMap(row.record.allowances),[timeAllowance]:moneyText(totalCents)};
  const {unroundedNetSalary,...amounts}=calculatePolicyPayroll(row.record.basicSalary,allowances,amountsMap(row.record.deductions),snapshot.rules.payroll);
  const quote=JSON.stringify({payrollVersion:row.record.updatedAt,lines,totalCents,adjustmentReason:input.adjustmentReason,adjustmentCents:input.adjustmentCents,netSalary:amounts.netSalary});
  if(input.preview)return {lines,totalCents,netSalary:amounts.netSalary,quote};if(input.quote!==quote)fail(409,'Time, rates or payroll changed; preview again');
  for(const line of lines)await tx.execute(sql`INSERT INTO payroll_time_entries(payroll_id,timesheet_id,amount_cents,basis,created_by) VALUES(${id},${line.timesheetId},${line.amountCents},${JSON.stringify({...line,reason:input.reason})}::jsonb,${req.user.userId})`);
  if(input.adjustmentCents)await tx.execute(sql`INSERT INTO payroll_time_entries(payroll_id,amount_cents,basis,created_by) VALUES(${id},${input.adjustmentCents},${JSON.stringify({kind:'adjustment',reason:input.adjustmentReason})}::jsonb,${req.user.userId})`);
  await tx.update(payroll).set({...amounts,calculationSnapshot:snapshot,updatedAt:new Date()}).where(eq(payroll.id,id));await audit(tx,req.user,'payroll',id,'Approved time imported: '+input.reason);return {totalCents,netSalary:amounts.netSalary};
 });res.status(input.preview?200:201).json(result);
}));
router.post('/:id/time-release',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),reason=z.string().trim().min(5).max(500).parse(req.body.reason);
 await db.transaction(async tx=>{const [row]=await tx.select({record:payroll,userId:employees.userId}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user,'payroll_management','update'))).for('update',{of:payroll});if(!row)fail(404,'Payroll not found');if(row.userId===req.user.userId)fail(403,'Another payroll editor must release your time');if(row.record.status!=='pending')fail(409,'Paid payroll imports cannot be released');
  const entries=await timeImportEntries(tx,id);if(!entries.length)fail(409,'There is no active time import');
  const allowances={...amountsMap(row.record.allowances)};delete allowances[timeAllowance];const snapshot=row.record.calculationSnapshot||await calculationSnapshot({},`${row.record.year}-${String(row.record.month).padStart(2,'0')}-01`,tx,true);
  const {unroundedNetSalary,...amounts}=calculatePolicyPayroll(row.record.basicSalary,allowances,amountsMap(row.record.deductions),snapshot.rules.payroll);
  await tx.execute(sql`UPDATE payroll_time_entries SET released_at=now() WHERE payroll_id=${id} AND released_at IS NULL`);await tx.update(payroll).set({...amounts,updatedAt:new Date()}).where(eq(payroll.id,id));await audit(tx,req.user,'payroll',id,'Time import released: '+reason);
 });res.json({success:true});
}));
export default router;
