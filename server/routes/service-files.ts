import {Router,type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {learningEnrollments,serviceRequests,serviceFiles} from '@shared/schema';
import type {ServiceKind} from '@shared/employee-services';
import {serviceModule} from '@shared/employee-services';
import {positiveId} from '@shared/hr-rules';
import {event,enrollmentRecord,requestRecord,fileMetadata,versionCheck,requireWriter} from '../services/employee-services';
import {audit} from '../services/hr-rules';
import {fail} from '../services/workforce';
import {handle} from './hr-rules';
import {validateDocumentFile,privateStorageConfigured,uploadServiceFile,deleteServiceFile,serviceFileUrl} from '../services/r2';
const parser=multer({storage:multer.memoryStorage(),limits:{fileSize:10485760,files:1,fields:1}}).single('file');
const upload=(req:Request,res:Response,next:NextFunction)=>parser(req,res,e=>{if(e)return res.status(400).json({message:'Attach one PDF, PNG or JPEG up to 10 MB'});if(!req.file)return res.status(400).json({message:'Choose a file'});try{validateDocumentFile(req.file);}catch{return res.status(400).json({message:'Choose a valid PDF, PNG or JPEG up to 10 MB'});}next();});
export function serviceFileRoutes(kind:'learning'|ServiceKind){
  const router=Router();
  router.post('/:id/files',upload,handle(async(req,res)=>{
    const id=positiveId.parse(req.params.id),version=z.coerce.number().int().positive().parse(req.body.version);let uploaded:string|undefined;
    try {const result=await db.transaction(async tx=>{
      const {row,employee}=kind==='learning'?await enrollmentRecord(tx,req.user!,id,true):await requestRecord(tx,req.user!,id,kind,true);
      const owner=employee.userId===req.user!.userId,creator='requestedBy' in row?row.requestedBy:row.createdBy;
      if(!owner&&creator!==req.user!.userId)fail(403,'Only the employee or original preparer can attach evidence');
      requireWriter(req.user!,employee,kind==='learning'?'training_development':serviceModule(kind));
      versionCheck(row.version,version);
      if(!(kind==='learning'?['approved','in_progress']:['draft','returned']).includes(row.status))fail(409,'Files can only be added while preparing this request');
      if((await fileMetadata(tx,kind,id)).length>=10)fail(409,'A request can contain up to ten files');
      if(!privateStorageConfigured())fail(503,'Private file storage is not configured');
      uploaded=await uploadServiceFile(kind,id,req.file!);
      const filename=(req.file!.originalname.split(/[\\/]/).pop()||'attachment').replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||'attachment';
      const [file]=await tx.insert(serviceFiles).values({enrollmentId:kind==='learning'?id:null,requestId:kind==='learning'?null:id,objectKey:uploaded,filename,size:req.file!.size,uploadedBy:req.user!.userId}).returning({id:serviceFiles.id});
      const patch={version:row.version+1,updatedAt:new Date(),history:event(row.history,req.user!,'Evidence attached',filename,row.version+1,{fileId:file.id})};
      if(kind==='learning')await tx.update(learningEnrollments).set(patch).where(eq(learningEnrollments.id,id));else await tx.update(serviceRequests).set(patch).where(eq(serviceRequests.id,id));
      await audit(tx,req.user!,'service_file',file.id,'Private evidence attached');return file;
    });res.status(201).json(result);}catch(e){if(uploaded)try{await deleteServiceFile(uploaded);}catch{console.error('Service file cleanup failed');}throw e;}
  }));
  router.get('/:id/files/:fileId/download',handle(async(req,res)=>{
    const id=positiveId.parse(req.params.id),fileId=positiveId.parse(req.params.fileId);
    const key=await db.transaction(async tx=>{if(kind==='learning')await enrollmentRecord(tx,req.user!,id);else await requestRecord(tx,req.user!,id,kind);const [file]=await tx.select().from(serviceFiles).where(eq(serviceFiles.id,fileId));if(!file||(kind==='learning'?file.enrollmentId!==id:file.requestId!==id))fail(404,'File not found');return file.objectKey;});
    if(!privateStorageConfigured())fail(503,'Private file storage is not configured');res.json({url:await serviceFileUrl(key)});
  }));return router;
}
