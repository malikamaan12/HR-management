import { getCompanySettings } from '../services/settings';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, eq, lte, desc } from 'drizzle-orm';
import { db } from '../db';
import { documents, documentVersions, employees, insertDocumentSchema } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { employeeScope } from '../services/access';
import { uploadDocument, deleteDocumentObject, documentDownloadUrl, StorageUnavailableError, validateDocumentFile } from '../services/r2';

export const documentUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:12}});
const router=Router();router.use(authenticate);
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
router.post('/',documentUpload.single('document'),createDocument);
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
    const [row]=await db.select({document:documents,firstName:employees.firstName,lastName:employees.lastName}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id))
      .where(and(eq(documents.id,id),employeeScope(req.user!,'compliance_documents')));
    if(!row)return res.status(404).json({message:'Document not found'});
    return res.json({...row.document,employeeName:`${row.firstName} ${row.lastName}`});
  }catch{return res.status(400).json({message:'Invalid document request'});}
});
export default router;
