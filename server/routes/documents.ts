import { getCompanySettings } from '../services/settings';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, eq, lte, desc, sql, or } from 'drizzle-orm';
import { db } from '../db';
import { documents, documentVersions, documentRenewalRequests as renewals, employees, insertDocumentSchema } from '@shared/schema';
import { getAccessScope } from '@shared/permissions';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { uploadDocument, deleteDocumentObject, documentDownloadUrl, StorageUnavailableError, validateDocumentFile } from '../services/r2';

export const documentUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:12}});
const receiveDocument=(req:Request,res:Response,next:NextFunction)=>documentUpload.single('document')(req,res,error=>{
  if(error instanceof multer.MulterError)return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({message:error.code==='LIMIT_FILE_SIZE'?'Document files must not exceed 10 MB':'Upload one document with the required fields'});
  if(error)return next(error);next();
});
const router=Router();router.use(authenticate);
const versionNumber=sql<number>`coalesce((select max(version) from document_versions where document_id = ${documents.id}), 0)`;
class DocumentError extends Error {constructor(public status:number,message:string){super(message);}}
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value,'Invalid date');
const metadata=insertDocumentSchema.omit({documentFile:true,status:true}).extend({employeeId:z.coerce.number().int().positive(),issueDate:date,expiryDate:date})
  .refine(value=>value.expiryDate>=value.issueDate,'Expiry must be on or after the issue date');
export async function createDocument(req:Request,res:Response){
  const parsed=metadata.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:'Check the document fields',errors:parsed.error.flatten()});
  if(!req.file)return res.status(400).json({message:'A PDF, PNG, or JPEG file is required'});
  try{validateDocumentFile(req.file);}catch(error){return res.status(400).json({message:(error as Error).message});}
  let key:string|undefined;
  try {
    const [employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,parsed.data.employeeId),employeeScope(req.user!,'compliance_documents','create')));
    if(!employee)return res.status(403).json({message:'You cannot upload documents for this employee'});
    const policy=await getCompanySettings();
    key=await uploadDocument(employee.id,req.file);
    const today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+policy.documentExpiryDays*86400000).toISOString().slice(0,10);
    const document=await db.transaction(async tx=>{
      const [created]=await tx.insert(documents).values({...parsed.data,documentFile:key,status:parsed.data.expiryDate<today?'expired':parsed.data.expiryDate<=soon?'expiring_soon':'valid'}).returning();
      await tx.insert(documentVersions).values({documentId:created.id,version:1,snapshot:created,createdBy:req.user!.userId});
      return created;
    });
    return res.status(201).json(document);
  } catch(error){
    if(key)try{await deleteDocumentObject(key);}catch{console.error('Document upload cleanup failed');}
    if(error instanceof StorageUnavailableError)return res.status(503).json({message:error.message});
    return res.status(500).json({message:'Document upload failed'});
  }
}
router.post('/',receiveDocument,createDocument);
const replacementMetadata=z.object({documentNumber:z.string().trim().min(1).max(200),issueDate:date,expiryDate:date,
  issueAuthority:z.string().trim().max(200).default(''),notes:z.string().trim().max(5000).default(''),
  reason:z.string().trim().min(5).max(500),expectedVersion:z.coerce.number().int().min(0)}).strict()
  .refine(value=>value.expiryDate>=value.issueDate,'Expiry must be on or after the issue date');
