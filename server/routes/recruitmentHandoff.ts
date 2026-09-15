import {Router} from 'express';
import {z} from 'zod';
import {eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,candidates,jobOffers,jobApplications,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {moduleAccess} from '../middleware/moduleAccess';
import {OnboardingError} from '../services/onboarding-workflow';
const router=Router();router.use(authenticate,moduleAccess);
const id=z.coerce.number().int().positive();
function fail(res:any,error:unknown){const code=(error as any)?.code||(error as any)?.cause?.code;res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:code==='23505'?409:500).json({message:error instanceof OnboardingError?error.message:error instanceof z.ZodError?'Check the handoff fields':code==='23505'?'Candidate, offer or employee is already linked':'Unable to complete hiring handoff'});}
router.get('/job-offers/:id/handoff',async(req,res)=>{
 try{
  const offerId=id.parse(req.params.id);
  const [row]=await db.select({offerId:jobOffers.id,status:jobOffers.status,offerUpdatedAt:jobOffers.updatedAt,applicationId:jobApplications.id,applicationUpdatedAt:jobApplications.updatedAt,candidateName:candidates.fullNameEn}).from(jobOffers).innerJoin(jobApplications,eq(jobOffers.applicationId,jobApplications.id)).innerJoin(candidates,eq(jobApplications.candidateId,candidates.id)).where(eq(jobOffers.id,offerId));
  if(!row)throw new OnboardingError(404,'Offer not found');
  const linked=await db.execute(sql`SELECT employee_id AS "employeeId", created_at AS "createdAt" FROM recruitment_handoffs WHERE offer_id=${offerId}`);
  res.set('Cache-Control','no-store').json({...row,handoff:linked.rows[0]||null});
 }catch(error){fail(res,error);}
});
router.post('/job-offers/:id/handoff',async(req,res)=>{
 try{
  if(!['super_admin','admin','hr_director','hr'].includes(req.user!.role))throw new OnboardingError(403,'HR employee management access is required');
  const offerId=id.parse(req.params.id),input=z.object({employeeId:z.number().int().positive(),expectedEmployeeVersion:z.number().int().positive(),offerUpdatedAt:z.string().datetime(),applicationUpdatedAt:z.string().datetime(),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
   const [offer]=await tx.select().from(jobOffers).where(eq(jobOffers.id,offerId)).for('update');
   if(!offer)throw new OnboardingError(404,'Offer not found');
   const prior=await tx.execute(sql`SELECT employee_id AS "employeeId" FROM recruitment_handoffs WHERE offer_id=${offerId}`);
   if(prior.rows.length){if(prior.rows[0].employeeId!==input.employeeId)throw new OnboardingError(409,'Offer is already linked to a different employee');return {employeeId:input.employeeId,alreadyLinked:true};}
   const [application]=await tx.select().from(jobApplications).where(eq(jobApplications.id,offer.applicationId)).for('update');
   const [candidate]=await tx.select().from(candidates).where(eq(candidates.id,application.candidateId)).for('share');
   const [employee]=await tx.select().from(employees).where(eq(employees.id,input.employeeId)).for('update');
   if(!employee)throw new OnboardingError(404,'Employee not found');
   if(offer.updatedAt.toISOString()!==input.offerUpdatedAt||application.updatedAt.toISOString()!==input.applicationUpdatedAt||employee.recordVersion!==input.expectedEmployeeVersion)throw new OnboardingError(409,'Records changed; reload before linking');
   if(offer.status!=='accepted'||!offer.acceptanceDate||application.status==='rejected')throw new OnboardingError(409,'An accepted offer with an acceptance date is required');
   if(employee.status!=='active')throw new OnboardingError(400,'Select an active employee record');
   if(!candidate.qidNumber||candidate.qidNumber.trim()!==employee.qidNumber.trim())throw new OnboardingError(400,'Candidate and employee QID must match; verify both records before linking');
   await tx.update(jobApplications).set({status:'hired',updatedAt:new Date()}).where(eq(jobApplications.id,application.id));
   await tx.execute(sql`INSERT INTO recruitment_handoffs(offer_id,application_id,candidate_id,employee_id,reason,created_by) VALUES (${offerId},${application.id},${candidate.id},${employee.id},${input.reason},${req.user!.userId})`);
   await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'recruitment_handoff',entityId:offerId,details:'Accepted offer linked to employee record #'+employee.id});
   return {employeeId:employee.id,alreadyLinked:false};
  });res.json(result);
 }catch(error){fail(res,error);}
});
export default router;
