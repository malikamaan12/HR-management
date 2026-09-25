import {Router} from 'express';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {isDeepStrictEqual} from 'node:util';
import {db} from '../db';
import {compensationRevisionInput} from '@shared/compensation';
import {positiveId,reason} from '@shared/hr-rules';
import {moneyCents,moneyText} from '@shared/money';
import {compensationEmployee,packageRow} from '../services/compensation';
import {fail} from '../services/workforce';
import {recordHistory} from '../services/workflowRecords';
import {handle} from './hr-rules';

const router=Router({mergeParams:true});
const proposalInput=compensationRevisionInput.extend({contractId:positiveId,contractHash:z.string().length(64),submissionKey:z.string().uuid(),confirmed:z.literal(true)}).strict();
async function employee(tx:any,req:any){
 const row=await compensationEmployee(tx,req.user,positiveId.parse(req.params.employeeId),true);
 if(row.userId===req.user!.userId)fail(403,'You cannot prepare or review your own contract compensation');
 return row;
}
async function signedContract(tx:any,req:any,employeeId:number,contractId:number){
 const row=(await tx.execute(sql`SELECT * FROM employee_contracts WHERE id=${contractId} AND employee_id=${employeeId} FOR UPDATE`)).rows[0];
 if(!row)fail(404,'Contract not found for this employee');
 if(row.status!=='signed')fail(409,'Only a signed contract can become a compensation package');
 if(Number(row.signed_by)===req.user!.userId)fail(403,'The contract recipient cannot prepare or review their own compensation');
 return row;
}
router.get('/',handle(async(req,res)=>res.json(await db.transaction(async tx=>{
 const person=await employee(tx,req);
 const contracts=(await tx.execute(sql`SELECT id,reference,content_hash AS "contentHash",document->>'startDate' AS "startDate",document->>'endDate' AS "endDate",document->>'compensation' AS terms,document->'arabic'->>'compensation' AS "termsAr" FROM employee_contracts WHERE employee_id=${person.id} AND status='signed' AND signed_by<>${req.user!.userId} ORDER BY id DESC LIMIT 100`)).rows;
 const proposals=(await tx.execute(sql`SELECT p.*,p.effective_from::text AS effective_from,c.reference,c.signed_by,c.document->>'compensation' AS terms,c.document->'arabic'->>'compensation' AS terms_ar,u.first_name || ' ' || u.last_name AS preparer_name FROM contract_compensation_proposals p JOIN employee_contracts c ON c.id=p.contract_id JOIN users u ON u.id=p.prepared_by WHERE p.employee_id=${person.id} ORDER BY p.id DESC LIMIT 100`)).rows;
 return {contracts,proposals:proposals.map((p:any)=>({...p,canReview:p.status==='pending'&&Number(p.prepared_by)!==req.user!.userId&&Number(p.signed_by)!==req.user!.userId})),latestVersion:Number((await tx.execute(sql`SELECT coalesce(max(version),0)::int AS version FROM employee_compensation_packages WHERE employee_id=${person.id}`)).rows[0].version)};
}))));
router.post('/',handle(async(req,res)=>{
 const input=proposalInput.parse(req.body),definition={...input.definition,items:input.definition.items.map(item=>({...item,amount:moneyText(moneyCents(item.amount))}))};
 res.status(201).json(await db.transaction(async tx=>{
  const person=await employee(tx,req),contract=await signedContract(tx,req,person.id,input.contractId);
  if(contract.content_hash!==input.contractHash)fail(409,'The signed contract fingerprint changed. Reload and review the exact terms');
  const prior=(await tx.execute(sql`SELECT *,effective_from::text AS effective_from FROM contract_compensation_proposals WHERE prepared_by=${req.user!.userId} AND submission_key=${input.submissionKey}`)).rows[0];
  if(prior){
   if(Number(prior.employee_id)!==person.id||Number(prior.contract_id)!==input.contractId||Number(prior.expected_package_version)!==input.expectedVersion||prior.effective_from!==input.effectiveFrom||prior.reason!==input.reason||!isDeepStrictEqual(prior.definition,definition))fail(409,'This submission key was already used for different compensation terms');
   return {id:prior.id,status:prior.status};
  }
  if(input.effectiveFrom<person.joiningDate||!contract.document.startDate||input.effectiveFrom<contract.document.startDate||(contract.document.endDate&&input.effectiveFrom>contract.document.endDate))fail(400,'The effective date must fall within the signed contract period and cannot precede joining');
  const latest=Number((await tx.execute(sql`SELECT coalesce(max(version),0)::int AS version FROM employee_compensation_packages WHERE employee_id=${person.id}`)).rows[0].version);
  if(latest!==input.expectedVersion)fail(409,'Compensation changed. Reload before preparing the contract mapping');
  if((await tx.execute(sql`SELECT id FROM contract_compensation_proposals WHERE contract_id=${contract.id} AND status IN ('pending','applied')`)).rows.length)fail(409,'This contract already has a pending or applied compensation mapping');
  const saved=(await tx.execute(sql`INSERT INTO contract_compensation_proposals(contract_id,employee_id,contract_hash,expected_package_version,effective_from,definition,reason,prepared_by,submission_key) VALUES(${contract.id},${person.id},${input.contractHash},${input.expectedVersion},${input.effectiveFrom}::date,${JSON.stringify(definition)}::jsonb,${input.reason},${req.user!.userId},${input.submissionKey}::uuid) RETURNING *`)).rows[0];
  await recordHistory(tx,req,'contract_compensation',saved,input.reason);
  return {id:saved.id,status:saved.status};
 }));
}));
router.post('/:id/:action',handle(async(req,res)=>{
 const proposalId=positiveId.parse(req.params.id),action=z.enum(['approve','reject']).parse(req.params.action),input=z.object({version:positiveId,reason,confirmed:z.literal(true)}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{
  const person=await employee(tx,req);
  const row=(await tx.execute(sql`SELECT *,effective_from::text AS effective_from FROM contract_compensation_proposals WHERE id=${proposalId} AND employee_id=${person.id} FOR UPDATE`)).rows[0];
  if(!row)fail(404,'Contract compensation proposal not found');
  if(row.status!=='pending'||Number(row.version)!==input.version)fail(409,'This proposal was already reviewed or changed');
  if(Number(row.prepared_by)===req.user!.userId)fail(403,'A different eligible HR reviewer must decide this mapping');
  const contract=await signedContract(tx,req,person.id,Number(row.contract_id));
  let packageId:number|null=null;
  if(action==='approve'){
   if(contract.content_hash!==row.contract_hash)fail(409,'The signed contract no longer matches the reviewed proposal');
   if(String(row.effective_from)<person.joiningDate||String(row.effective_from)<contract.document.startDate||(contract.document.endDate&&String(row.effective_from)>contract.document.endDate))fail(409,'The employment dates changed. Reject and prepare a fresh proposal');
   const latest=Number((await tx.execute(sql`SELECT coalesce(max(version),0)::int AS version FROM employee_compensation_packages WHERE employee_id=${person.id}`)).rows[0].version);
   if(latest!==Number(row.expected_package_version))fail(409,'Compensation changed since preparation. Reject and prepare a fresh proposal');
   const saved=(await tx.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by) VALUES(${person.id},${latest+1},${row.effective_from}::date,${JSON.stringify(row.definition)}::jsonb,${'Signed contract '+contract.reference+': '+row.reason},${req.user!.userId}) RETURNING *`)).rows[0];
   packageId=packageRow(saved).id;
  }
  const saved=(await tx.execute(sql`UPDATE contract_compensation_proposals SET version=version+1,status=${action==='approve'?'applied':'rejected'},reviewed_by=${req.user!.userId},review_reason=${input.reason},reviewed_at=now(),package_id=${packageId} WHERE id=${row.id} RETURNING *`)).rows[0];
  await recordHistory(tx,req,'contract_compensation',saved,input.reason);
  return {id:row.id,status:saved.status,packageId};
 }));
}));
export default router;
