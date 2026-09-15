import {Router} from 'express';
import {z} from 'zod';
import {and,eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {correctionFields} from '@shared/employee-corrections';
import {OnboardingError} from '../services/onboarding-workflow';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const reviewer=(role:string)=>['super_admin','admin','hr_director','hr'].includes(role);
const id=z.coerce.number().int().positive();
const reason=z.string().trim().min(5).max(1000);
function fail(res:any,error:unknown){const code=(error as any)?.code||(error as any)?.cause?.code;res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:code==='23505'?409:500).json({message:error instanceof OnboardingError?error.message:error instanceof z.ZodError?'Check the requested correction fields':code==='23505'?'Withdraw or resolve the pending correction first':'Unable to save employee correction'});}
router.get('/corrections',async(req,res)=>{try{
 if(!reviewer(req.user!.role))throw new OnboardingError(403,'HR reviewer access is required');
 const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const result=await db.execute(sql`SELECT c.id,c.employee_id,employees.first_name || ' ' || employees.last_name AS employee_name,c.created_at FROM employee_corrections c JOIN employees ON employees.id=c.employee_id WHERE c.status='pending' AND ${employeeScope(req.user!,'employee_database')} ORDER BY c.id LIMIT 25 OFFSET ${(page-1)*25}`);res.json(result.rows);
}catch(error){fail(res,error);}});
router.get('/:id/corrections',async(req,res)=>{try{
 const employeeId=id.parse(req.params.id);const [employee]=await db.select().from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'employee_database')));
 if(!employee||(!reviewer(req.user!.role)&&employee.userId!==req.user!.userId))throw new OnboardingError(404,'Employee corrections not found');
 const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const rows=await db.execute(sql`SELECT * FROM employee_corrections WHERE employee_id=${employeeId} ORDER BY id DESC LIMIT 25 OFFSET ${(page-1)*25}`);
 res.json({canRequest:employee.userId===req.user!.userId,canReview:reviewer(req.user!.role)&&employee.userId!==req.user!.userId,items:rows.rows});
}catch(error){fail(res,error);}});
router.post('/:id/corrections',async(req,res)=>{try{
 const employeeId=id.parse(req.params.id),input=z.object({expectedVersion:z.number().int().positive(),patch:correctionFields,reason}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [employee]=await tx.select().from(employees).where(and(eq(employees.id,employeeId),eq(employees.userId,req.user!.userId))).for('update');
  if(!employee)throw new OnboardingError(404,'Linked employee record not found');
  if(employee.recordVersion!==input.expectedVersion)throw new OnboardingError(409,'Employee record changed; reload before requesting a correction');
  const patch=Object.fromEntries(Object.entries(input.patch).filter(([k,v])=>v!==employee[k as keyof typeof employee]));
  if(!Object.keys(patch).length)throw new OnboardingError(400,'Choose at least one changed value');
  const previous=Object.fromEntries(Object.keys(patch).map(k=>[k,employee[k as keyof typeof employee]]));
  const saved=await tx.execute(sql`INSERT INTO employee_corrections(employee_id,requester_id,employee_version,patch,previous_values,reason) VALUES (${employee.id},${req.user!.userId},${employee.recordVersion},${JSON.stringify(patch)}::jsonb,${JSON.stringify(previous)}::jsonb,${input.reason}) RETURNING *`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'employee_correction',entityId:Number(saved.rows[0].id),details:'Employee correction requested: '+Object.keys(patch).join(', ')});return saved.rows[0];
 });res.status(201).json(result);
}catch(error){fail(res,error);}});
router.post('/:id/corrections/:correctionId/decision',async(req,res)=>{try{
 const employeeId=id.parse(req.params.id),requestId=id.parse(req.params.correctionId),input=z.object({action:z.enum(['approve','reject','withdraw']),reason}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [employee]=await tx.select().from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user!,'employee_database'))).for('update');
  if(!employee||(!reviewer(req.user!.role)&&employee.userId!==req.user!.userId))throw new OnboardingError(404,'Employee correction not found');
  const rows=await tx.execute(sql`SELECT * FROM employee_corrections WHERE id=${requestId} AND employee_id=${employeeId} FOR UPDATE`);const request=rows.rows[0];if(!request)throw new OnboardingError(404,'Correction not found');
  if(request.status!=='pending')throw new OnboardingError(409,'Correction is already decided');
  if(input.action==='withdraw'){if(request.requester_id!==req.user!.userId)throw new OnboardingError(403,'Only the requester can withdraw');}
  else if(!reviewer(req.user!.role)||request.requester_id===req.user!.userId||employee.userId===req.user!.userId)throw new OnboardingError(403,'An independent HR reviewer must decide this correction');
  if(input.action==='approve'){
   if(employee.recordVersion!==request.employee_version)throw new OnboardingError(409,'Employee record changed; reject or withdraw this request and submit a fresh correction');
   const patch=correctionFields.parse(request.patch);await tx.update(employees).set(patch).where(eq(employees.id,employeeId));
   await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'employee',entityId:employeeId,details:'Approved employee correction fields: '+Object.keys(patch).join(', ')});
  }
  const status=input.action==='approve'?'approved':input.action==='reject'?'rejected':'withdrawn';
  const saved=await tx.execute(sql`UPDATE employee_corrections SET status=${status},decided_by=${req.user!.userId},decision_reason=${input.reason},decided_at=now() WHERE id=${requestId} RETURNING *`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'employee_correction',entityId:requestId,details:'Employee correction '+status});return saved.rows[0];
 });res.json(result);
}catch(error){fail(res,error);}});
export default router;
