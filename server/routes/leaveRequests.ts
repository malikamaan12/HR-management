import { getCompanySettings } from '../services/settings';
import { lockEmployee, assertLeaveCompatible, WorkforceError } from '../services/workforce';
import { leaveDays, employeeWeekendDays } from '@shared/settings';
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { employees, leaves, leaveTypes, insertLeaveSchema, activityLogs } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
const router=Router();router.use(authenticate);
const statusSchema=z.enum(['pending','approved','rejected','cancelled']);
const idSchema=z.coerce.number().int().positive();
router.post('/',async(req,res)=>{
  try{
    const policy=await getCompanySettings();
    const employeeId=idSchema.parse(req.body.employeeId);
    const [employee]=await db.select({id:employees.id,workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'leave_absence_management','create')));
    if(!employee)return res.status(403).json({message:'You cannot request leave for this employee'});
    let totalDays:number;
    try{totalDays=leaveDays(req.body.startDate,req.body.endDate,employeeWeekendDays(employee,policy));}catch{return res.status(400).json({message:'Choose valid leave dates within a period of at most one year'});}
    const input=insertLeaveSchema.parse({...req.body,employeeId,totalDays,status:'pending',approvedBy:null,approvedAt:null});
    if(input.endDate<input.startDate || !Number.isInteger(input.totalDays) || input.totalDays<1)return res.status(400).json({message:'Check the leave dates and duration'});
    const [leave]=await db.insert(leaves).values(input).returning();return res.status(201).json(leave);
  }catch(error){return res.status(error instanceof z.ZodError?400:500).json({message:'Unable to create leave request'});}
});
router.get(['/', '/pending','/status/:status'],async(req,res)=>{
  try{
    const status=req.path==='/pending'?'pending':req.params.status ? statusSchema.parse(req.params.status):undefined;
    const rows=await db.select({leave:leaves,employee:{id:employees.id,firstName:employees.firstName,lastName:employees.lastName,department:employees.department,position:employees.position},typeId:leaveTypes.id}).from(leaves)
      .innerJoin(employees,eq(leaves.employeeId,employees.id)).leftJoin(leaveTypes,eq(leaves.leaveType,leaveTypes.name))
      .where(and(employeeScope(req.user!,'leave_absence_management'),status?eq(leaves.status,status):undefined)).orderBy(desc(leaves.createdAt));
    return res.json(rows.map(({leave,employee,typeId})=>({...leave,employee,leaveType:{id:typeId,name:leave.leaveType}})));
  }catch{return res.status(400).json({message:'Unable to load leave requests'});}
});
router.get('/:id',async(req,res)=>{
  try{
    const id=idSchema.parse(req.params.id);
    const [row]=await db.select({leave:leaves}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id)).where(and(eq(leaves.id,id),employeeScope(req.user!,'leave_absence_management')));
    if(!row)return res.status(404).json({message:'Leave request not found'});return res.json(row.leave);
  }catch{return res.status(400).json({message:'Invalid leave request'});}
});
router.patch('/:id/status',async(req,res)=>{
  try{
    const id=idSchema.parse(req.params.id),status=z.enum(['approved','rejected','cancelled']).parse(req.body.status);
    const result=await db.transaction(async tx=>{
      const [row]=await tx.select({leave:leaves,userId:employees.userId}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id))
        .where(and(eq(leaves.id,id),employeeScope(req.user!,'leave_absence_management',status==='cancelled'?'update':'approve'))).for('update',{of:leaves});
      if(!row)return null;
      if(row.leave.status!=='pending')throw new Error('This request has already been decided');
      if(status!=='cancelled' && row.userId===req.user!.userId)throw new Error('You cannot approve or reject your own request');
      if(status==='approved') {
        await lockEmployee(tx,row.leave.employeeId);
        await assertLeaveCompatible(tx,row.leave.employeeId,row.leave.startDate,row.leave.endDate);
      }
      const [updated]=await tx.update(leaves).set({status,approvedBy:req.user!.userId,approvedAt:new Date(),updatedAt:new Date()}).where(eq(leaves.id,id)).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'leave',entityId:id,details:`Leave request ${status}`});
      return updated;
    });
    if(!result)return res.status(403).json({message:'You cannot decide this request'});return res.json(result);
  }catch(error){return res.status(error instanceof WorkforceError?error.status:400).json({message:error instanceof Error?error.message:'Unable to decide leave request'});}
});
export default router;
