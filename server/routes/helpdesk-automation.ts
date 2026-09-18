import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { authenticate } from '../middleware/auth';
import { helpdeskAutomationInput } from '@shared/helpdesk-automation';
import { positiveId, reason } from '@shared/hr-rules';
import { capabilities, readCase, HelpdeskError, checkVersion } from '../services/helpdesk';
import { WorkflowError, recordHistory, requireAdmin } from '../services/workflowRecords';
import { caseAutomationSnapshot, helpdeskAutomationPolicy, runHelpdeskAutomation } from '../services/helpdesk-automation';

const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{await fn(req,res);}catch(error){res.status(error instanceof WorkflowError||error instanceof HelpdeskError?error.status:error instanceof z.ZodError?400:500).json({message:error instanceof WorkflowError||error instanceof HelpdeskError?error.message:error instanceof z.ZodError?error.issues.map(issue=>issue.message).join('; '):'Unable to complete helpdesk automation action'});}};
router.get('/config',handle(async(req,res)=>res.json({canConfigure:['admin','super_admin'].includes(req.user!.role)})));
router.get('/policy',handle(async(req,res)=>{requireAdmin(req);res.json({policy:await helpdeskAutomationPolicy(db),runtime:(await db.execute(sql`SELECT * FROM helpdesk_automation_runtime WHERE id=1`)).rows[0]});}));
router.post('/policy',handle(async(req,res)=>{
  requireAdmin(req);const input=helpdeskAutomationInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE helpdesk_automation_policies IN EXCLUSIVE MODE`);const current=await helpdeskAutomationPolicy(tx);if(current.version!==input.version)throw new WorkflowError(409,'Automation rules changed; reload before saving');const row=(await tx.execute(sql`INSERT INTO helpdesk_automation_policies(version,config,created_by,reason) VALUES(${input.version+1},${JSON.stringify(input.config)}::jsonb,${req.user!.userId},${input.reason}) RETURNING *`)).rows[0];await recordHistory(tx,req,'helpdesk_automation_policy',row,input.reason);return helpdeskAutomationPolicy(tx);}));
}));
router.get('/policy/history',handle(async(req,res)=>{requireAdmin(req);const offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);res.json((await db.execute(sql`SELECT version,config,reason,created_at,created_by FROM helpdesk_automation_policies ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows);}));
router.post('/run',handle(async(req,res)=>{requireAdmin(req);res.json(await runHelpdeskAutomation());}));
router.get('/cases/:id',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id);res.json(await db.transaction(async tx=>{const row=await readCase(tx,req.user!,id),access=capabilities(req.user!,row),snapshot=await caseAutomationSnapshot(tx,id);const events=(await tx.execute(sql`SELECT id,cycle,kind,details,created_at FROM helpdesk_automation_events WHERE case_id=${id} ORDER BY id DESC LIMIT 50`)).rows;return {clockMode:snapshot?.config.clockMode||'elapsed',timezone:snapshot?.config.calendar.timezone||null,calendar:snapshot?.config.clockMode==='business'?snapshot.config.calendar:null,policyVersion:snapshot?.version??null,enabled:!!snapshot?.config.enabled,canEnroll:['admin','super_admin'].includes(req.user!.role)&&access.staff,version:row.version,events:access.staff?events:events.filter(event=>event.kind==='escalated')};}));
}));
router.post('/cases/:id/enroll',handle(async(req,res)=>{
  requireAdmin(req);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const row=await readCase(tx,req.user!,id,true);checkVersion(row,input.version);if(!capabilities(req.user!,row).staff)throw new WorkflowError(403,'Case handler access is required');if(['resolved','closed'].includes(row.status))throw new WorkflowError(409,'Reopen the case before changing automation');const policy=await helpdeskAutomationPolicy(tx);await tx.execute(sql`UPDATE helpdesk_cases SET automation_snapshot=${JSON.stringify(policy)}::jsonb,automation_cycle=automation_cycle+1,automation_next_check_at=now(),version=version+1,updated_at=now() WHERE id=${id}`);const saved=(await tx.execute(sql`SELECT id,version,automation_cycle FROM helpdesk_cases WHERE id=${id}`)).rows[0];await tx.execute(sql`INSERT INTO helpdesk_automation_events(case_id,cycle,kind,details) VALUES(${id},${saved.automation_cycle},'policy_applied',${'Administrator applied automation rules version '+policy.version+'. Existing deadlines were retained. '+input.reason})`);await recordHistory(tx,req,'helpdesk_case_automation',{...saved,policyVersion:policy.version},input.reason);return {success:true};}));
}));
export default router;
