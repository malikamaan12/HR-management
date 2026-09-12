import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { employees,payroll,activityLogs } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
import { calculatePayroll } from '@shared/money';
const router=Router();router.use(authenticate);
const amount=z.union([z.string(),z.number()]);
const inputSchema=z.object({employeeId:z.coerce.number().int().positive(),month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2000).max(2200),basicSalary:amount,
  allowances:z.record(amount).default({}),deductions:z.record(amount).default({})});
router.get('/month/:month/year/:year',async(req,res)=>{
  try{const month=z.coerce.number().int().min(1).max(12).parse(req.params.month),year=z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
    const rows=await db.select({record:payroll,firstName:employees.firstName,lastName:employees.lastName}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id))
      .where(and(eq(payroll.month,month),eq(payroll.year,year),employeeScope(req.user!,'payroll_management'))).orderBy(desc(payroll.createdAt));
    return res.json(rows.map(({record,firstName,lastName})=>({...record,employeeName:`${firstName} ${lastName}`})));
  }catch{return res.status(400).json({message:'Unable to load payroll'});}
});
router.post('/',async(req,res)=>{
  try{const input=inputSchema.parse(req.body),amounts=calculatePayroll(input.basicSalary,input.allowances,input.deductions);
    const record=await db.transaction(async tx=>{
      const [employee]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,input.employeeId),employeeScope(req.user!,'payroll_management','create'))).for('update');
      if(!employee)throw new Error('You cannot create payroll for this employee');
      const [existing]=await tx.select({id:payroll.id}).from(payroll).where(and(eq(payroll.employeeId,input.employeeId),eq(payroll.month,input.month),eq(payroll.year,input.year)));
      if(existing)throw new Error('Payroll already exists for this employee and period');
      const [created]=await tx.insert(payroll).values({...input,...amounts,status:'pending'}).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'payroll',entityId:created.id,details:'Created payroll draft'});return created;
    });return res.status(201).json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to create payroll'});}
});
router.patch('/:id',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id),input=inputSchema.omit({employeeId:true,month:true,year:true}).parse(req.body),amounts=calculatePayroll(input.basicSalary,input.allowances,input.deductions);
    const record=await db.transaction(async tx=>{
      const [row]=await tx.select({record:payroll}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user!,'payroll_management','update'))).for('update',{of:payroll});
      if(!row)throw new Error('Payroll not found');if(row.record.status!=='pending')throw new Error('Only pending payroll can be edited');
      const [updated]=await tx.update(payroll).set({...amounts,updatedAt:new Date()}).where(eq(payroll.id,id)).returning();return updated;
    });return res.json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to update payroll'});}
});
router.post('/:id/mark-paid',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id),reference=z.string().trim().min(1).max(150).parse(req.body.reference);
    const record=await db.transaction(async tx=>{
      const [row]=await tx.select({record:payroll}).from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).where(and(eq(payroll.id,id),employeeScope(req.user!,'payroll_management','approve'))).for('update',{of:payroll});
      if(!row)throw new Error('Payroll not found or approval access required');if(row.record.status!=='pending')throw new Error('Payroll is already processed');
      const [updated]=await tx.update(payroll).set({status:'processed',wpsReference:reference,processedBy:req.user!.userId,processedAt:new Date(),updatedAt:new Date()}).where(eq(payroll.id,id)).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'payroll',entityId:id,details:'Recorded external payment reference'});return updated;
    });return res.json(record);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to record payment'});}
});
export default router;
