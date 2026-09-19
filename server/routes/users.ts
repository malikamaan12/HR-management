import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq, and, ne, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, employees, authSessions, securityLogs, userRoleEnum } from '@shared/schema';
import { authenticate, authorize } from '../middleware/auth';
import { accountFields as fields, accountActor, accountTarget, auditAccount, invalidateAccount, updateAccount, provisionEmployees, setupSecret } from '../services/account-management';
const router = Router();
router.use(authenticate, authorize(['admin','super_admin']));
router.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
const idSchema = z.coerce.number().int().positive();
const controlSchema = z.object({ accountVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }).strict();
const errorResponse = (res: any, error: unknown) => res.status(400).json({ message: error instanceof z.ZodError ? 'Check the fields and provide a valid work email, version and reason' : error instanceof Error ? error.message : 'Unable to update account' });
router.get('/', async (_req,res) => { try { return res.json(await db.select(fields).from(users).orderBy(users.id)); } catch { return res.status(500).json({message:'Unable to load accounts'}); } });
router.post('/provision-employees', async (req,res) => {
  try {
    const input = z.object({ employeeIds: z.array(idSchema).min(1).max(500), preview: z.boolean(), versions: z.record(z.number().int().positive()).optional() }).strict().parse(req.body);
    return res.json({ accounts: await provisionEmployees(req.user!.userId,input.employeeIds,input.preview,input.versions) });
  } catch(error) { return errorResponse(res,error); }
});
router.post('/', async (req,res) => {
  try {
    const input = z.object({ username:z.string().trim().min(3).max(254), email:z.string().trim().email().max(254), firstName:z.string().trim().min(1).max(100), lastName:z.string().trim().min(1).max(100), password:z.string().min(12).max(72), role:z.enum(userRoleEnum.enumValues), department:z.string().max(100).optional() }).strict().parse(req.body);
    const password = await bcrypt.hash(input.password,12);
    const user = await db.transaction(async tx => {
      const actor = await accountActor(tx,req.user!.userId);
      if(input.role==='super_admin' && actor.role!=='super_admin') throw new Error('Only a super administrator can create another super administrator');
      const [existing] = await tx.select({id:users.id}).from(users).where(sql`lower(${users.username})=lower(${input.username}) OR lower(${users.email})=lower(${input.email})`);
      if(existing) throw new Error('Username or email already used');
      const [created] = await tx.insert(users).values({...input,password,isActive:true,approvalStatus:'approved',approvedBy:actor.id,approvedAt:new Date()}).returning(fields);
      await auditAccount(tx,actor.id,created.id,'Account created','Manual administrator account creation',{role:created.role});
      return created;
    });
    return res.status(201).json(user);
  } catch(error) { return errorResponse(res,error); }
});
router.patch('/:id', async(req,res) => {
  try { return res.json(await updateAccount(req.user!.userId,idSchema.parse(req.params.id),req.body)); }
  catch(error) { return errorResponse(res,error); }
});
router.get('/:id/history', async(req,res) => {
  try { const id=idSchema.parse(req.params.id); return res.json(await db.select({id:securityLogs.id,actorId:securityLogs.userId,timestamp:securityLogs.timestamp,description:securityLogs.description,metadata:securityLogs.metadata}).from(securityLogs).where(and(eq(securityLogs.resourceType,'account'),eq(securityLogs.resourceId,String(id)))).orderBy(desc(securityLogs.id)).limit(100)); }
  catch(error) { return errorResponse(res,error); }
});
router.post('/:id/:action(password-setup|revoke-sessions|unlock|approve)', async(req,res) => {
  try {
    const id=idSchema.parse(req.params.id), input=controlSchema.parse(req.body), action=req.params.action;
    const result=await db.transaction(async tx => {
      const actor=await accountActor(tx,req.user!.userId), target=await accountTarget(tx,actor,id,input.accountVersion);
      if ((action==='password-setup'||action==='approve') && target.accountState!=='active') throw new Error('Restore account access before this action');
      if(action==='password-setup' && target.approvalStatus!=='approved') throw new Error('Approve this account first');
      const secret=action==='password-setup'?setupSecret():null;
      await tx.update(users).set({accountVersion:target.accountVersion+1,updatedAt:new Date(),refreshToken:null,passwordResetToken:secret?.hash??null,passwordResetExpires:secret?.expiresAt??null,
        ...(secret?{passwordSetupRequired:true}:{}),
        ...(action==='unlock'?{failedLoginAttempts:0,lockoutUntil:null}:{}),
        ...(action==='approve'?{approvalStatus:'approved' as const,isActive:true,approvedBy:actor.id,approvedAt:new Date()}:{}),
      }).where(eq(users.id,id));
      await invalidateAccount(tx,id);
      await auditAccount(tx,actor.id,id,action,input.reason);
      return secret?{setupToken:secret.token,expiresAt:secret.expiresAt}:{success:true};
    });
    return res.json(result);
  } catch(error) { return errorResponse(res,error); }
});
router.post('/:id/link-employee', async(req,res) => {
  try {
    const id=idSchema.parse(req.params.id), employeeId=idSchema.parse(req.body.employeeId);
    const saved=await db.transaction(async tx => {
      const actor=await accountActor(tx,req.user!.userId); await accountTarget(tx,actor,id);
      const [employee]=await tx.select().from(employees).where(eq(employees.id,employeeId)).for('update');
      if(!employee)throw new Error('Employee not found');
      if(employee.userId && employee.userId!==id)throw new Error('This employee is linked to another account');
      const [other]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.userId,id),ne(employees.id,employeeId)));
      if(other)throw new Error('This account is already linked to a different employee');
      const [updated]=await tx.update(employees).set({userId:id,recordVersion:employee.recordVersion+1,updatedAt:new Date()}).where(eq(employees.id,employeeId)).returning({id:employees.id,userId:employees.userId});
      await invalidateAccount(tx,id);
      await tx.update(users).set({accountVersion:sql`${users.accountVersion} + 1`,passwordResetToken:null,passwordResetExpires:null,updatedAt:new Date()}).where(eq(users.id,id));
      await auditAccount(tx,actor.id,id,'Employee linked','Administrator verified employee identity',{employeeId});
      return updated;
    }); return res.json(saved);
  } catch(error) { return errorResponse(res,error); }
});
export default router;