router.post('/:id/replace',receiveDocument,async(req,res)=>{
  let key:string|undefined;
  try {
    const id=z.coerce.number().int().positive().parse(req.params.id),input=replacementMetadata.parse(req.body);
    if(!req.file)throw new DocumentError(400,'A new PDF, PNG, or JPEG file is required');
    try{validateDocumentFile(req.file);}catch(error){throw new DocumentError(400,(error as Error).message);}
    const [allowed]=await db.select({employeeId:documents.employeeId,currentVersion:versionNumber}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents','update')));
    if(!allowed)throw new DocumentError(404,'Document not found or replacement is not permitted');
    if(allowed.currentVersion!==input.expectedVersion)throw new DocumentError(409,'Document changed; reload before replacing it');
    const policy=await getCompanySettings();key=await uploadDocument(allowed.employeeId,req.file);
    const result=await db.transaction(async tx=>{
      const [current]=await tx.select().from(documents).where(eq(documents.id,id)).for('update');
      if(!current)throw new DocumentError(404,'Document not found');
      const [employee]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,current.employeeId),employeeScope(req.user!,'compliance_documents','update')));
      if(!employee||employee.id!==allowed.employeeId)throw new DocumentError(404,'Document access changed');
      const [latest]=await tx.select({version:documentVersions.version}).from(documentVersions).where(eq(documentVersions.documentId,id)).orderBy(desc(documentVersions.version)).limit(1);
      if((latest?.version??0)!==input.expectedVersion)throw new DocumentError(409,'Document changed; reload before replacing it');
      // Preserve legacy records before the first replacement, without claiming an original uploader.
      if(!latest)await tx.insert(documentVersions).values({documentId:id,version:1,snapshot:{...current,changeReason:'Legacy document preserved before replacement'},createdBy:req.user!.userId});
      const {expectedVersion,reason,...metadata}=input;
      const today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+policy.documentExpiryDays*86400000).toISOString().slice(0,10);
      const [updated]=await tx.update(documents).set({...metadata,documentFile:key,updatedAt:new Date(),status:input.expiryDate<today?'expired':input.expiryDate<=soon?'expiring_soon':'valid'}).where(eq(documents.id,id)).returning();
      const next=(latest?.version??1)+1;
      await tx.insert(documentVersions).values({documentId:id,version:next,snapshot:{...updated,changeReason:reason},createdBy:req.user!.userId});
      return {...updated,currentVersion:next};
    });
    return res.status(200).json(result);
  }catch(error){
    if(key)try{await deleteDocumentObject(key);}catch{console.error('Replacement upload cleanup failed');}
    if(error instanceof DocumentError)return res.status(error.status).json({message:error.message});
    if(error instanceof z.ZodError)return res.status(400).json({message:'Check document fields, dates and replacement reason'});
    if(error instanceof StorageUnavailableError)return res.status(503).json({message:error.message});
    return res.status(500).json({message:'Document replacement failed'});
  }
});
type Proposal = z.infer<typeof replacementMetadata> & {documentFile:string};
const reviewerScope=(req:Request)=>getAccessScope(req.user!.role,'compliance_documents')==='self'?sql`false`:employeeScope(req.user!,'compliance_documents','update');
const renewalVisibility=(req:Request)=>and(employeeScope(req.user!,'compliance_documents'),or(eq(renewals.requestedBy,req.user!.userId),reviewerScope(req)));
function renewalError(res:Response,error:unknown){
  if(error instanceof DocumentError)return res.status(error.status).json({message:error.message});
  if(error instanceof z.ZodError)return res.status(400).json({message:'Check renewal fields and decision reason'});
  if(error instanceof StorageUnavailableError)return res.status(503).json({message:error.message});
  return res.status(500).json({message:'Unable to process renewal request'});
}
router.get('/renewal-requests',async(req,res)=>{
  try{
    const offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
    const rows=await db.select({request:renewals,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,documentType:documents.documentType,
      canReview:sql<boolean>`${reviewerScope(req)} and ${renewals.requestedBy} <> ${req.user!.userId} and (${employees.userId} is null or ${employees.userId} <> ${req.user!.userId})`})
      .from(renewals).innerJoin(documents,eq(renewals.documentId,documents.id)).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(renewalVisibility(req)).orderBy(desc(renewals.createdAt),desc(renewals.id)).limit(51).offset(offset);
    return res.json({hasMore:rows.length>50,items:rows.slice(0,50).map(({request,employeeName,documentType,canReview})=>({...request,employeeName,documentType,
      canReview:canReview&&request.status==='pending',canWithdraw:request.requestedBy===req.user!.userId&&request.status==='pending'}))});
  }catch(error){return renewalError(res,error);}
});
router.post('/:id/renewal-requests',receiveDocument,async(req,res)=>{
  let key:string|undefined;
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id),input=replacementMetadata.parse(req.body);
    if(!req.file)throw new DocumentError(400,'A new PDF, PNG, or JPEG file is required');
    try{validateDocumentFile(req.file);}catch(error){throw new DocumentError(400,(error as Error).message);}
    const [allowed]=await db.select({employeeId:documents.employeeId}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents','update')));
    if(!allowed)throw new DocumentError(404,'Document not found or renewal is not permitted');
    key=await uploadDocument(allowed.employeeId,req.file);
    const result=await db.transaction(async tx=>{
      const [current]=await tx.select().from(documents).where(eq(documents.id,id)).for('update');
      const [employee]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,current.employeeId),employeeScope(req.user!,'compliance_documents','update')));
      if(!employee||employee.id!==allowed.employeeId)throw new DocumentError(404,'Document access changed');
      const [latest]=await tx.select({version:documentVersions.version}).from(documentVersions).where(eq(documentVersions.documentId,id)).orderBy(desc(documentVersions.version)).limit(1);
      if((latest?.version??0)!==input.expectedVersion)throw new DocumentError(409,'Document changed; reload before requesting renewal');
      const [pending]=await tx.select({id:renewals.id}).from(renewals).where(and(eq(renewals.documentId,id),eq(renewals.status,'pending')));
      if(pending)throw new DocumentError(409,'This document already has a pending renewal request');
      const [created]=await tx.insert(renewals).values({documentId:id,requestedBy:req.user!.userId,expectedVersion:input.expectedVersion,proposal:{...input,documentFile:key}}).returning();
      return created;
    });
    return res.status(201).json(result);
  }catch(error){
    if(key)try{await deleteDocumentObject(key);}catch{console.error('Renewal upload cleanup failed');}
    return renewalError(res,error);
  }
});
router.get('/renewal-requests/:requestId/download',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.requestId);
    const [row]=await db.select({proposal:renewals.proposal}).from(renewals).innerJoin(documents,eq(renewals.documentId,documents.id)).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(renewals.id,id),renewalVisibility(req)));
    if(!row)throw new DocumentError(404,'Renewal request not found');
    res.set('Cache-Control','no-store');return res.redirect(await documentDownloadUrl((row.proposal as Proposal).documentFile));
  }catch(error){return renewalError(res,error);}
});
router.post('/renewal-requests/:requestId/decision',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.requestId);
    const input=z.object({decision:z.enum(['approved','rejected','withdrawn']),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
    const policy=await getCompanySettings();
    const result=await db.transaction(async tx=>{
      const [visible]=await tx.select({documentId:renewals.documentId}).from(renewals).innerJoin(documents,eq(renewals.documentId,documents.id)).innerJoin(employees,eq(documents.employeeId,employees.id))
        .where(and(eq(renewals.id,id),renewalVisibility(req)));
      if(!visible)throw new DocumentError(404,'Renewal request not found');
      // All document writes lock the document first, so review and direct replacement serialize.
      const [current]=await tx.select().from(documents).where(eq(documents.id,visible.documentId)).for('update');
      const [request]=await tx.select().from(renewals).where(eq(renewals.id,id)).for('update');
      if(request.status!=='pending')throw new DocumentError(409,'This request has already been decided');
      const [employee]=await tx.select({userId:employees.userId}).from(employees).where(and(eq(employees.id,current.employeeId),
        input.decision==='withdrawn'?employeeScope(req.user!,'compliance_documents'):reviewerScope(req)));
      if(!employee)throw new DocumentError(403,'Renewal review is not permitted');
      if(input.decision==='withdrawn'){
        if(request.requestedBy!==req.user!.userId)throw new DocumentError(403,'Only the requester can withdraw this request');
      }else if(request.requestedBy===req.user!.userId||employee.userId===req.user!.userId)throw new DocumentError(403,'A different reviewer must decide this request');
      if(input.decision==='approved'){
        const [latest]=await tx.select({version:documentVersions.version}).from(documentVersions).where(eq(documentVersions.documentId,current.id)).orderBy(desc(documentVersions.version)).limit(1);
        if((latest?.version??0)!==request.expectedVersion)throw new DocumentError(409,'The document changed after submission; reject or withdraw this request and submit a fresh one');
        if(!latest)await tx.insert(documentVersions).values({documentId:current.id,version:1,snapshot:{...current,changeReason:'Legacy document preserved before replacement'},createdBy:req.user!.userId});
        const {expectedVersion,reason,...proposal}=request.proposal as Proposal;
        const today=new Date().toISOString().slice(0,10),soon=new Date(Date.now()+policy.documentExpiryDays*86400000).toISOString().slice(0,10);
        const [updated]=await tx.update(documents).set({...proposal,updatedAt:new Date(),status:proposal.expiryDate<today?'expired':proposal.expiryDate<=soon?'expiring_soon':'valid'}).where(eq(documents.id,current.id)).returning();
        await tx.insert(documentVersions).values({documentId:current.id,version:(latest?.version??1)+1,snapshot:{...updated,changeReason:reason,renewalRequestId:id,requestedBy:request.requestedBy,reviewReason:input.reason},createdBy:req.user!.userId});
      }
      const [decided]=await tx.update(renewals).set({status:input.decision,reviewReason:input.reason,reviewedBy:req.user!.userId,reviewedAt:new Date()}).where(eq(renewals.id,id)).returning();
      return decided;
    });
    return res.json(result);
  }catch(error){return renewalError(res,error);}
});
router.get('/:id/versions/:version/download',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id),version=z.coerce.number().int().positive().parse(req.params.version);
    const [row]=await db.select({snapshot:documentVersions.snapshot}).from(documentVersions).innerJoin(documents,eq(documentVersions.documentId,documents.id)).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),eq(documentVersions.version,version),employeeScope(req.user!,'compliance_documents')));
    const snapshot=row?.snapshot as {documentFile?:string;employeeId?:number}|undefined;
    if(!snapshot?.documentFile)return res.status(404).json({message:'Document version file not found'});
    const url=await documentDownloadUrl(snapshot.documentFile);res.set('Cache-Control','no-store');return res.redirect(url);
  }catch(error){return res.status(error instanceof StorageUnavailableError?503:400).json({message:error instanceof Error?error.message:'Download unavailable'});}
});
async function list(req:Request,res:Response){
  try{
    const policy=await getCompanySettings();
    const days=z.coerce.number().int().min(0).max(3650).default(policy.documentExpiryDays).parse(req.query.days);
    const rows=await db.select({document:documents,firstName:employees.firstName,lastName:employees.lastName}).from(documents)
      .innerJoin(employees,eq(documents.employeeId,employees.id)).where(and(employeeScope(req.user!,'compliance_documents'),
        req.path==='/expiring'?lte(documents.expiryDate,new Date(Date.now()+days*86400000).toISOString().slice(0,10)):undefined)).orderBy(desc(documents.createdAt));
    return res.json(rows.map(({document,firstName,lastName})=>({...document,status:document.expiryDate<new Date().toISOString().slice(0,10)?'expired':document.expiryDate<=new Date(Date.now()+policy.documentExpiryDays*86400000).toISOString().slice(0,10)?'expiring_soon':'valid',employeeName:`${firstName} ${lastName}`})));
  }catch{return res.status(500).json({message:'Unable to load documents'});}
}
router.get('/',list);router.get('/expiring',list);
router.get('/:id/versions',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id);
    const [visible]=await db.select({id:documents.id}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents')));
    if(!visible)return res.status(404).json({message:'Document not found'});
    return res.json(await db.select({id:documentVersions.id,version:documentVersions.version,snapshot:documentVersions.snapshot,createdBy:documentVersions.createdBy,createdAt:documentVersions.createdAt})
      .from(documentVersions).where(eq(documentVersions.documentId,id)).orderBy(desc(documentVersions.version)));
  }catch{return res.status(400).json({message:'Invalid document request'});}
});
router.get('/:id/download',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id);
    const [row]=await db.select({document:documents}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents')));
    if(!row?.document.documentFile)return res.status(404).json({message:'Document file not found'});
    const url=await documentDownloadUrl(row.document.documentFile);res.set('Cache-Control','no-store');return res.redirect(url);
  }catch(error){return res.status(error instanceof StorageUnavailableError?503:400).json({message:error instanceof Error?error.message:'Download unavailable'});}
});
router.get('/:id',async(req,res)=>{
  try{
    const id=z.coerce.number().int().positive().parse(req.params.id);
    const [row]=await db.select({document:documents,currentVersion:versionNumber,firstName:employees.firstName,lastName:employees.lastName}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents')));
    if(!row)return res.status(404).json({message:'Document not found'});
    const [writable]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,row.document.employeeId),employeeScope(req.user!,'compliance_documents','update')));
    return res.json({...row.document,currentVersion:row.currentVersion,canReplace:!!writable,employeeName:`${row.firstName} ${row.lastName}`});
  }catch{return res.status(400).json({message:'Invalid document request'});}
});
export default router;
