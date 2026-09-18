import {Router,type Request} from 'express';
import multer from 'multer';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {and,desc,eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {bulkImportJobs as jobs,employeeImportRows as rows,employees,activityLogs} from '@shared/schema';
import {employeeImportColumns,type ImportIssue} from '@shared/employee-import';
import {authenticate,authorize} from '../middleware/auth';
import {OnboardingError} from '../services/onboarding-workflow';
import {recordHandler as handle} from '../services/workplaceRecords';
import {IMPORT_MAX_BYTES,IMPORT_MAX_ROWS,parseEmployeeCsv,importPayloadSchema,validateImportRows,saveImportValidation,importJobView,importHistory,importReportCsv} from '../services/bulkImport';
const router=Router();router.use(authenticate,authorize(['admin','super_admin']));router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const id=z.coerce.number().int().positive(),version=z.number().int().positive(),reason=z.string().trim().min(5).max(1000);
const fail=(status:number,message:string):never=>{throw new OnboardingError(status,message);};
const receive=multer({storage:multer.memoryStorage(),limits:{fileSize:IMPORT_MAX_BYTES,files:1,fields:1,fieldSize:100}}).single('file');
async function owned(tx:any,req:Request,lock=false){
 const where=and(eq(jobs.id,id.parse(req.params.jobId)),eq(jobs.uploadedBy,req.user!.userId));
 const query=tx.select().from(jobs).where(where),[job]=await(lock?query.for('update'):query);
 if(!job)fail(404,'Import job not found');return job as typeof jobs.$inferSelect;
}
function editable(job:typeof jobs.$inferSelect,expected:number){if(!job.submissionKey||job.status!=='draft')fail(409,'Only a saved draft can be changed');if(job.version!==expected)fail(409,'The draft changed; reload before continuing');}
async function staged(tx:any,jobId:number){return tx.select().from(rows).where(eq(rows.jobId,jobId)).orderBy(rows.rowNumber);}
router.get('/template',(_req,res)=>{res.type('text/csv; charset=utf-8').attachment('employee_import_template.csv').send(employeeImportColumns.map(c=>c.key).join(',')+'\r\n');});
router.get('/columns',(_req,res)=>res.json({columns:employeeImportColumns,maxRows:IMPORT_MAX_ROWS,maxBytes:IMPORT_MAX_BYTES}));
router.post('/upload',(req,res,next)=>receive(req,res,e=>{if(e instanceof multer.MulterError)return res.status(e.code==='LIMIT_FILE_SIZE'?413:400).json({message:e.code==='LIMIT_FILE_SIZE'?'Choose a CSV file up to 2 MB':'Upload one CSV file with one submission key'});if(e)return next(e);next();}),handle(async(req,res)=>{
 const body=z.object({submissionKey:z.string().uuid()}).strict().parse(req.body);
 if(!req.file||!req.file.originalname.toLowerCase().endsWith('.csv'))fail(400,'Choose a UTF-8 CSV file');
 const input=parseEmployeeCsv(req.file.buffer),hash=createHash('sha256').update(req.file.buffer).digest('hex');
 const fileName=req.file.originalname.split(/[\\/]/).pop()!.slice(0,180);
 const duplicate=async()=>{const [old]=await db.select().from(jobs).where(and(eq(jobs.uploadedBy,req.user.userId),eq(jobs.submissionKey,body.submissionKey)));if(old&&old.fileHash!==hash)fail(409,'This submission key belongs to a different file');return old;};
 const old=await duplicate();if(old)return res.json({jobId:old.id,job:importJobView(old),replayed:true});
 try{
  const result=await db.transaction(async tx=>{
   const [job]=await tx.insert(jobs).values({fileName,fileUrl:'staged-csv',uploadedBy:req.user.userId,status:'draft',createdAt:new Date(),submissionKey:body.submissionKey,fileHash:hash,totalRows:input.length}).returning();
   await tx.insert(rows).values(input.map(r=>({...r,jobId:job.id})));
   const checked=await validateImportRows(tx,await staged(tx,job.id));const saved=await saveImportValidation(tx,job.id,checked,1);
   await importHistory(tx,req,saved,'uploaded','CSV saved for review');return saved;
  });res.status(201).json({jobId:result.id,job:importJobView(result)});
 }catch(e:any){if((e.code||e.cause?.code)==='23505'){const replay=await duplicate();if(replay)return res.json({jobId:replay.id,job:importJobView(replay),replayed:true});}throw e;}
}));
router.get('/jobs',handle(async(req,res)=>{
 const page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
 const items=await db.select().from(jobs).where(eq(jobs.uploadedBy,req.user.userId)).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(21).offset((page-1)*20);
 res.json({items:items.slice(0,20).map(importJobView),hasMore:items.length>20,page});
}));
router.get('/job/:jobId',handle(async(req,res)=>res.json(importJobView(await owned(db,req)))));
router.get('/job/:jobId/rows',handle(async(req,res)=>{
 const job=await owned(db,req);const q=z.object({page:z.coerce.number().int().min(1).max(1000).default(1),filter:z.enum(['all','errors','included','excluded','imported']).default('all')}).strict().parse(req.query);
 const where=and(eq(rows.jobId,job.id),q.filter==='errors'?sql`${rows.included}=true AND jsonb_array_length(${rows.errors})>0`:q.filter==='included'?eq(rows.included,true):q.filter==='excluded'?eq(rows.included,false):q.filter==='imported'?sql`${rows.employeeId} IS NOT NULL`:undefined);
 const found=await db.select().from(rows).where(where).orderBy(rows.rowNumber).limit(26).offset((q.page-1)*25);
 res.json({items:found.slice(0,25),hasMore:found.length>25,version:job.version});
}));
router.patch('/job/:jobId/rows/:rowId',handle(async(req,res)=>{
 const body=z.object({version,payload:importPayloadSchema.optional(),included:z.boolean().optional(),reason}).strict().refine(v=>v.payload!==undefined||v.included!==undefined,'Supply a correction or inclusion choice').parse(req.body),rowId=id.parse(req.params.rowId);
 const job=await db.transaction(async tx=>{
  const old=await owned(tx,req,true);editable(old,body.version);
  const [current]=await tx.select().from(rows).where(and(eq(rows.jobId,old.id),eq(rows.id,rowId)));if(!current)fail(404,'Import record not found');
  await tx.update(rows).set({...body.payload!==undefined?{payload:body.payload}:{},...body.included!==undefined?{included:body.included}:{}}).where(eq(rows.id,rowId));
  const saved=await saveImportValidation(tx,old.id,await validateImportRows(tx,await staged(tx,old.id)),old.version+1);
  await importHistory(tx,req,saved,'corrected',body.reason,{rowNumber:current.rowNumber,fields:body.payload?Object.keys(body.payload):[],included:body.included??current.included});return saved;
 });res.json(importJobView(job));
}));
router.post('/job/:jobId/revalidate',handle(async(req,res)=>{
 const body=z.object({version}).strict().parse(req.body);
 const job=await db.transaction(async tx=>{const old=await owned(tx,req,true);editable(old,body.version);const saved=await saveImportValidation(tx,old.id,await validateImportRows(tx,await staged(tx,old.id)),old.version+1);await importHistory(tx,req,saved,'validated','Draft checked against current employee records');return saved;});res.json(importJobView(job));
}));
router.post('/job/:jobId/cancel',handle(async(req,res)=>{
 const body=z.object({version,reason}).strict().parse(req.body);
 const job=await db.transaction(async tx=>{const old=await owned(tx,req,true);editable(old,body.version);const [saved]=await tx.update(jobs).set({status:'cancelled',completedAt:new Date(),version:old.version+1}).where(eq(jobs.id,old.id)).returning();await importHistory(tx,req,saved,'cancelled',body.reason);return saved;});res.json(importJobView(job));
}));
router.post('/job/:jobId/commit',handle(async(req,res)=>{
 const body=z.object({version,reason,confirmedRows:z.number().int().min(1).max(IMPORT_MAX_ROWS)}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const old=await owned(tx,req,true);
  if(old.submissionKey&&old.status==='completed'&&old.committedFromVersion===body.version&&old.includedRows===body.confirmedRows)return {job:old,replayed:true,blocked:false};
  editable(old,body.version);
  // Matches employee management's hierarchy lock, and blocks every competing employee insert/update until commit.
  await tx.execute(sql`LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`);
  const checked=await validateImportRows(tx,await staged(tx,old.id));
  if(!checked.includedRows)fail(400,'Include at least one employee record');
  if(checked.includedRows!==body.confirmedRows)fail(409,'The included count changed; review the current draft');
  if(checked.failedRows){const saved=await saveImportValidation(tx,old.id,checked,old.version+1);await importHistory(tx,req,saved,'blocked','Commit blocked by current validation errors');return {job:saved,blocked:true,replayed:false};}
  const included=checked.rows.filter(r=>r.included);
  const created=await tx.insert(employees).values(included.map(r=>r.values!)).returning({id:employees.id,employeeId:employees.employeeId});
  const identifiers=new Map([...checked.existing,...created].map(e=>[e.employeeId.trim().toLowerCase(),e.id]));
  const links=included.map(r=>({rowId:r.id,id:identifiers.get(r.values!.employeeId.toLowerCase())!,reportingManagerId:r.payload.managerEmployeeId?identifiers.get(r.payload.managerEmployeeId.trim().toLowerCase())!:null,secondaryManagerId:r.payload.secondaryManagerEmployeeId?identifiers.get(r.payload.secondaryManagerEmployeeId.trim().toLowerCase())!:null}));
  const managers=links.filter(r=>r.reportingManagerId||r.secondaryManagerId);
  if(managers.length)await tx.execute(sql`UPDATE employees AS e SET reporting_manager_id=v."reportingManagerId",secondary_manager_id=v."secondaryManagerId" FROM jsonb_to_recordset(${JSON.stringify(managers)}::jsonb) AS v(id integer,"reportingManagerId" integer,"secondaryManagerId" integer) WHERE e.id=v.id`);
  await tx.execute(sql`UPDATE employee_import_rows AS r SET employee_id=v.id,errors='[]'::jsonb FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS v("rowId" integer,id integer) WHERE r.id=v."rowId" AND r.job_id=${old.id}`);
  await tx.insert(activityLogs).values(created.map(e=>({userId:req.user.userId,action:'create',entityType:'employee',entityId:e.id,details:'Employee created from import job #'+old.id})));
  const [job]=await tx.update(jobs).set({status:'completed',successfulRows:included.length,failedRows:0,includedRows:included.length,validatedAt:new Date(),completedAt:new Date(),version:old.version+1,committedFromVersion:old.version}).where(eq(jobs.id,old.id)).returning();
  await importHistory(tx,req,job,'committed',body.reason);return {job,blocked:false,replayed:false};
 });res.status(result.blocked?409:200).json({job:importJobView(result.job),replayed:result.replayed,...result.blocked?{message:'No employees were imported. Correct the current validation errors and review again'}:{}});
}));
router.get('/job/:jobId/report',handle(async(req,res)=>{
 const job=await owned(db,req);if(!job.submissionKey)fail(409,'Detailed reports are available for reviewed imports only');
 res.type('text/csv; charset=utf-8').attachment('employee-import-'+job.id+'-report.csv').send(importReportCsv(await staged(db,job.id)));
}));
router.get('/job/:jobId/history',handle(async(req,res)=>{
 const job=await owned(db,req),page=z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
 const r=await db.execute(sql`SELECT version,actor_id,created_at,reason,snapshot FROM lifecycle_history WHERE kind='employee_import' AND record_id=${job.id} ORDER BY version DESC LIMIT 21 OFFSET ${(page-1)*20}`);res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});
}));
export default router;
