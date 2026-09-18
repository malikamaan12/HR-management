import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { employees } from '@shared/schema';
import { handbookAssign, handbookCreate, handbookPolicyInput, handbookRevise, handbookContent } from '@shared/handbook';
import { civilDate, positiveId, reason } from '@shared/hr-rules';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { WorkflowError, recordHandler, recordHistory, requireAdmin, qatarToday } from '../services/workflowRecords';
import { canManageHandbook, canPublishHandbook, handbookAssignment, handbookAssignmentScope, handbookEmployee, handbookHash, handbookPolicy, handbookVersion, requireHandbookEmployed, requireHandbookManager, requireHandbookPublisher } from '../services/handbook';

const router=Router();
const offsetInput=z.coerce.number().int().min(0).max(1000000).default(0);
router.use(authenticate);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/overview',recordHandler(async(req,res)=>res.json({canManage:canManageHandbook(req.user.role),canPublish:canPublishHandbook(req.user.role),canSetRules:['admin','super_admin'].includes(req.user.role),policy:await handbookPolicy(db)})));
router.get('/directory',recordHandler(async(req,res)=>{
  requireHandbookManager(req.user);const query=z.string().max(100).parse(req.query.q||''),term='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
  res.json(await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,department:employees.department,type:employees.type}).from(employees).where(and(employeeScope(req.user,'compliance_documents'),sql`${employees.status} NOT IN ('inactive','terminated')`,sql`(${employees.terminationDate} IS NULL OR ${employees.terminationDate}>${qatarToday()})`,sql`(${employees.firstName} || ' ' || ${employees.lastName}) ILIKE ${term}`)).orderBy(employees.firstName,employees.id).limit(200));
}));
router.get('/policy',recordHandler(async(req,res)=>{requireHandbookManager(req.user);res.json(await handbookPolicy(db));}));
router.post('/policy',recordHandler(async(req,res)=>{
  requireAdmin(req);const input=handbookPolicyInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE hr_handbook_policies IN EXCLUSIVE MODE`);const current=await handbookPolicy(tx);handbookVersion(current.version,input.version);
    const row=(await tx.execute(sql`INSERT INTO hr_handbook_policies(version,default_due_days,required_by_default,acknowledgement_text,created_by,reason) VALUES(${input.version+1},${input.defaultDueDays},${input.requiredByDefault},${input.acknowledgementText},${req.user.userId},${input.reason}) RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_policy',row,input.reason);return handbookPolicy(tx);
  }));
}));
router.get('/policy/history',recordHandler(async(req,res)=>{requireAdmin(req);const offset=offsetInput.parse(req.query.offset);res.json((await db.execute(sql`SELECT version,default_due_days,required_by_default,acknowledgement_text,reason,created_at FROM hr_handbook_policies ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows);}));
router.get('/catalogue',recordHandler(async(req,res)=>{
  const offset=offsetInput.parse(req.query.offset),publisher=canPublishHandbook(req.user.role),showArchived=publisher&&req.query.archived==='true',q=z.string().max(100).parse(req.query.q||''),term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await db.execute(sql`SELECT h.id,h.category,h.active,h.version,e.title,e.id AS edition_id,e.edition_number,e.status AS edition_status,e.effective_on::text FROM hr_handbooks h JOIN LATERAL (SELECT * FROM hr_handbook_editions WHERE handbook_id=h.id AND (${publisher} OR status='published' AND effective_on<=${qatarToday()}) ORDER BY edition_number DESC LIMIT 1) e ON true WHERE (${showArchived} OR h.active=true) AND (e.title ILIKE ${term} OR h.category ILIKE ${term}) ORDER BY h.id DESC LIMIT 26 OFFSET ${offset}`)).rows;
  res.json({items:rows.slice(0,25),hasMore:rows.length>25});
}));
router.post('/catalogue',recordHandler(async(req,res)=>{
  requireHandbookPublisher(req.user);const input=handbookCreate.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{const book=(await tx.execute(sql`INSERT INTO hr_handbooks(category,created_by) VALUES(${input.category},${req.user.userId}) RETURNING *`)).rows[0];const row=(await tx.execute(sql`INSERT INTO hr_handbook_editions(handbook_id,edition_number,title,summary,body,body_hash,effective_on,created_by) VALUES(${book.id},1,${input.title},${input.summary},${input.body},${handbookHash(input.body)},${input.effectiveOn},${req.user.userId}) RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook',book,input.reason);await recordHistory(tx,req,'handbook_edition',row,input.reason);return row;}));
}));
router.patch('/catalogue/:id',recordHandler(async(req,res)=>{
  requireHandbookPublisher(req.user);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,active:z.boolean(),category:z.string().trim().min(2).max(80),reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const old=(await tx.execute(sql`SELECT * FROM hr_handbooks WHERE id=${id} FOR UPDATE`)).rows[0];if(!old)throw new WorkflowError(404,'Handbook not found');handbookVersion(Number(old.version),input.version);const row=(await tx.execute(sql`UPDATE hr_handbooks SET active=${input.active},category=${input.category},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook',row,input.reason);return row;}));
}));
router.post('/catalogue/:id/editions',recordHandler(async(req,res)=>{
  requireHandbookPublisher(req.user);const id=positiveId.parse(req.params.id),input=handbookContent.extend({sourceEditionId:positiveId,reason}).strict().parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{const book=(await tx.execute(sql`SELECT * FROM hr_handbooks WHERE id=${id} FOR UPDATE`)).rows[0];if(!book||!book.active)throw new WorkflowError(409,'Choose an active handbook');const latest=(await tx.execute(sql`SELECT * FROM hr_handbook_editions WHERE handbook_id=${id} ORDER BY edition_number DESC LIMIT 1`)).rows[0];if(!latest||Number(latest.id)!==input.sourceEditionId||latest.status!=='published')throw new WorkflowError(409,'Open the latest published edition; only one draft is allowed');
    const row=(await tx.execute(sql`INSERT INTO hr_handbook_editions(handbook_id,edition_number,title,summary,body,body_hash,effective_on,created_by) VALUES(${id},${Number(latest.edition_number)+1},${input.title},${input.summary},${input.body},${handbookHash(input.body)},${input.effectiveOn},${req.user.userId}) RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_edition',row,input.reason);return row;
  }));
}));
router.get('/editions/:id',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),publisher=canPublishHandbook(req.user.role),result=(await db.execute(sql`SELECT e.*,e.effective_on::text AS effective_on,h.active,h.category,h.version AS handbook_version FROM hr_handbook_editions e JOIN hr_handbooks h ON h.id=e.handbook_id WHERE e.id=${id} AND (${publisher} OR (e.status='published' AND e.effective_on<=${qatarToday()}))`)).rows[0];if(!result)throw new WorkflowError(404,'Handbook edition not found');
  const editions=(await db.execute(sql`SELECT id,edition_number,status,effective_on::text FROM hr_handbook_editions WHERE handbook_id=${result.handbook_id} AND (${publisher} OR status='published' AND effective_on<=${qatarToday()}) ORDER BY edition_number DESC`)).rows;res.json({row:result,editions});
}));
router.patch('/editions/:id',recordHandler(async(req,res)=>{
  requireHandbookPublisher(req.user);const id=positiveId.parse(req.params.id),input=handbookRevise.parse(req.body);
  res.json(await db.transaction(async tx=>{const old=(await tx.execute(sql`SELECT * FROM hr_handbook_editions WHERE id=${id} FOR UPDATE`)).rows[0];if(!old)throw new WorkflowError(404,'Edition not found');handbookVersion(Number(old.version),input.version);if(old.status!=='draft')throw new WorkflowError(409,'Published content cannot be edited; create a new edition');const row=(await tx.execute(sql`UPDATE hr_handbook_editions SET title=${input.title},summary=${input.summary},body=${input.body},body_hash=${handbookHash(input.body)},effective_on=${input.effectiveOn},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_edition',row,input.reason);return row;}));
}));
router.post('/editions/:id/publish',recordHandler(async(req,res)=>{
  requireHandbookPublisher(req.user);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const initial=(await tx.execute(sql`SELECT handbook_id FROM hr_handbook_editions WHERE id=${id}`)).rows[0];if(!initial)throw new WorkflowError(404,'Edition not found');const book=(await tx.execute(sql`SELECT * FROM hr_handbooks WHERE id=${initial.handbook_id} FOR UPDATE`)).rows[0];if(!book?.active)throw new WorkflowError(409,'Restore this handbook before publishing');const old=(await tx.execute(sql`SELECT * FROM hr_handbook_editions WHERE id=${id} FOR UPDATE`)).rows[0];handbookVersion(Number(old.version),input.version);if(old.status!=='draft')throw new WorkflowError(409,'This edition is already published');const row=(await tx.execute(sql`UPDATE hr_handbook_editions SET status='published',published_by=${req.user.userId},published_at=now(),version=version+1 WHERE id=${id} RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_edition',row,input.reason);return row;}));
}));
router.get('/editions/:id/history',recordHandler(async(req,res)=>{requireHandbookPublisher(req.user);const id=positiveId.parse(req.params.id),offset=offsetInput.parse(req.query.offset);res.json((await db.execute(sql`SELECT version,reason,actor_id,created_at,snapshot FROM hr_workflow_history WHERE kind='handbook_edition' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows);}));
router.get('/assignments',recordHandler(async(req,res)=>{
  const input=z.object({offset:offsetInput,status:z.enum(['','pending','acknowledged','superseded','withdrawn','overdue']).default(''),view:z.enum(['mine','team']).default('mine'),q:z.string().max(100).default('')}).parse(req.query);if(input.view==='team')requireHandbookManager(req.user);const scope=input.view==='mine'?eq(employees.userId,req.user.userId):handbookAssignmentScope(req.user),term='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
  const status=input.status==='overdue'?sql`a.status='pending' AND a.due_date<${qatarToday()}`:input.status?sql`a.status=${input.status}`:sql`true`;
  const rows=(await db.execute(sql`SELECT a.id,a.handbook_id,a.edition_id,a.employee_id,a.due_date::text,a.required,a.status,a.version,a.read_at,a.acknowledged_at,a.created_at,e.title,e.edition_number,employees.first_name || ' ' || employees.last_name AS employee_name FROM hr_handbook_assignments a JOIN employees ON employees.id=a.employee_id JOIN hr_handbook_editions e ON e.id=a.edition_id WHERE ${scope} AND ${status} AND (e.title ILIKE ${term} OR (employees.first_name || ' ' || employees.last_name) ILIKE ${term}) ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.due_date,a.id DESC LIMIT 26 OFFSET ${input.offset}`)).rows;res.json({items:rows.slice(0,25),hasMore:rows.length>25});
}));
router.post('/assignments',recordHandler(async(req,res)=>{
  requireHandbookManager(req.user);const input=handbookAssign.parse(req.body);if(input.dueDate<qatarToday())throw new WorkflowError(400,'Choose a current or future deadline');
  res.status(201).json(await db.transaction(async tx=>{
    for(const id of [...input.employeeIds].sort((a,b)=>a-b))requireHandbookEmployed(await handbookEmployee(tx,req.user,id,true,true));
    const initial=(await tx.execute(sql`SELECT handbook_id FROM hr_handbook_editions WHERE id=${input.editionId}`)).rows[0];if(!initial)throw new WorkflowError(404,'Edition not found');const book=(await tx.execute(sql`SELECT * FROM hr_handbooks WHERE id=${initial.handbook_id} FOR UPDATE`)).rows[0];const edition=(await tx.execute(sql`SELECT *,effective_on::text AS effective_on FROM hr_handbook_editions WHERE id=${input.editionId}`)).rows[0];if(!book?.active||edition.status!=='published')throw new WorkflowError(409,'Choose a published edition of an active handbook');if(input.dueDate<String(edition.effective_on))throw new WorkflowError(400,'Deadline cannot precede the edition effective date');const policy=await handbookPolicy(tx),items:any[]=[];
    for(const employeeId of input.employeeIds){
      const existing=(await tx.execute(sql`SELECT id,status FROM hr_handbook_assignments WHERE edition_id=${input.editionId} AND employee_id=${employeeId}`)).rows[0];if(existing){items.push({id:existing.id,status:existing.status,existing:true});continue;}
      const newer=(await tx.execute(sql`SELECT a.id FROM hr_handbook_assignments a JOIN hr_handbook_editions e ON e.id=a.edition_id WHERE a.handbook_id=${book.id} AND a.employee_id=${employeeId} AND a.status IN ('pending','acknowledged') AND e.edition_number>${edition.edition_number} LIMIT 1`)).rows[0];if(newer)throw new WorkflowError(409,'An employee already has a newer edition; assign the latest edition');
      const row=(await tx.execute(sql`INSERT INTO hr_handbook_assignments(handbook_id,edition_id,employee_id,body_hash,policy_snapshot,due_date,required,assigned_by) VALUES(${book.id},${input.editionId},${employeeId},${edition.body_hash},${JSON.stringify(policy)}::jsonb,${input.dueDate},${input.required},${req.user.userId}) RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_assignment',row,input.reason);
      if(input.supersedePending){const oldRows=(await tx.execute(sql`UPDATE hr_handbook_assignments SET status='superseded',superseded_by=${row.id},version=version+1 WHERE handbook_id=${book.id} AND employee_id=${employeeId} AND id<>${row.id} AND status='pending' RETURNING *`)).rows;for(const old of oldRows)await recordHistory(tx,req,'handbook_assignment',old,'Superseded by assignment #'+row.id+': '+input.reason);}
      items.push({id:row.id,status:row.status,existing:false});
    }return {items};
  }));
}));
router.get('/assignments/:id',recordHandler(async(req,res)=>res.json(await db.transaction(async tx=>{const {row,employee,edition}=await handbookAssignment(tx,req.user,positiveId.parse(req.params.id));return {row:{...row,title:edition.title,edition_number:edition.edition_number,due_date:String(row.due_date).slice(0,10)},edition:{...edition,effective_on:String(edition.effective_on).slice(0,10)},employeeName:employee.firstName+' '+employee.lastName,canAcknowledge:employee.userId===req.user.userId,hasReadReceipt:!!row.read_at&&row.read_by===req.user.userId,canManage:canManageHandbook(req.user.role)};}))));
router.post('/assignments/:id/read',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,bodyHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const {row,employee,edition}=await handbookAssignment(tx,req.user,id,true);if(employee.userId!==req.user.userId)throw new WorkflowError(403,'Only the assigned employee can record reading');requireHandbookEmployed(employee);handbookVersion(Number(row.version),input.version);if(row.status!=='pending')throw new WorkflowError(409,'This assignment is closed');if(String(edition.effective_on).slice(0,10)>qatarToday())throw new WorkflowError(409,'This edition is not effective yet');if(input.bodyHash!==row.body_hash)throw new WorkflowError(409,'Reload the assigned handbook version before continuing');if(row.read_at&&row.read_by===req.user.userId)return row;
    const saved=(await tx.execute(sql`UPDATE hr_handbook_assignments SET read_at=now(),read_by=${req.user.userId},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_assignment',saved,'Employee confirmed reading the assigned edition');return saved;
  }));
}));
router.post('/assignments/:id/acknowledge',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,bodyHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const {row,employee,edition}=await handbookAssignment(tx,req.user,id,true);if(employee.userId!==req.user.userId)throw new WorkflowError(403,'Only the assigned employee can acknowledge');requireHandbookEmployed(employee);handbookVersion(Number(row.version),input.version);if(row.status!=='pending')throw new WorkflowError(409,'This assignment is closed');if(!row.read_at||row.read_by!==req.user.userId||input.bodyHash!==row.body_hash)throw new WorkflowError(409,'Read this assigned version before acknowledging');if(String(edition.effective_on).slice(0,10)>qatarToday())throw new WorkflowError(409,'This edition is not effective yet');const saved=(await tx.execute(sql`UPDATE hr_handbook_assignments SET status='acknowledged',acknowledged_at=now(),acknowledged_by=${req.user.userId},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];await recordHistory(tx,req,'handbook_assignment',saved,'Employee acknowledged edition '+edition.edition_number);return saved;}));
}));
router.patch('/assignments/:id',recordHandler(async(req,res)=>{
  requireHandbookManager(req.user);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,action:z.enum(['update','withdraw']),dueDate:civilDate.optional(),required:z.boolean().optional(),reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const {row,employee,edition}=await handbookAssignment(tx,req.user,id,true);await handbookEmployee(tx,req.user,employee.id,true);handbookVersion(Number(row.version),input.version);if(row.status!=='pending')throw new WorkflowError(409,'Closed assignments cannot be changed');let saved;
    if(input.action==='withdraw')saved=(await tx.execute(sql`UPDATE hr_handbook_assignments SET status='withdrawn',version=version+1 WHERE id=${id} RETURNING *`)).rows[0];else{if(!input.dueDate||input.required===undefined)throw new WorkflowError(400,'Enter the deadline and required acknowledgement setting');if(input.dueDate<qatarToday()||input.dueDate<String(edition.effective_on).slice(0,10))throw new WorkflowError(400,'Choose a current or future date on or after the effective date');saved=(await tx.execute(sql`UPDATE hr_handbook_assignments SET due_date=${input.dueDate},required=${input.required},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];}await recordHistory(tx,req,'handbook_assignment',saved,input.reason);return saved;
  }));
}));
router.get('/assignments/:id/history',recordHandler(async(req,res)=>{const id=positiveId.parse(req.params.id),offset=offsetInput.parse(req.query.offset);res.json(await db.transaction(async tx=>{await handbookAssignment(tx,req.user,id);return (await tx.execute(sql`SELECT version,reason,actor_id,created_at,snapshot->>'status' AS status,snapshot->>'due_date' AS due_date,snapshot->>'required' AS required,snapshot->>'read_at' AS read_at,snapshot->>'acknowledged_at' AS acknowledged_at,snapshot->>'superseded_by' AS superseded_by FROM hr_workflow_history WHERE kind='handbook_assignment' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows;}));}));
export default router;
