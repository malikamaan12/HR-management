import {Router} from 'express';
import {z} from 'zod';
import bcrypt from 'bcryptjs';
import {eq} from 'drizzle-orm';
import {db} from '../db';
import {users,authSessions,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {credentialRateLimit} from '../middleware/security';
import {recordHandler,WorkflowError} from '../services/workflowRecords';
import {mfaConfigured,mfaState,mfaRequired,startMfa,finishMfa,verifyMfa} from '../services/mfa';
const router=Router();router.use(authenticate,credentialRateLimit);
router.get('/',recordHandler(async(req,res)=>{const state=await mfaState(db,req.user.userId);res.json({configured:mfaConfigured(),enabled:!!state?.enabled,required:mfaRequired(req.user.role)});}));
router.post('/start',recordHandler(async(req,res)=>{
 const {password,secondFactor}=z.object({password:z.string().min(1).max(1024),secondFactor:z.string().max(24).optional()}).strict().parse(req.body);
 const [original]=await db.select().from(users).where(eq(users.id,req.user.userId));
 if(!original?.isActive||original.accountState!=='active'||!await bcrypt.compare(password,original.password))throw new WorkflowError(401,'Current password is incorrect or account access changed');
 const verified=await verifyMfa(original.id,secondFactor||'');
 res.json(await db.transaction(async tx=>{
  const [u]=await tx.select().from(users).where(eq(users.id,req.user.userId)).for('update');
  if(!u?.isActive||u.accountState!=='active'||u.password!==original.password||u.accountVersion!==original.accountVersion)throw new WorkflowError(401,'Account access changed. Sign in again.');
  return startMfa(tx,u.id,u.username,verified??undefined);
 }));
}));
router.post('/confirm',recordHandler(async(req,res)=>{
 const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [u]=await tx.select().from(users).where(eq(users.id,req.user.userId)).for('update');
  if(!u?.isActive||u.accountState!=='active')throw new WorkflowError(401,'Account access changed');
  const outcome=await finishMfa(tx,u.id,code);
  if('error' in outcome)return outcome;
  await tx.update(authSessions).set({isActive:false}).where(eq(authSessions.userId,u.id));
  await tx.insert(activityLogs).values({userId:u.id,action:'update',entityType:'account_mfa',entityId:u.id,details:'Authenticator enabled; all existing sessions revoked'});
  return outcome;
 });
 if('error' in result)throw new WorkflowError(400,'The authenticator code did not match. Wait 15 minutes after repeated failures.');
 res.json({recoveryCodes:result.codes,message:'Save these recovery codes securely. Sign in again with your authenticator.'});
}));
export default router;
