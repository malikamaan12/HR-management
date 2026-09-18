import { Router } from 'express';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { employees } from '@shared/schema';
import { civilDate, positiveId } from '@shared/hr-rules';
import { equipmentAssetInput, equipmentCondition, equipmentIssueInput, equipmentPolicyInput, equipmentReason, equipmentState } from '@shared/equipment';
import { db } from '../db';
import { authenticate } from '../middleware/auth';
import { recordHandler, recordHistory, requireAdmin, isAdmin, WorkflowError, qatarToday } from '../services/workflowRecords';
import { canManageEquipment, equipmentEmployeeScope, equipmentPolicy, equipmentEmployee, equipmentAsset, equipmentAssignment,
  equipmentAssetColumns, equipmentAssignmentColumns, equipmentDaysAfter, requireEquipmentManager, requireEquipmentVersion, requireOpenAssignment, validateLoanDates } from '../services/equipment';

const router=Router();
router.use(authenticate);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const pageSchema=z.object({offset:z.coerce.number().int().min(0).max(1000000).default(0),q:z.string().trim().max(150).default('')});
const searchText=(s:string)=>`%${s.replace(/[\\%_]/g,'\\$&')}%`;
const active=(status:string)=>['issued','return_requested'].includes(status);

router.get('/context',recordHandler(async(req,res)=>{
  const policy=await equipmentPolicy(db);
  const own=(await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user.userId)).limit(1))[0];
  res.json({canManage:canManageEquipment(req.user),canPolicy:isAdmin(req),ownEmployeeId:own?.id||null,today:qatarToday(),policy});
}));
router.get('/directory',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);
  const {q}=pageSchema.parse(req.query);
  const result=await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,code:employees.employeeId,
    own:sql<boolean>`${employees.userId}=${req.user.userId}`}).from(employees)
    .where(and(equipmentEmployeeScope(req.user),sql`${employees.status}<>'inactive'`,q?or(ilike(employees.employeeId,searchText(q)),ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`,searchText(q))):undefined))
    .orderBy(employees.firstName,employees.lastName,employees.id).limit(100);
  res.json({employees:result,approvers:[]});
}));
router.post('/policy',recordHandler(async(req,res)=>{
  requireAdmin(req);
  const input=z.object({version:z.number().int().min(0),definition:equipmentPolicyInput,reason:equipmentReason}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE hr_equipment_policies IN SHARE ROW EXCLUSIVE MODE`);
    const current=await equipmentPolicy(tx);
    if(current.version!==input.version)throw new WorkflowError(409,'Equipment policy changed; reload before saving');
    const row=(await tx.execute(sql`INSERT INTO hr_equipment_policies(version,definition,created_by,reason) VALUES (${current.version+1},${JSON.stringify(input.definition)}::jsonb,${req.user.userId},${input.reason}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'equipment_policy',row,input.reason);
    return row;
  });res.status(201).json(result);
}));
router.get('/policy/history',recordHandler(async(req,res)=>{
  requireAdmin(req);const {offset}=pageSchema.parse(req.query);
  const rows=await db.execute(sql`SELECT * FROM hr_equipment_policies ORDER BY version DESC LIMIT 25 OFFSET ${offset}`);
  const total=(await db.execute(sql`SELECT count(*)::integer AS total FROM hr_equipment_policies`)).rows[0].total;
  res.json({items:rows.rows,total});
}));
router.get('/assets',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);
  const {offset,q}=pageSchema.parse(req.query),state=z.union([equipmentState,z.literal('')]).default('').parse(req.query.state);
  const filter=sql`(${state}='' OR state=${state}) AND (${q}='' OR asset_tag ILIKE ${searchText(q)} OR name ILIKE ${searchText(q)} OR serial_number ILIKE ${searchText(q)} OR category ILIKE ${searchText(q)})`;
  const result=await db.transaction(async tx=>({
    items:(await tx.execute(sql`SELECT ${equipmentAssetColumns} FROM hr_equipment_assets WHERE ${filter} ORDER BY id DESC LIMIT 25 OFFSET ${offset}`)).rows,
    total:(await tx.execute(sql`SELECT count(*)::integer AS total FROM hr_equipment_assets WHERE ${filter}`)).rows[0].total,
    counts:(await tx.execute(sql`SELECT state,count(*)::integer AS count FROM hr_equipment_assets GROUP BY state ORDER BY state`)).rows,
  }),{isolationLevel:'repeatable read',accessMode:'read only'});res.json(result);
}));
router.post('/assets',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const input=equipmentAssetInput.parse(req.body);
  if(input.condition==='lost')throw new WorkflowError(400,'Register available inventory; loss is recorded through an administrator write-off');
  if(input.purchaseDate&&input.purchaseDate>qatarToday())throw new WorkflowError(400,'Purchase date cannot be in the future');
  const row=await db.transaction(async tx=>{
    const row=(await tx.execute(sql`INSERT INTO hr_equipment_assets(asset_tag,name,category,serial_number,location,purchase_date,warranty_until,condition,notes,created_by)
      VALUES (${input.assetTag},${input.name},${input.category},${input.serialNumber},${input.location},${input.purchaseDate}::date,${input.warrantyUntil}::date,${input.condition},${input.notes},${req.user.userId}) RETURNING ${equipmentAssetColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_asset',row,'Registered equipment asset');return row;
  });res.status(201).json(row);
}));
router.get('/assets/:id',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);res.json(await equipmentAsset(db,positiveId.parse(req.params.id)));
}));
router.patch('/assets/:id',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const id=positiveId.parse(req.params.id);
  const input=z.object({version:positiveId,asset:equipmentAssetInput,state:equipmentState,reason:equipmentReason}).strict().parse(req.body);
  if(input.asset.purchaseDate&&input.asset.purchaseDate>qatarToday())throw new WorkflowError(400,'Purchase date cannot be in the future');
  const row=await db.transaction(async tx=>{
    const previous=await equipmentAsset(tx,id,true);requireEquipmentVersion(previous,input.version);
    const holder=(await tx.execute(sql`SELECT id FROM hr_equipment_assignments WHERE asset_id=${id} AND status IN ('issued','return_requested') LIMIT 1`)).rows[0];
    if(holder&&input.state!=='issued')throw new WorkflowError(409,'Receive the issued equipment or record a write-off before changing its inventory state');
    if(!holder&&input.state==='issued')throw new WorkflowError(400,'Use Issue equipment to create an employee custody record');
    if(holder&&input.asset.condition!==previous.condition)throw new WorkflowError(409,'Inspect the condition through the equipment return workflow');
    if(input.state==='lost'&&previous.state!=='lost')throw new WorkflowError(400,'Use an administrator write-off for lost issued equipment, or retire unissued inventory');
    if(input.asset.condition==='lost'&&!['lost','retired'].includes(input.state))throw new WorkflowError(400,'Record a recovered condition before making lost inventory available');
    const a=input.asset,row=(await tx.execute(sql`UPDATE hr_equipment_assets SET asset_tag=${a.assetTag},name=${a.name},category=${a.category},serial_number=${a.serialNumber},location=${a.location},purchase_date=${a.purchaseDate}::date,warranty_until=${a.warrantyUntil}::date,condition=${a.condition},state=${input.state},notes=${a.notes},version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssetColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_asset',row,input.reason);return row;
  });res.json(row);
}));
router.get('/assets/:id/history',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const id=positiveId.parse(req.params.id),{offset}=pageSchema.parse(req.query);await equipmentAsset(db,id);
  const rows=(await db.execute(sql`SELECT id,version,actor_id,reason,created_at,snapshot FROM hr_workflow_history WHERE kind='equipment_asset' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows;
  const total=(await db.execute(sql`SELECT count(*)::integer AS total FROM hr_workflow_history WHERE kind='equipment_asset' AND record_id=${id}`)).rows[0].total;res.json({items:rows,total});
}));
router.get('/assignments',recordHandler(async(req,res)=>{
  const {offset,q}=pageSchema.parse(req.query);
  const status=z.enum(['','open','issued','return_requested','returned','written_off','overdue','unacknowledged']).default('open').parse(req.query.status);
  const employeeId=positiveId.optional().parse(req.query.employeeId),today=qatarToday();
  const filter=sql`${equipmentEmployeeScope(req.user)} AND (${employeeId||null}::integer IS NULL OR a.employee_id=${employeeId||null})
    AND (${q}='' OR a.asset_snapshot->>'asset_tag' ILIKE ${searchText(q)} OR a.asset_snapshot->>'name' ILIKE ${searchText(q)} OR ${employees.employeeId} ILIKE ${searchText(q)} OR ${employees.firstName} || ' ' || ${employees.lastName} ILIKE ${searchText(q)})
    AND (${status}='' OR (${status}='open' AND a.status IN ('issued','return_requested')) OR a.status=${status}
      OR (${status}='overdue' AND a.status IN ('issued','return_requested') AND a.due_on<${today}::date)
      OR (${status}='unacknowledged' AND a.status IN ('issued','return_requested') AND a.acknowledgement IN ('pending','disputed')))`;
  const result=await db.transaction(async tx=>({
    items:(await tx.execute(sql`SELECT a.id,a.asset_id,a.employee_id,a.status,a.version,a.issued_on::text,a.due_on::text,a.acknowledgement,a.acknowledgement_due_on::text,a.asset_snapshot->>'asset_tag' AS asset_tag,a.asset_snapshot->>'name' AS asset_name,${employees.firstName} || ' ' || ${employees.lastName} AS employee_name,${employees.employeeId} AS employee_code
      FROM hr_equipment_assignments a JOIN ${employees} ON ${employees.id}=a.employee_id WHERE ${filter} ORDER BY a.id DESC LIMIT 25 OFFSET ${offset}`)).rows,
    total:(await tx.execute(sql`SELECT count(*)::integer AS total FROM hr_equipment_assignments a JOIN ${employees} ON ${employees.id}=a.employee_id WHERE ${filter}`)).rows[0].total,
  }),{isolationLevel:'repeatable read',accessMode:'read only'});res.json(result);
}));
router.post('/assignments',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const input=equipmentIssueInput.parse(req.body);
  const row=await db.transaction(async tx=>{
    const employee=await equipmentEmployee(tx,req.user,input.employeeId,true);
    if(employee.status==='inactive')throw new WorkflowError(400,'Equipment cannot be issued to an inactive employee');
    if(employee.userId===req.user.userId)throw new WorkflowError(403,'Another HR inventory administrator must issue equipment to you');
    if(input.issuedOn<employee.joiningDate)throw new WorkflowError(400,'Issue date must be on or after the employee joining date');
    const asset=await equipmentAsset(tx,input.assetId,true);requireEquipmentVersion(asset,input.assetVersion);
    if(asset.state!=='available')throw new WorkflowError(409,'Only available inventory can be issued');
    const policy=await equipmentPolicy(tx);validateLoanDates(input.issuedOn,input.dueOn,policy);
    const snapshot={asset_tag:asset.asset_tag,name:asset.name,category:asset.category,serial_number:asset.serial_number};
    const row=(await tx.execute(sql`INSERT INTO hr_equipment_assignments(asset_id,employee_id,issued_on,due_on,issued_condition,issue_note,issued_by,asset_snapshot,policy_snapshot,acknowledgement,acknowledgement_due_on)
      VALUES (${asset.id},${employee.id},${input.issuedOn}::date,${input.dueOn}::date,${input.condition},${input.note},${req.user.userId},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(policy)}::jsonb,${policy.acknowledgementRequired?'pending':'not_required'},${policy.acknowledgementRequired?equipmentDaysAfter(input.issuedOn,policy.acknowledgementDays):null}::date) RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assets SET state='issued',condition=${input.condition},version=version+1,updated_at=now() WHERE id=${asset.id} RETURNING ${equipmentAssetColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',row,input.note);await recordHistory(tx,req,'equipment_asset',updated,`Issued under custody record #${row.id}`);return row;
  });res.status(201).json(row);
}));
router.get('/assignments/:id',recordHandler(async(req,res)=>{
  const {row,employee,asset}=await equipmentAssignment(db,req.user,positiveId.parse(req.params.id));
  const own=employee.userId===req.user.userId,manage=canManageEquipment(req.user);
  res.json({row,employeeName:employee.firstName+' '+employee.lastName,employeeCode:employee.employeeId,assetVersion:asset.version,
    canAcknowledge:own&&active(row.status)&&row.acknowledgement!=='accepted',canRequestReturn:(own||manage)&&row.status==='issued',
    canManage:manage,canWriteOff:isAdmin(req)&&!own,canReview:manage&&!own&&(!row.policy_snapshot.independentReturnReview||row.return_requested_by!==req.user.userId)});
}));
router.get('/assignments/:id/history',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{offset}=pageSchema.parse(req.query);await equipmentAssignment(db,req.user,id);
  const items=(await db.execute(sql`SELECT id,version,actor_id,reason,created_at,snapshot FROM hr_workflow_history WHERE kind='equipment_assignment' AND record_id=${id} ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows;
  const total=(await db.execute(sql`SELECT count(*)::integer AS total FROM hr_workflow_history WHERE kind='equipment_assignment' AND record_id=${id}`)).rows[0].total;res.json({items,total});
}));
router.post('/assignments/:id/acknowledge',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,decision:z.enum(['accepted','disputed']),note:equipmentReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);requireOpenAssignment(row);
    if(employee.userId!==req.user.userId)throw new WorkflowError(403,'Only the employee receiving the equipment can acknowledge it');
    if(row.acknowledgement==='accepted')throw new WorkflowError(409,'Receipt has already been acknowledged');
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET acknowledgement=${input.decision},acknowledged_by=${req.user.userId},acknowledged_at=now(),acknowledgement_note=${input.note},version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,`Receipt ${input.decision}: ${input.note}`);return updated;
  }));
}));
router.post('/assignments/:id/request-return',recordHandler(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,condition:equipmentCondition,note:equipmentReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);
    if(employee.userId!==req.user.userId&&!canManageEquipment(req.user))throw new WorkflowError(403,'Only the equipment holder or HR inventory administrator can request its return');
    if(row.status!=='issued')throw new WorkflowError(409,'Only issued equipment can enter return review');
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET status='return_requested',requested_condition=${input.condition},return_request_note=${input.note},return_requested_by=${req.user.userId},return_requested_at=now(),version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,'Requested return: '+input.note);return updated;
  }));
}));
router.post('/assignments/:id/reject-return',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,note:equipmentReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);
    if(row.status!=='return_requested')throw new WorkflowError(409,'There is no return request awaiting review');
    if(employee.userId===req.user.userId||(row.policy_snapshot.independentReturnReview&&row.return_requested_by===req.user.userId))throw new WorkflowError(403,'An independent HR inventory administrator must review this return');
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET status='issued',return_note=${input.note},version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,'Return sent back: '+input.note);return updated;
  }));
}));
router.post('/assignments/:id/return',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const id=positiveId.parse(req.params.id);
  const input=z.object({version:positiveId,assetVersion:positiveId,returnedOn:civilDate,condition:equipmentCondition.exclude(['lost']),disposition:z.enum(['available','maintenance','retired']),note:equipmentReason,evidence:z.string().trim().max(2000).default('')}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee,asset}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);requireEquipmentVersion(asset,input.assetVersion);requireOpenAssignment(row);
    if(employee.userId===req.user.userId||(row.policy_snapshot.independentReturnReview&&row.return_requested_by===req.user.userId))throw new WorkflowError(403,'An independent HR inventory administrator must receive this equipment');
    if(row.policy_snapshot.requireReturnRequest&&row.status!=='return_requested')throw new WorkflowError(400,'The saved equipment policy requires an employee return request before inspection');
    if(row.policy_snapshot.returnEvidenceRequired&&input.evidence.length<5)throw new WorkflowError(400,'Record the return evidence or signed receipt reference');
    if(input.returnedOn<row.issued_on||input.returnedOn>qatarToday())throw new WorkflowError(400,'Return date must be between the issue date and today');
    if(input.condition==='damaged'&&input.disposition==='available')throw new WorkflowError(400,'Place damaged equipment in maintenance or retire it');
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET status='returned',returned_on=${input.returnedOn}::date,returned_condition=${input.condition},return_note=${input.note},return_evidence=${input.evidence},closed_by=${req.user.userId},closed_at=now(),version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    const updatedAsset=(await tx.execute(sql`UPDATE hr_equipment_assets SET state=${input.disposition},condition=${input.condition},version=version+1,updated_at=now() WHERE id=${asset.id} RETURNING ${equipmentAssetColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,'Return inspected: '+input.note);await recordHistory(tx,req,'equipment_asset',updatedAsset,`Received custody record #${row.id}: ${input.note}`);return updated;
  }));
}));
router.post('/assignments/:id/write-off',recordHandler(async(req,res)=>{
  requireAdmin(req);const id=positiveId.parse(req.params.id);
  const input=z.object({version:positiveId,assetVersion:positiveId,closedOn:civilDate,condition:z.enum(['lost','damaged']),note:z.string().trim().min(10).max(2000),evidence:equipmentReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee,asset}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);requireEquipmentVersion(asset,input.assetVersion);requireOpenAssignment(row);
    if(employee.userId===req.user.userId)throw new WorkflowError(403,'Another administrator must approve your equipment write-off');
    if(input.closedOn<row.issued_on||input.closedOn>qatarToday())throw new WorkflowError(400,'Write-off date must be between the issue date and today');
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET status='written_off',returned_on=${input.closedOn}::date,returned_condition=${input.condition},return_note=${input.note},return_evidence=${input.evidence},closed_by=${req.user.userId},closed_at=now(),version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    const updatedAsset=(await tx.execute(sql`UPDATE hr_equipment_assets SET state=${input.condition==='lost'?'lost':'retired'},condition=${input.condition},version=version+1,updated_at=now() WHERE id=${asset.id} RETURNING ${equipmentAssetColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,'Administrator write-off: '+input.note);await recordHistory(tx,req,'equipment_asset',updatedAsset,`Written off custody record #${id}: ${input.note}`);return updated;
  }));
}));
router.post('/assignments/:id/due-date',recordHandler(async(req,res)=>{
  requireEquipmentManager(req.user);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,dueOn:civilDate.nullable(),note:equipmentReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row}=await equipmentAssignment(tx,req.user,id,true);requireEquipmentVersion(row,input.version);requireOpenAssignment(row);validateLoanDates(row.issued_on,input.dueOn,row.policy_snapshot);
    const updated=(await tx.execute(sql`UPDATE hr_equipment_assignments SET due_on=${input.dueOn}::date,version=version+1,updated_at=now() WHERE id=${id} RETURNING ${equipmentAssignmentColumns}`)).rows[0];
    await recordHistory(tx,req,'equipment_assignment',updated,'Changed return due date: '+input.note);return updated;
  }));
}));
export default router;
