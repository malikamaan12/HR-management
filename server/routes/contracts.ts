import {Router} from 'express';
import {z} from 'zod';
import {and,eq,or,sql} from 'drizzle-orm';
import {createHash,randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {rateLimit} from 'express-rate-limit';
import {db} from '../db';
import {employees,users,notifications} from '@shared/schema';
import {contractManager,contractStatuses,contractDraftSchema,clauseSchema,signatureSchema,bilingualIssues,agreementEnglish,agreementArabic,type ContractDocument,type ContractSignature} from '@shared/contracts';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {getCompanySettings} from '../services/settings';
import {recordHandler as handle,recordHistory,WorkflowError} from '../services/workflowRecords';
import type {TokenPayload} from '../services/auth';
import {printableContract} from '../services/contracts';
import templateRoutes from './contract-templates';

const router=Router(); router.use(authenticate);
router.use('/templates',templateRoutes);
const id=z.coerce.number().int().positive(), version=z.number().int().positive();
const note=z.string().trim().min(3).max(2000);
const fail=(status:number,message:string):never=>{throw new WorkflowError(status,message);};
const manageScope=(user:TokenPayload)=>contractManager(user.role)?employeeScope(user,'employee_database','update'):sql`false`;
const readScope=(user:TokenPayload)=>or(manageScope(user),and(eq(employees.userId,user.userId),sql`c.status<>'draft'`))!;
const requireManager=(req:any)=>{if(!contractManager(req.user.role))fail(403,'HR contract access is required');};
const checkVersion=(row:any,expected:number)=>{if(Number(row.version)!==expected)fail(409,'This contract changed. Reload before continuing.');};
const hash=(value:ContractDocument)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function record(tx:any,req:any,contractId:number,lock=false){
  const row=(await tx.execute(sql`SELECT c.*,employees.first_name || ' ' || employees.last_name AS employee_name,employees.user_id AS employee_user_id,
    employees.status AS employee_status,(${manageScope(req.user)}) AS can_manage FROM employee_contracts c JOIN employees ON employees.id=c.employee_id
    WHERE c.id=${contractId} AND ${readScope(req.user)} ${lock?sql`FOR UPDATE OF c,employees`:sql``}`)).rows[0];
  if(!row)fail(404,'Contract not found');return row;
}
async function history(tx:any,req:any,row:any,action:string,reason:string){
  await recordHistory(tx,req,'employee_contract',{id:row.id,version:row.version,status:row.status,action,contentHash:row.content_hash},reason);
}
async function notifyContract(tx:any,userId:number,row:any,message:string){
  await tx.insert(notifications).values({userId,message,channel:'push',status:'pending',data:{type:'employee_contract',recordId:row.id,url:`/contracts?contract=${row.id}`}});
}
const clauseInput=clauseSchema.extend({category:z.string().trim().min(2).max(80),active:z.boolean().default(true)});
function validateClause(input:z.infer<typeof clauseInput>){
  if(input.title.length<2||input.body.length<3)fail(400,'Enter the English clause title and text');
  if(input.active&&(!input.titleAr||!input.bodyAr))fail(400,'Available clauses need both English and Arabic text');
}
router.get('/context',handle(async(req,res)=>{
  const q=z.string().trim().max(100).parse(req.query.q||''), pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const candidates=contractManager(req.user.role)?(await db.execute(sql`SELECT employees.id,employees.employee_id AS reference,
    employees.first_name || ' ' || employees.last_name AS name,employees.position,employees.department,employees.location,
    employees.joining_date AS "startDate",employees.contract_end_date AS "endDate" FROM employees WHERE ${manageScope(req.user)} AND employees.status<>'inactive'
    AND (employees.first_name || ' ' || employees.last_name || ' ' || employees.employee_id) ILIKE ${pattern} ORDER BY employees.first_name,employees.id LIMIT 50`)).rows:[];
  const company=contractManager(req.user.role)?await getCompanySettings():null;
  res.json({canManage:contractManager(req.user.role),employees:candidates,company:company?{name:company.companyName,address:company.companyAddress}:null});
}));
router.get('/clauses',handle(async(req,res)=>{requireManager(req);res.json((await db.execute(sql`SELECT id,title,body,title_ar AS "titleAr",body_ar AS "bodyAr",category,active,version FROM contract_clauses ORDER BY active DESC,category,title`)).rows);}));
router.post('/clauses',handle(async(req,res)=>{
  requireManager(req);const input=clauseInput.parse(req.body);validateClause(input);
  res.status(201).json(await db.transaction(async tx=>{
    const row=(await tx.execute(sql`INSERT INTO contract_clauses(title,category,body,title_ar,body_ar,active,updated_by) VALUES(${input.title},${input.category},${input.body},${input.titleAr},${input.bodyAr},${input.active},${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'contract_clause',row,'Clause added');return row;
  }));
}));
router.patch('/clauses/:id',handle(async(req,res)=>{
  requireManager(req);const clauseId=id.parse(req.params.id),input=clauseInput.extend({version}).parse(req.body);validateClause(input);
  res.json(await db.transaction(async tx=>{
    const row=(await tx.execute(sql`UPDATE contract_clauses SET title=${input.title},category=${input.category},body=${input.body},title_ar=${input.titleAr},body_ar=${input.bodyAr},active=${input.active},
      version=version+1,updated_by=${req.user.userId},updated_at=now() WHERE id=${clauseId} AND version=${input.version} RETURNING *`)).rows[0];
    if(!row)fail(409,'Clause changed. Reload the library.');await recordHistory(tx,req,'contract_clause',row,'Clause updated');return row;
  }));
}));
router.get('/',handle(async(req,res)=>{
  const input=z.object({status:z.enum(['',...contractStatuses]).default(''),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
  const pattern='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=(await db.execute(sql`SELECT c.id,c.reference,c.status,c.version,c.document->>'title' AS title,c.created_at,c.sent_at,c.signed_at,
    employees.first_name || ' ' || employees.last_name AS employee_name FROM employee_contracts c JOIN employees ON employees.id=c.employee_id
    WHERE ${readScope(req.user)} AND (${input.status===''} OR c.status=${input.status}) AND
    (c.reference ILIKE ${pattern} OR (employees.first_name || ' ' || employees.last_name) ILIKE ${pattern}) ORDER BY c.id DESC LIMIT 26 OFFSET ${(input.page-1)*25}`)).rows;
  res.json({items:rows.slice(0,25),hasMore:rows.length>25});
}));
router.post('/',handle(async(req,res)=>{
  requireManager(req);const input=z.object({employeeId:id,document:contractDraftSchema,submissionKey:z.string().uuid(),template:z.object({id,version}).strict().optional()}).strict().parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const [employee]=await tx.select().from(employees).where(and(eq(employees.id,input.employeeId),manageScope(req.user))).for('share');
    if(!employee||employee.status==='inactive')fail(404,'Active employee not found in your scope');
    const previous=(await tx.execute(sql`SELECT id,employee_id FROM employee_contracts WHERE created_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];
    if(previous){if(Number(previous.employee_id)!==employee.id)fail(409,'Submission key was already used');return {id:previous.id};}
    if(input.template){
      const template=(await tx.execute(sql`SELECT id FROM contract_templates WHERE id=${input.template.id} AND version=${input.template.version} AND active FOR SHARE`)).rows[0];
      if(!template)fail(409,'The template changed or was archived. Reload it before creating the contract.');
    }
    const company=await getCompanySettings(tx);
    const document:ContractDocument={...input.document,companyName:company.companyName,companyAddress:company.companyAddress,
      employeeName:employee.firstName+' '+employee.lastName,employeeReference:employee.employeeId};
    const row=(await tx.execute(sql`INSERT INTO employee_contracts(reference,employee_id,document,created_by,submission_key,template_id,template_version)
      VALUES(${'CTR-'+randomUUID().slice(0,12).toUpperCase()},${employee.id},${JSON.stringify(document)}::jsonb,${req.user.userId},${input.submissionKey},${input.template?.id||null},${input.template?.version||null}) RETURNING *`)).rows[0];
    await history(tx,req,row,'created','Contract draft created');return {id:row.id};
  }));
}));
router.get('/:id',handle(async(req,res)=>{
  const row=await record(db,req,id.parse(req.params.id));
  const events=(await db.execute(sql`SELECT h.snapshot->>'action' AS action,h.reason AS note,h.created_at,u.first_name || ' ' || u.last_name AS actor_name
    FROM hr_workflow_history h LEFT JOIN users u ON u.id=h.actor_id WHERE h.kind='employee_contract' AND h.record_id=${row.id} ORDER BY h.version DESC LIMIT 100`)).rows;
  res.json({...row,employee_user_id:undefined,canManage:!!row.can_manage,canSign:row.status==='sent'&&Number(row.sent_to_user_id)===req.user.userId&&Number(row.employee_user_id)===req.user.userId&&row.employee_status!=='inactive',history:events});
}));
router.patch('/:id',handle(async(req,res)=>{
  requireManager(req);const input=z.object({version,document:contractDraftSchema}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);
    if(!row.can_manage||row.status!=='draft')fail(409,'Only an HR draft can be edited. Create a new draft from a sent contract.');
    const document={...row.document,...input.document};
    const saved=(await tx.execute(sql`UPDATE employee_contracts SET document=${JSON.stringify(document)}::jsonb,version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,'edited','Draft terms updated');return {id:row.id};
  }));
}));
router.post('/:id/send',handle(async(req,res)=>{
  requireManager(req);const input=z.object({version,confirmed:z.literal(true)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);
    if(!row.can_manage||row.status!=='draft')fail(409,'Only a draft can be sent');
    if(Number(row.employee_user_id)===req.user.userId)fail(403,'Another HR colleague must send your own contract');
    const [recipient]=await tx.select().from(users).where(eq(users.id,Number(row.employee_user_id)||0)).for('share');
    if(row.employee_status==='inactive'||!recipient||!recipient.isActive||recipient.accountState!=='active'||recipient.approvalStatus!=='approved'||recipient.passwordSetupRequired)fail(409,'The employee needs an active linked account with password setup completed');
    const {companyName,companyAddress,employeeName,employeeReference,...draft}=row.document;
    contractDraftSchema.parse(draft);
    const missing=bilingualIssues(row.document);if(missing.length)fail(400,'Complete the bilingual contract: '+missing.join('; '));
    if(row.document.languageMode!=='en-ar')fail(400,'Save the English–Arabic draft before sending');
    // JSONB reorders object keys. Hash the stored document, exactly as returned to the signer.
    const contentHash=hash(row.document);
    const saved=(await tx.execute(sql`UPDATE employee_contracts SET status='sent',content_hash=${contentHash},sent_by=${req.user.userId},sent_to_user_id=${recipient.id},sent_at=now(),version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,'sent','Exact contract version sent for employee review');
    await notifyContract(tx,recipient.id,saved,`Contract ${row.reference} is ready for your review and signature.`);return {id:row.id};
  }));
}));
const signLimit=rateLimit({windowMs:15*60_000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
const accountSignLimit=rateLimit({windowMs:15*60_000,limit:10,keyGenerator:req=>String(req.user!.userId),standardHeaders:'draft-8',legacyHeaders:false,
  message:{message:'Too many signature attempts. Please wait before trying again.'}});
router.post('/:id/sign',signLimit,accountSignLimit,handle(async(req,res)=>{
  const input=z.object({version,contentHash:z.string().regex(/^[a-f0-9]{64}$/),signature:signatureSchema,currentPassword:z.string().min(1).max(1024)}).strict().parse(req.body);
  const [identity]=await db.select().from(users).where(eq(users.id,req.user.userId));
  if(!identity||!(await bcrypt.compare(input.currentPassword,identity.password)))fail(401,'Your current password is incorrect');
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);
    const [current]=await tx.select().from(users).where(eq(users.id,req.user.userId)).for('share');
    if(!current||!current.isActive||current.accountState!=='active'||current.approvalStatus!=='approved'||current.passwordSetupRequired||current.accountVersion!==identity.accountVersion||current.password!==identity.password)fail(401,'Account access changed. Sign in again.');
    if(row.status!=='sent'||Number(row.employee_user_id)!==req.user.userId||Number(row.sent_to_user_id)!==req.user.userId||row.employee_status==='inactive'||Number(row.sent_by)===req.user.userId)fail(403,'Only the assigned employee can sign this contract');
    if(row.content_hash!==input.contentHash||hash(row.document)!==input.contentHash)fail(409,'The contract copy changed. Reload and read it before signing');
    const recordedAt=new Date().toISOString();
    const signature:ContractSignature={...input.signature,statement:row.document.languageMode==='en-ar'?agreementEnglish:'I have reviewed this exact contract and agree to its terms. I intend my signature to confirm my agreement.',
      ...(row.document.languageMode==='en-ar'?{statementAr:agreementArabic}:{}),contentHash:input.contentHash,userId:req.user.userId,recordedAt};
    const saved=(await tx.execute(sql`UPDATE employee_contracts SET status='signed',signature=${JSON.stringify(signature)}::jsonb,signed_by=${req.user.userId},signed_at=${recordedAt}::timestamptz,version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,'signed','Employee signed the exact contract version');
    await notifyContract(tx,Number(row.sent_by),saved,`Contract ${row.reference} has been signed by the employee.`);return {id:row.id};
  }));
}));
router.post('/:id/:action(decline|withdraw|revise)',handle(async(req,res)=>{
  const input=z.object({version,note,submissionKey:z.string().uuid().optional()}).strict().parse(req.body),action=req.params.action;
  res.json(await db.transaction(async tx=>{
    const row=await record(tx,req,id.parse(req.params.id),true);checkVersion(row,input.version);
    if(action==='revise'){
      if(!row.can_manage||row.status==='draft'||!input.submissionKey)fail(403,'HR can create a new draft from a sent contract');
      const previous=(await tx.execute(sql`SELECT id,source_id FROM employee_contracts WHERE created_by=${req.user.userId} AND submission_key=${input.submissionKey}`)).rows[0];
      if(previous){if(Number(previous.source_id)!==Number(row.id))fail(409,'Submission key was already used');return {id:previous.id};}
      const saved=(await tx.execute(sql`INSERT INTO employee_contracts(reference,employee_id,source_id,document,created_by,submission_key,template_id,template_version) VALUES(${'CTR-'+randomUUID().slice(0,12).toUpperCase()},${row.employee_id},${row.id},${JSON.stringify(row.document)}::jsonb,${req.user.userId},${input.submissionKey},${row.template_id},${row.template_version}) RETURNING *`)).rows[0];
      await history(tx,req,saved,'created','New draft from '+row.reference+': '+input.note);return {id:saved.id};
    }
    if(row.status!=='sent')fail(409,'Only a contract awaiting signature can be declined or withdrawn');
    if(action==='withdraw'&&!row.can_manage)fail(403,'HR access required');
    if(action==='decline'&&(Number(row.sent_to_user_id)!==req.user.userId||Number(row.employee_user_id)!==req.user.userId))fail(403,'Only the assigned employee can decline');
    const saved=(await tx.execute(sql`UPDATE employee_contracts SET status=${action==='decline'?'declined':'withdrawn'},response_note=${input.note},version=version+1,updated_at=now() WHERE id=${row.id} RETURNING *`)).rows[0];
    await history(tx,req,saved,action,input.note);
    await notifyContract(tx,Number(action==='decline'?row.sent_by:row.sent_to_user_id),saved,action==='decline'?`The employee requested changes to contract ${row.reference}.`:`HR withdrew unsigned contract ${row.reference}.`);
    return {id:row.id};
  }));
}));
router.get('/:id/download',handle(async(req,res)=>{
  const row=await record(db,req,id.parse(req.params.id));
  res.set('Cache-Control','no-store');
  if(req.query.download==='true')res.attachment(row.reference+'.html');
  res.type('html').send(printableContract(row));
}));
export default router;
