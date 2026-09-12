import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, ne } from 'drizzle-orm';
import { db } from '../db';
import { users, employees, authSessions, userRoleEnum } from '@shared/schema';
import { authenticate, authorize } from '../middleware/auth';
const router=Router();router.use(authenticate,authorize(['admin','super_admin']));
const fields={id:users.id,username:users.username,email:users.email,firstName:users.firstName,lastName:users.lastName,role:users.role,
  isActive:users.isActive,approvalStatus:users.approvalStatus,department:users.department,createdAt:users.createdAt};
router.get('/',async(_req,res)=>{try{return res.json(await db.select(fields).from(users));}catch{return res.status(500).json({message:'Unable to load users'});}});
router.post('/',async(req,res)=>{
  try{const input=z.object({username:z.string().trim().min(3).max(80),email:z.string().email(),firstName:z.string().min(1),lastName:z.string().min(1),
    password:z.string().min(12).max(72),role:z.enum(userRoleEnum.enumValues),department:z.string().optional()}).parse(req.body);
    if(input.role==='super_admin' && req.user!.role!=='super_admin')return res.status(403).json({message:'Only a super administrator can create another super administrator'});
    const [user]=await db.insert(users).values({...input,password:await bcrypt.hash(input.password,12),isActive:true,approvalStatus:'approved',approvedBy:req.user!.userId,approvedAt:new Date()}).returning(fields);
    return res.status(201).json(user);
  }catch(error){return res.status(error instanceof z.ZodError?400:409).json({message:'Check the fields; username and email must be unique'});}
});
router.patch('/:id',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id);
    const input=z.object({role:z.enum(userRoleEnum.enumValues).optional(),isActive:z.boolean().optional(),department:z.string().optional()}).parse(req.body);
    if(id===req.user!.userId)return res.status(400).json({message:'You cannot change your own administrative access'});
    const user=await db.transaction(async tx=>{
      const [target]=await tx.select({role:users.role}).from(users).where(eq(users.id,id)).for('update');
      if(!target)throw new Error('User not found');
      if((target.role==='super_admin'||input.role==='super_admin')&&req.user!.role!=='super_admin')throw new Error('Super administrator access is required');
      const [updated]=await tx.update(users).set({...input,updatedAt:new Date()}).where(eq(users.id,id)).returning(fields);
      await tx.update(authSessions).set({isActive:false}).where(eq(authSessions.userId,id));return updated;
    });return res.json(user);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to update user'});}
});
router.post('/:id/link-employee',async(req,res)=>{
  try{const id=z.coerce.number().int().positive().parse(req.params.id),employeeId=z.coerce.number().int().positive().parse(req.body.employeeId);
    const saved=await db.transaction(async tx=>{
      const [account]=await tx.select({id:users.id}).from(users).where(eq(users.id,id)).for('update');if(!account)throw new Error('User not found');
      const [employee]=await tx.select().from(employees).where(eq(employees.id,employeeId)).for('update');if(!employee)throw new Error('Employee not found');
      if(employee.userId && employee.userId!==id)throw new Error('This employee is linked to another account');
      const [other]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.userId,id),ne(employees.id,employeeId)));
      if(other)throw new Error('This account is already linked to a different employee');
      const [updated]=await tx.update(employees).set({userId:id,updatedAt:new Date()}).where(eq(employees.id,employeeId)).returning({id:employees.id,userId:employees.userId});return updated;
    });return res.json(saved);
  }catch(error){return res.status(400).json({message:error instanceof Error?error.message:'Unable to link employee'});}
});
export default router;
