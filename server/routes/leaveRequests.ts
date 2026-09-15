import leaveOperations from './leaveOperations';
import {hundredths} from '@shared/operations-policies';
import {calculationSnapshot} from '../services/calculation-rules';
import {leaveAccount,assertLeaveFunds} from '../services/leave-ledger';
import {calculateLeave,civilDate} from '@shared/calculation-rules';
import { lockEmployee, assertLeaveCompatible, WorkforceError } from '../services/workforce';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql, gte, lte, ne, or } from 'drizzle-orm';
import { db } from '../db';
import { employees, leaves, leaveTypes, leaveLedger, insertLeaveSchema, activityLogs } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
const router=Router();router.use(authenticate);router.use(leaveOperations);
const statusSchema=z.enum(['pending','approved','rejected','cancelled']);
const idSchema=z.coerce.number().int().positive();
router.get('/balances/:employeeId/:year',async(req,res)=>{
 try{
  const employeeId=idSchema.parse(req.params.employeeId),year=z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
  const [visible]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'leave_absence_management')));
  if(!visible)return res.status(404).json({message:'Employee not found'});
  const types=await db.select({name:leaveTypes.name}).from(leaveTypes);
  const entries=await db.select().from(leaveLedger).where(and(eq(leaveLedger.employeeId,employeeId),eq(leaveLedger.year,year))).orderBy(desc(leaveLedger.id));
  const names=[...new Set([...types.map(t=>t.name),...entries.map(e=>e.leaveType)])];
  return res.json({accounts:await Promise.all(names.map(name=>leaveAccount(db,employeeId,name,year))),entries,canAllocate:['admin','super_admin'].includes(req.user!.role)});
 }catch{return res.status(400).json({message:'Unable to load leave ledger'});}
});
router.post('/balances/:employeeId/:year',async(req,res)=>{
 try{
  if(!['admin','super_admin'].includes(req.user!.role))return res.status(403).json({message:'Administrator access is required for leave allocations'});
  const employeeId=idSchema.parse(req.params.employeeId),year=z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
  const input=z.object({leaveType:z.string().trim().min(1).max(100),days:hundredths.refine(n=>n>=-3660&&n<=3660&&n!==0),reason:z.string().trim().min(5).max(500),reference:z.string().trim().min(5).max(100),expectedVersion:z.number().int().min(0)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    await lockEmployee(tx,employeeId);
    const [type]=await tx.select({name:leaveTypes.name}).from(leaveTypes).where(eq(leaveTypes.name,input.leaveType));
    if(!type)throw new WorkforceError(400,'Choose a configured leave type');
    const [duplicate]=await tx.select().from(leaveLedger).where(and(eq(leaveLedger.employeeId,employeeId),eq(leaveLedger.leaveType,input.leaveType),eq(leaveLedger.year,year),eq(leaveLedger.reference,input.reference)));
    if(duplicate){if(duplicate.days!==input.days||duplicate.reason!==input.reason)throw new WorkforceError(409,'This reference was already used for another allocation');return duplicate;}
    const account=await leaveAccount(tx,employeeId,input.leaveType,year);
    if(account.version!==input.expectedVersion)throw new WorkforceError(409,'The allocation changed; reload the ledger');
    if(account.needsReconciliation)throw new WorkforceError(409,'Reconcile legacy cross-year leave before activating this ledger');
    if(account.available+input.days<0)throw new WorkforceError(409,'Allocation must cover approved and pending leave');
    const [entry]=await tx.insert(leaveLedger).values({employeeId,year,leaveType:input.leaveType,days:input.days,reason:input.reason,reference:input.reference,createdBy:req.user!.userId}).returning();
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'leave_ledger',entityId:entry.id,details:'Leave allocation recorded'});
    return entry;
  });return res.status(201).json(result);
 }catch(error){return res.status(error instanceof WorkforceError?error.status:error instanceof z.ZodError?400:500).json({message:error instanceof WorkforceError?error.message:error instanceof z.ZodError?'Check allocation fields':'Unable to allocate leave'});}
});
router.get('/calendar',async(req,res)=>{
  try{
    const start=civilDate.parse(req.query.start),end=civilDate.parse(req.query.end);
    if(end<start||(Date.parse(end)-Date.parse(start))/86400000>62)return res.status(400).json({message:'Choose a calendar range of up to 63 days'});
    const rows=await db.select({id:leaves.id,employeeId:employees.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,department:employees.department,startDate:leaves.startDate,endDate:leaves.endDate,totalDays:leaves.totalDays})
      .from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id)).where(and(employeeScope(req.user!,'leave_absence_management'),eq(leaves.status,'approved'),lte(leaves.startDate,end),gte(leaves.endDate,start))).orderBy(leaves.startDate,leaves.id);
    return res.json(rows);
  }catch{return res.status(400).json({message:'Choose valid calendar dates'});}
});
router.get('/quote',async(req,res)=>{
 try{const employeeId=idSchema.parse(req.query.employeeId),start=civilDate.parse(req.query.start),end=civilDate.parse(req.query.end);
  const [employee]=await db.select({workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'leave_absence_management','create')));
  if(!employee)return res.status(403).json({message:'You cannot request leave for this employee'});
  const snapshot=await calculationSnapshot(employee,start);
  const fraction=z.coerce.number().refine(v=>v===0.5||v===1).parse(req.query.fraction??1);if(fraction===0.5&&(start!==end||!snapshot.rules.leave.allowHalfDays))throw new Error('Half-day requests require a single date and an enabled policy');
  return res.json({...calculateLeave(start,end,snapshot),totalDays:calculateLeave(start,end,snapshot).totalDays*fraction,version:snapshot.version,scope:snapshot.scope});
 }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Check the leave dates'});}
});
export async function createLeaveRequest(req:Request,res:Response){
  try{
    const employeeId=idSchema.parse(req.body.employeeId);
    const [employee]=await db.select({id:employees.id,workSchedule:employees.workSchedule}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'leave_absence_management','create')));
    if(!employee)return res.status(403).json({message:'You cannot request leave for this employee'});
    const configured=await db.select({name:leaveTypes.name,active:leaveTypes.active}).from(leaveTypes);
    if(configured.length&&!configured.some(type=>type.name===req.body.leaveType&&type.active))return res.status(400).json({message:'Choose an active configured leave type'});
    const fraction=z.number().refine(v=>v===0.5||v===1).parse(req.body.dayFraction??1);
    let totalDays:number,snapshot;
    try{civilDate.parse(req.body.startDate);snapshot=await calculationSnapshot(employee,req.body.startDate);if(fraction===0.5&&(req.body.startDate!==req.body.endDate||!snapshot.rules.leave.allowHalfDays))throw new Error('Half-day requests require a single date and an enabled policy');totalDays=calculateLeave(req.body.startDate,req.body.endDate,snapshot).totalDays*fraction;}catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Choose valid leave dates'});}
    const input=insertLeaveSchema.parse({...req.body,employeeId,totalDays,dayFraction:fraction,calculationSnapshot:snapshot,status:'pending',approvedBy:null,approvedAt:null});
    if(input.endDate<input.startDate || !Number.isInteger(input.totalDays*2) || input.totalDays<0.5)return res.status(400).json({message:'Check the leave dates and duration'});
    const leave=await db.transaction(async tx=>{
      await lockEmployee(tx,employeeId);
      await assertLeaveFunds(tx,employeeId,input.leaveType,input.startDate,input.endDate,snapshot,fraction);
      const [created]=await tx.insert(leaves).values(input).returning();
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'leave',entityId:created.id,details:'Leave requested'});
      return created;
    });return res.status(201).json({...leave,success:true,leaveId:leave.id,message:'Leave request submitted successfully'});
  }catch(error){return res.status(error instanceof WorkforceError?error.status:error instanceof z.ZodError?400:500).json({message:error instanceof WorkforceError?error.message:'Unable to create leave request'});}
}
router.post('/',createLeaveRequest);
router.get(['/', '/pending','/status/:status'],async(req,res)=>{
  try{
    const status=req.path==='/pending'?'pending':req.params.status ? statusSchema.parse(req.params.status):undefined;
    const rows=await db.select({leave:leaves,employee:{id:employees.id,firstName:employees.firstName,lastName:employees.lastName,department:employees.department,position:employees.position},typeId:leaveTypes.id,
      canApprove:sql<boolean>`${employeeScope(req.user!,'leave_absence_management','approve')} and (${employees.userId} is null or ${employees.userId} <> ${req.user!.userId})`,
      canCancel:sql<boolean>`${or(employeeScope(req.user!,'leave_absence_management','update'),and(eq(employees.userId,req.user!.userId),employeeScope(req.user!,'leave_absence_management','create')))}`}).from(leaves)
      .innerJoin(employees,eq(leaves.employeeId,employees.id)).leftJoin(leaveTypes,eq(leaves.leaveType,leaveTypes.name))
      .where(and(employeeScope(req.user!,'leave_absence_management'),status?eq(leaves.status,status):undefined)).orderBy(desc(leaves.createdAt));
    return res.json(rows.map(({leave,employee,typeId,canApprove,canCancel})=>({...leave,employee,canApprove:canApprove&&leave.status==='pending',canCancel:canCancel&&leave.status==='pending',leaveType:{id:typeId,name:leave.leaveType}})));
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
        .where(and(eq(leaves.id,id),status==='cancelled'?or(employeeScope(req.user!,'leave_absence_management','update'),and(eq(employees.userId,req.user!.userId),employeeScope(req.user!,'leave_absence_management','create'))):employeeScope(req.user!,'leave_absence_management','approve'))).for('update',{of:leaves});
      if(!row)return null;
      if(row.leave.status!=='pending')throw new Error('This request has already been decided');
      if(status!=='cancelled' && row.userId===req.user!.userId)throw new Error('You cannot approve or reject your own request');
      if(status==='approved') {
        await lockEmployee(tx,row.leave.employeeId);
        const [overlap]=await tx.select({id:leaves.id}).from(leaves).where(and(eq(leaves.employeeId,row.leave.employeeId),ne(leaves.id,id),eq(leaves.status,'approved'),lte(leaves.startDate,row.leave.endDate),gte(leaves.endDate,row.leave.startDate))).limit(1);
        if(overlap)throw new WorkforceError(409,'This employee already has approved leave during these dates');
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
