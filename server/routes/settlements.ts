import {Router} from 'express';
import {z} from 'zod';
import {and,eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {hasPermission,type Permission} from '@shared/permissions';
import {civilDate} from '@shared/calculation-rules';
import {moneyCents,moneyText} from '@shared/money';
import {OnboardingError} from '../services/onboarding-workflow';
const router=Router();router.use(authenticate);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!['super_admin','admin','hr_director','hr','finance','payroll_specialist','finance_audit'].includes(req.user!.role))return res.status(403).json({message:'Detailed payroll access is required'});next();});
const id=z.number().int().positive(),reason=z.string().trim().min(5).max(1000);
const line=z.object({label:z.string().trim().min(2).max(120),kind:z.enum(['earning','deduction']),amount:z.string().refine(s=>{try{return moneyCents(s)>0;}catch{return false;}},'Enter a positive amount with up to two decimals'),basis:z.string().trim().min(5).max(1000)}).strict();
const lines=z.array(line).min(1).max(100);
type Line=z.infer<typeof line>;
type Row={id:number;employee_id:number;exit_date:string;version:number;status:'draft'|'submitted'|'approved'|'paid';lines:Line[];net_amount:string;created_by:number;edited_by:number;approved_by:number|null;payment_reference:string|null};
const total=(items:Line[])=>{const cents=items.reduce((n,l)=>n+(l.kind==='earning'?1:-1)*moneyCents(l.amount),0);if(cents<0||!Number.isSafeInteger(cents))throw new OnboardingError(400,'Deductions exceed earnings or total is too large');return moneyText(cents);};
function fail(res:any,error:unknown){const code=(error as any)?.code||(error as any)?.cause?.code;res.status(error instanceof OnboardingError?error.status:error instanceof z.ZodError?400:code==='23505'?409:500).json({message:error instanceof OnboardingError?error.message:error instanceof z.ZodError?error.issues.map(i=>i.message).join('; '):code==='23505'?'A settlement already exists for this employee and exit date':'Unable to save final settlement'});}
const rights=(req:any,row:Row)=>({edit:row.status==='draft'&&hasPermission(req.user.role,'payroll_management','update'),submit:row.status==='draft'&&hasPermission(req.user.role,'payroll_management','update'),review:row.status==='submitted'&&row.edited_by!==req.user.userId&&row.created_by!==req.user.userId&&hasPermission(req.user.role,'payroll_management','approve'),pay:row.status==='approved'&&hasPermission(req.user.role,'payroll_management','approve')});
router.get('/',async(req,res)=>{try{
 const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const result=await db.execute(sql`SELECT s.*, NOT EXISTS(SELECT 1 FROM settlement_history h WHERE h.settlement_id=s.id AND h.snapshot->>'edited_by'=${String(req.user!.userId)}) AS independent, employees.first_name || ' ' || employees.last_name AS employee_name FROM final_settlements s JOIN employees ON employees.id=s.employee_id WHERE ${employeeScope(req.user!,'payroll_management')} ORDER BY s.id DESC LIMIT 25 OFFSET ${(page-1)*25}`);
 res.json({canCreate:hasPermission(req.user!.role,'payroll_management','create'),items:result.rows.map(r=>({...r,capabilities:{...rights(req,r as unknown as Row),review:!!r.independent&&rights(req,r as unknown as Row).review}}))});
}catch(error){fail(res,error);}});
router.get('/:id/history',async(req,res)=>{try{
 const caseId=z.coerce.number().int().positive().parse(req.params.id);
 const found=await db.execute(sql`SELECT s.id FROM final_settlements s JOIN employees ON employees.id=s.employee_id WHERE s.id=${caseId} AND ${employeeScope(req.user!,'payroll_management')}`);
 if(!found.rows.length)throw new OnboardingError(404,'Settlement not found');
 const result=await db.execute(sql`SELECT version,snapshot,actor_id,reason,created_at FROM settlement_history WHERE settlement_id=${caseId} ORDER BY version DESC LIMIT 100`);res.json(result.rows);
}catch(error){fail(res,error);}});
router.post('/',async(req,res)=>{try{
 const input=z.object({employeeId:id,exitDate:civilDate,lines,reason}).strict().parse(req.body),net=total(input.lines);
 const row=await db.transaction(async tx=>{
  const [employee]=await tx.select().from(employees).where(and(eq(employees.id,input.employeeId),employeeScope(req.user!,'payroll_management','create'))).for('update');
  if(!employee)throw new OnboardingError(403,'Payroll creation access is required');
  if(employee.userId===req.user!.userId)throw new OnboardingError(403,'Another payroll manager must prepare your settlement');
  const result=await tx.execute(sql`INSERT INTO final_settlements(employee_id,exit_date,lines,net_amount,created_by,edited_by) VALUES (${employee.id},${input.exitDate},${JSON.stringify(input.lines)}::jsonb,${net},${req.user!.userId},${req.user!.userId}) RETURNING *`);
  const saved=result.rows[0];await tx.execute(sql`INSERT INTO settlement_history(settlement_id,version,snapshot,actor_id,reason) VALUES (${saved.id},1,${JSON.stringify(saved)}::jsonb,${req.user!.userId},${input.reason})`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'final_settlement',entityId:Number(saved.id),details:'Final settlement draft created'});return saved;
 });res.status(201).json(row);
}catch(error){fail(res,error);}});
router.post('/:id/actions',async(req,res)=>{try{
 const caseId=z.coerce.number().int().positive().parse(req.params.id),input=z.discriminatedUnion('action',[
  z.object({action:z.literal('edit'),version:id,lines,reason}).strict(),
  z.object({action:z.enum(['submit','approve','return']),version:id,reason}).strict(),
  z.object({action:z.literal('pay'),version:id,reference:z.string().trim().min(3).max(150),reason}).strict()
 ]).parse(req.body);
 const permission:Permission=['approve','return','pay'].includes(input.action)?'approve':'update';
 const result=await db.transaction(async tx=>{
  const rows=await tx.execute(sql`SELECT s.* FROM final_settlements s JOIN employees ON employees.id=s.employee_id WHERE s.id=${caseId} AND ${employeeScope(req.user!,'payroll_management',permission)} FOR UPDATE OF s`);
  const row=rows.rows[0] as unknown as Row;if(!row)throw new OnboardingError(404,'Settlement not found or action access denied');
  const [employee]=await tx.select().from(employees).where(eq(employees.id,row.employee_id));
  if(employee.userId===req.user!.userId)throw new OnboardingError(403,'Another payroll manager must handle your settlement');
  if(row.version!==input.version)throw new OnboardingError(409,'Settlement changed; reload before saving');
  let status=row.status,items=row.lines,approvedBy=row.approved_by,reference=row.payment_reference,editor=row.edited_by;
  if(input.action==='edit'){if(status!=='draft')throw new OnboardingError(409,'Only drafts can be edited');items=input.lines;editor=req.user!.userId;}
  else if(input.action==='submit'){if(status!=='draft')throw new OnboardingError(409,'Only drafts can be submitted');status='submitted';editor=req.user!.userId;}
  else if(input.action==='approve'||input.action==='return'){
   if(status!=='submitted')throw new OnboardingError(409,'Only submitted settlements can be reviewed');
   if(row.created_by===req.user!.userId||row.edited_by===req.user!.userId)throw new OnboardingError(403,'An independent payroll approver must review this settlement');
   const prepared=await tx.execute(sql`SELECT id FROM settlement_history WHERE settlement_id=${caseId} AND snapshot->>'edited_by'=${String(req.user!.userId)} LIMIT 1`);
   if(prepared.rows.length)throw new OnboardingError(403,'A previous preparer cannot approve or return this settlement');
   status=input.action==='approve'?'approved':'draft';approvedBy=input.action==='approve'?req.user!.userId:null;
  }else if(input.action==='pay'){if(status!=='approved')throw new OnboardingError(409,'Approve the settlement before recording payment');status='paid';reference=input.reference;}
  const net=total(items);
  const saved=await tx.execute(sql`UPDATE final_settlements SET version=version+1,status=${status},lines=${JSON.stringify(items)}::jsonb,net_amount=${net},edited_by=${editor},approved_by=${approvedBy},payment_reference=${reference},updated_at=now() WHERE id=${caseId} RETURNING *`);
  await tx.execute(sql`INSERT INTO settlement_history(settlement_id,version,snapshot,actor_id,reason) VALUES (${caseId},${row.version+1},${JSON.stringify(saved.rows[0])}::jsonb,${req.user!.userId},${input.reason})`);
  await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'final_settlement',entityId:caseId,details:'Final settlement action: '+input.action});return saved.rows[0];
 });res.json(result);
}catch(error){fail(res,error);}});
export default router;
