import {moneyText} from '@shared/money';
import payrollTime,{timeImportEntries,timeAllowance} from './payrollTime';
import {recordRevision} from '../services/timesheets';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { employees,payroll,activityLogs,workforceTimesheets } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
import {calculatePolicyPayroll} from '@shared/calculation-rules';
import {calculationSnapshot} from '../services/calculation-rules';
import {reconcilePayroll} from '@shared/payroll-reconciliation';
const router=Router();router.use(authenticate);router.use(payrollTime);
const amount=z.union([z.string(),z.number()]);
const inputSchema=z.object({employeeId:z.coerce.number().int().positive(),month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2000).max(2200),basicSalary:amount,
  allowances:z.record(amount).default({}),deductions:z.record(amount).default({})});
const periodDate=(input:{year:number;month:number})=>`${input.year}-${String(input.month).padStart(2,'0')}-01`;
router.get('/reconciliation',async(req,res)=>{
 try{
  const month=z.coerce.number().int().min(1).max(12).parse(req.query.month),year=z.coerce.number().int().min(2000).max(2200).parse(req.query.year);
  const rows=await db.select({record:payroll,firstName:employees.firstName,lastName:employees.lastName}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.month,month),eq(payroll.year,year),employeeScope(req.user!,'payroll_management'))).orderBy(payroll.id);
  res.set('Cache-Control','no-store').json(reconcilePayroll(rows.map(({record,firstName,lastName})=>({...record,employeeName:firstName+' '+lastName}))));
 }catch{res.status(400).json({message:'Unable to reconcile payroll for this period'});}
});
router.post('/preview',async(req,res)=>{
 try{const input=inputSchema.parse(req.body),id=req.body.id?z.number().int().positive().parse(req.body.id):null;
  const [employee]=await db.select({id:employees.id,workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,input.employeeId),employeeScope(req.user!,'payroll_management',id?'update':'create')));
  if(!employee)return res.status(403).json({message:'Payroll access required'});
  const [existing]=id?await db.select().from(payroll).where(and(eq(payroll.id,id),eq(payroll.employeeId,employee.id))):[];
  if(id&&!existing)return res.status(404).json({message:'Payroll not found'});
  const snapshot=existing?.calculationSnapshot||await calculationSnapshot(employee,periodDate(existing||input),db,!!existing);
  return res.json({...calculatePolicyPayroll(input.basicSalary,input.allowances,input.deductions,snapshot.rules.payroll),version:snapshot.version});
 }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to preview payroll'});}
});
router.get('/month/:month/year/:year',async(req,res)=>{
  try{const month=z.coerce.number().int().min(1).max(12).parse(req.params.month),year=z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
    const rows=await db.select({record:payroll,firstName:employees.firstName,lastName:employees.lastName}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id))
      .where(and(eq(payroll.month,month),eq(payroll.year,year),employeeScope(req.user!,'payroll_management'))).orderBy(desc(payroll.createdAt));
    return res.json(rows.map(({record,firstName,lastName})=>({...record,employeeName:`${firstName} ${lastName}`})));
  }catch{return res.status(400).json({message:'Unable to load payroll'});}
});
router.post('/',async(req,res)=>{
  try{const input=inputSchema.parse(req.body);
    const record=await db.transaction(async tx=>{
      const [employee]=await tx.select({id:employees.id,workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,input.employeeId),employeeScope(req.user!,'payroll_management','create'))).for('update');
      if(!employee)throw new Error('You cannot create payroll for this employee');
      const [existing]=await tx.select({id:payroll.id}).from(payroll).where(and(eq(payroll.employeeId,input.employeeId),eq(payroll.month,input.month),eq(payroll.year,input.year)));
      if(existing)throw new Error('Payroll already exists for this employee and period');
      const snapshot=await calculationSnapshot(employee,periodDate(input),tx);
      const {unroundedNetSalary,...amounts}=calculatePolicyPayroll(input.basicSalary,input.allowances,input.deductions,snapshot.rules.payroll);
      const [created]=await tx.insert(payroll).values({...input,...amounts,calculationSnapshot:snapshot,status:'pending'}).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'payroll',entityId:created.id,details:'Created payroll draft'});return created;
    });return res.status(201).json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to create payroll'});}
});
router.patch('/:id',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id),input=inputSchema.omit({employeeId:true,month:true,year:true}).parse(req.body);
    const record=await db.transaction(async tx=>{
      const [row]=await tx.select({record:payroll}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user!,'payroll_management','update'))).for('update',{of:payroll});
      if(!row)throw new Error('Payroll not found');if(row.record.status!=='pending')throw new Error('Only pending payroll can be edited');
      const snapshot=row.record.calculationSnapshot||await calculationSnapshot({},periodDate(row.record),tx,true);
      const imported=await timeImportEntries(tx,id);if(imported.length)input.allowances={...input.allowances,[timeAllowance]:moneyText(imported.reduce((sum,e)=>sum+Number(e.amount_cents),0))};
      const {unroundedNetSalary,...amounts}=calculatePolicyPayroll(input.basicSalary,input.allowances,input.deductions,snapshot.rules.payroll);
      const [updated]=await tx.update(payroll).set({...amounts,calculationSnapshot:snapshot,updatedAt:new Date()}).where(eq(payroll.id,id)).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'payroll',entityId:id,details:'Edited payroll draft using its original calculation rules'});return updated;
    });return res.json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to update payroll'});}
});
router.post('/:id/mark-paid',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id),reference=z.string().trim().min(1).max(150).parse(req.body.reference);
    const record=await db.transaction(async tx=>{
      const [row]=await tx.select({record:payroll}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user!,'payroll_management','approve'))).for('update',{of:payroll});
      if(!row)throw new Error('Payroll not found or approval access required');if(row.record.status!=='pending')throw new Error('Payroll is already processed');
      const imported=await timeImportEntries(tx,id);if(imported.length){const [owner]=await tx.select({userId:employees.userId}).from(employees).where(eq(employees.id,row.record.employeeId));if(owner.userId===req.user!.userId)throw new Error('Another payroll approver must confirm this imported payment');}
      const [updated]=await tx.update(payroll).set({status:'processed',wpsReference:reference,processedBy:req.user!.userId,processedAt:new Date(),updatedAt:new Date()}).where(eq(payroll.id,id)).returning();
      for(const entry of imported){if(!entry.timesheet_id)continue;const [sheet]=await tx.select().from(workforceTimesheets).where(eq(workforceTimesheets.id,Number(entry.timesheet_id))).for('update');if(sheet.status!=='approved')throw new Error('Imported time is no longer approved');const [locked]=await tx.update(workforceTimesheets).set({status:'payroll_locked',payrollId:id,lockedBy:req.user!.userId,lockedAt:new Date(),version:sheet.version+1,updatedAt:new Date()}).where(eq(workforceTimesheets.id,sheet.id)).returning();await recordRevision(tx,req.user!,locked,'Payroll paid','Included in payroll #'+id);}
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'payroll',entityId:id,details:'Recorded external payment reference'});return updated;
    });return res.json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to record payment'});}
});
export default router;
