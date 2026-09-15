import {Router,type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {and,desc,eq,ilike,inArray,ne,or,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {helpdeskRoutingPolicies as routing,helpdeskTargetPolicies as targets,helpdeskArticles as articles,helpdeskArticleVersions as articleVersions,helpdeskCases as cases,helpdeskMessages as messages,helpdeskEvents as events,helpdeskAttachments as attachments,users} from '@shared/schema';
import {caseCategories,caseStatuses,statusLabels,helpdeskResponder,helpdeskTriage,idInput,newCaseInput,replyInput,caseActionInput} from '@shared/helpdesk';
import {HelpdeskError,reject,caseScope,capabilities,readCase,checkVersion,caseEvent,type HelpdeskTransaction} from '../services/helpdesk';
import {privateStorageConfigured,StorageUnavailableError,validateDocumentFile,uploadCaseAttachment,deleteCaseAttachment,caseAttachmentUrl} from '../services/r2';

const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const requesters=alias(users,'case_requester'),assignees=alias(users,'case_assignee');
const fields={escalatedAt:cases.escalatedAt,responseDueAt:cases.responseDueAt,resolutionDueAt:cases.resolutionDueAt,firstResponseAt:cases.firstResponseAt,resolvedAt:cases.resolvedAt,id:cases.id,title:cases.title,category:cases.category,confidential:cases.confidential,status:cases.status,requesterId:cases.requesterId,assigneeId:cases.assigneeId,version:cases.version,
  createdAt:cases.createdAt,updatedAt:cases.updatedAt,requesterName:sql<string>`${requesters.firstName} || ' ' || ${requesters.lastName}`,assigneeName:sql<string|null>`${assignees.firstName} || ' ' || ${assignees.lastName}`};
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  try{await fn(req,res);}catch(error){
    if(error instanceof HelpdeskError)return res.status(error.status).json({message:error.message});
    if(error instanceof z.ZodError)return res.status(400).json({message:error.issues.map(i=>i.message).join('; ')});
    if(error instanceof StorageUnavailableError)return res.status(503).json({message:'Private attachments are not configured. You can submit a text-only request.'});
    console.error('Helpdesk request failed',error instanceof Error?error.name:'Unknown');
    return res.status(500).json({message:'Unable to complete helpdesk request'});
  }
};
const uploader=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:8,fieldSize:50000}}).single('file');
const upload=(req:Request,res:Response,next:NextFunction)=>uploader(req,res,error=>{
  if(error)return res.status(error instanceof multer.MulterError&&error.code==='LIMIT_FILE_SIZE'?413:400).json({message:'Attach one PDF, PNG or JPEG file up to 10 MB'});
  if(req.file)try{validateDocumentFile(req.file);}catch{return res.status(400).json({message:'Attach a valid PDF, PNG or JPEG file up to 10 MB'});}
  next();
});
async function saveAttachment(tx:HelpdeskTransaction,req:Request,caseId:number,messageId:number,uploaded:string[]){
  if(!req.file)return;
  const key=await uploadCaseAttachment(caseId,req.file);uploaded.push(key);
  const filename=(req.file.originalname.split(/[\\/]/).pop()||'attachment').replace(/[\x00-\x1f\x7f]/g,'').slice(0,180)||'attachment';
  await tx.insert(attachments).values({messageId,objectKey:key,filename,size:req.file.size});
}
async function withUploads<T>(fn:(uploaded:string[])=>Promise<T>){
  const uploaded:string[]=[];
  try{return await fn(uploaded);}catch(error){for(const key of uploaded)try{await deleteCaseAttachment(key);}catch{console.error('Helpdesk attachment cleanup failed');}throw error;}
}
const canEditArticles=(req:Request)=>['super_admin','admin','hr_director'].includes(req.user!.role);
const routingAccess=(req:Request,confidential:boolean)=>{
 if(!['admin','super_admin'].includes(req.user!.role)||!helpdeskTriage(req.user!.role,confidential))reject(403,'Administrator access to this routing policy is required');
};
router.get('/routing',handle(async(req,res)=>{
 routingAccess(req,false);
 const rows=await db.select({category:routing.category,confidential:routing.confidential,version:routing.version,assigneeId:routing.assigneeId,name:sql<string|null>`${users.firstName} || ' ' || ${users.lastName}`}).from(routing).leftJoin(users,eq(routing.assigneeId,users.id))
  .where(helpdeskTriage(req.user!.role,true)?undefined:eq(routing.confidential,false)).orderBy(desc(routing.version));
 res.json({canConfigureConfidential:helpdeskTriage(req.user!.role,true),items:rows.filter((row,i)=>rows.findIndex(r=>r.category===row.category&&r.confidential===row.confidential)===i)});
}));
router.get('/routing/responders',handle(async(req,res)=>{
 const confidential=z.enum(['true','false']).parse(req.query.confidential)==='true';routingAccess(req,confidential);
 const q=z.string().trim().min(2).max(80).parse(req.query.q);
 res.json(await db.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),
  inArray(users.role,confidential?['super_admin','hr_director']:['super_admin','admin','hr_director','hr','hr_manager']),ilike(sql`${users.firstName} || ' ' || ${users.lastName}`,'%'+q.replace(/[\\%_]/g,'\\$&')+'%'))).orderBy(users.id).limit(20));
}));
router.get('/routing/history',handle(async(req,res)=>{
 const category=z.enum(caseCategories).parse(req.query.category),confidential=z.enum(['true','false']).parse(req.query.confidential)==='true';routingAccess(req,confidential);
 res.json(await db.select().from(routing).where(and(eq(routing.category,category),eq(routing.confidential,confidential))).orderBy(desc(routing.version)).limit(100));
}));
router.post('/routing',handle(async(req,res)=>{
 const input=z.object({category:z.enum(caseCategories),confidential:z.boolean(),assigneeId:z.number().int().positive().nullable(),expectedVersion:z.number().int().min(0),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
 routingAccess(req,input.confidential);
 if(input.category==='employee_relations'&&!input.confidential)reject(400,'Employee relations always uses confidential routing');
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE helpdesk_routing_policies IN SHARE ROW EXCLUSIVE MODE`);
  const [latest]=await tx.select().from(routing).where(and(eq(routing.category,input.category),eq(routing.confidential,input.confidential))).orderBy(desc(routing.version)).limit(1);
  if((latest?.version||0)!==input.expectedVersion)reject(409,'Routing policy changed; reload before saving');
  if(input.assigneeId){
   const [candidate]=await tx.select().from(users).where(eq(users.id,input.assigneeId)).for('share');
   if(!candidate||!candidate.isActive||candidate.approvalStatus!=='approved'||!helpdeskResponder(candidate.role)||(input.confidential&&!helpdeskTriage(candidate.role,true)))reject(400,'Choose an active eligible HR responder');
  }
  const {expectedVersion,...values}=input;
  const [row]=await tx.insert(routing).values({...values,version:expectedVersion+1,createdBy:req.user!.userId}).returning();return row;
 });res.status(201).json(result);
}));
router.get('/targets',handle(async(req,res)=>{
 const rows=await db.select().from(targets).orderBy(desc(targets.version));
 res.json({canEdit:['admin','super_admin'].includes(req.user!.role),items:caseCategories.map(category=>{const row=rows.find(row=>row.category===category);return {category,version:row?.version||0,responseHours:row?.responseHours??null,resolutionHours:row?.resolutionHours??null};})});
}));
router.post('/targets',handle(async(req,res)=>{
 if(!['admin','super_admin'].includes(req.user!.role))reject(403,'Administrator access is required for target policies');
 const input=z.object({category:z.enum(caseCategories),responseHours:z.number().int().min(1).max(720).nullable(),resolutionHours:z.number().int().min(1).max(2160).nullable(),expectedVersion:z.number().int().min(0),reason:z.string().trim().min(5).max(500)}).strict().refine(v=>v.responseHours===null||v.resolutionHours===null||v.resolutionHours>=v.responseHours,'Resolution target must not be earlier than response target').parse(req.body);
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE helpdesk_target_policies IN SHARE ROW EXCLUSIVE MODE`);
  const [latest]=await tx.select().from(targets).where(eq(targets.category,input.category)).orderBy(desc(targets.version)).limit(1);
  if((latest?.version||0)!==input.expectedVersion)reject(409,'Target policy changed; reload before saving');
  const {expectedVersion,...values}=input;const [row]=await tx.insert(targets).values({...values,version:expectedVersion+1,createdBy:req.user!.userId}).returning();return row;
 });res.status(201).json(result);
}));
const articleInput=z.object({title:z.string().trim().min(4).max(160),body:z.string().trim().min(10).max(20000),category:z.enum(caseCategories),published:z.boolean(),reason:z.string().trim().min(5).max(500),expectedVersion:z.number().int().min(0)}).strict();
router.get('/articles',handle(async(req,res)=>{
 const q=z.string().trim().max(100).default('').parse(req.query.q),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const condition=and(canEditArticles(req)?undefined:eq(articles.published,true),q?or(ilike(articles.title,'%'+q.replace(/[\\%_]/g,'\\$&')+'%'),ilike(articles.body,'%'+q.replace(/[\\%_]/g,'\\$&')+'%')):undefined);
 const rows=await db.select().from(articles).where(condition).orderBy(desc(articles.updatedAt),desc(articles.id)).limit(21).offset((page-1)*20);
 res.json({items:rows.slice(0,20),hasMore:rows.length>20,canEdit:canEditArticles(req)});
}));
router.post('/articles',handle(async(req,res)=>{
 if(!canEditArticles(req))reject(403,'Knowledge editor access is required');
 const input=articleInput.parse(req.body);if(input.expectedVersion!==0)reject(400,'A new article starts at version zero');
 const result=await db.transaction(async tx=>{
  const {expectedVersion,reason,...data}=input;
  const [row]=await tx.insert(articles).values({...data,updatedBy:req.user!.userId}).returning();
  await tx.insert(articleVersions).values({articleId:row.id,version:1,snapshot:{...row,reason},createdBy:req.user!.userId});return row;
 });res.status(201).json(result);
}));
router.post('/articles/:id',handle(async(req,res)=>{
 if(!canEditArticles(req))reject(403,'Knowledge editor access is required');
 const id=idInput.parse(req.params.id),input=articleInput.parse(req.body);
 const result=await db.transaction(async tx=>{
  const [current]=await tx.select().from(articles).where(eq(articles.id,id)).for('update');
  if(!current)reject(404,'Article not found');if(current.version!==input.expectedVersion)reject(409,'This article changed; reload before editing');
  const {expectedVersion,reason,...data}=input;
  const [row]=await tx.update(articles).set({...data,version:current.version+1,updatedBy:req.user!.userId,updatedAt:new Date()}).where(eq(articles.id,id)).returning();
  await tx.insert(articleVersions).values({articleId:id,version:row.version,snapshot:{...row,reason},createdBy:req.user!.userId});return row;
 });res.json(result);
}));
router.get('/articles/:id/history',handle(async(req,res)=>{
 if(!canEditArticles(req))reject(403,'Knowledge editor access is required');
 res.json(await db.select().from(articleVersions).where(eq(articleVersions.articleId,idInput.parse(req.params.id))).orderBy(desc(articleVersions.version)));
}));
router.get('/config',handle(async(req,res)=>{res.json({canConfigureRouting:['admin','super_admin'].includes(req.user!.role),canWorkQueue:helpdeskResponder(req.user!.role),confidentialTriage:helpdeskTriage(req.user!.role,true),attachmentsAvailable:privateStorageConfigured()});}));
router.get('/cases',handle(async(req,res)=>{
  const view=z.enum(['mine','queue']).default('mine').parse(req.query.view),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),limit=z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
  const status=req.query.status?z.enum(caseStatuses).parse(req.query.status):undefined,category=req.query.category?z.enum(caseCategories).parse(req.query.category):undefined;
  const search=req.query.q?z.string().trim().max(100).parse(req.query.q):'';
  if(view==='queue'&&!helpdeskResponder(req.user!.role))reject(403,'HR queue access is required');
  const condition=and(caseScope(req.user!),view==='mine'?eq(cases.requesterId,req.user!.userId):ne(cases.requesterId,req.user!.userId),status?eq(cases.status,status):undefined,
    category?eq(cases.category,category):undefined,search?ilike(cases.title,'%'+search.replace(/[\\%_]/g,'\\$&')+'%'):undefined,
    req.query.escalated==='true'?sql`${cases.escalatedAt} is not null and ${cases.status} not in ('resolved','closed')`:undefined,
    req.query.overdue==='true'?sql`${cases.status} not in ('resolved','closed') and ((${cases.firstResponseAt} is null and ${cases.responseDueAt} < now()) or (${cases.resolvedAt} is null and ${cases.resolutionDueAt} < now()))`:undefined);
  const items=await db.select(fields).from(cases).innerJoin(requesters,eq(cases.requesterId,requesters.id)).leftJoin(assignees,eq(cases.assigneeId,assignees.id))
    .where(condition).orderBy(desc(cases.updatedAt),desc(cases.id)).limit(limit).offset((page-1)*limit);
  const [total]=await db.select({count:sql<number>`count(*)::int`}).from(cases).where(condition);
  res.json({items,total:total.count,page,limit});
}));
router.post('/cases',upload,handle(async(req,res)=>{
  const input=newCaseInput.parse(req.body);
  const result=await withUploads(uploaded=>db.transaction(async tx=>{
    const confidential=input.confidential||input.category==='employee_relations';
    const [policy]=await tx.select().from(routing).where(and(eq(routing.category,input.category),eq(routing.confidential,confidential))).orderBy(desc(routing.version)).limit(1);
    let assigneeId:number|null=null;
    if(policy?.assigneeId&&policy.assigneeId!==req.user!.userId){
      const [candidate]=await tx.select().from(users).where(eq(users.id,policy.assigneeId)).for('share');
      if(candidate?.isActive&&candidate.approvalStatus==='approved'&&helpdeskResponder(candidate.role)&&(!confidential||helpdeskTriage(candidate.role,true)))assigneeId=candidate.id;
    }
    const [target]=await tx.select().from(targets).where(eq(targets.category,input.category)).orderBy(desc(targets.version)).limit(1);
    const now=Date.now();
    const [row]=await tx.insert(cases).values({title:input.title,category:input.category,confidential,requesterId:req.user!.userId,assigneeId,status:assigneeId?'in_progress':'open',
      targetSnapshot:target?{version:target.version,responseHours:target.responseHours,resolutionHours:target.resolutionHours}:null,
      responseDueAt:target?.responseHours?new Date(now+target.responseHours*3600000):null,resolutionDueAt:target?.resolutionHours?new Date(now+target.resolutionHours*3600000):null}).returning();
    const [message]=await tx.insert(messages).values({caseId:row.id,authorId:req.user!.userId,body:input.body}).returning();
    await saveAttachment(tx,req,row.id,message.id,uploaded);await caseEvent(tx,req.user!,row.id,'Case opened');
    if(policy)await caseEvent(tx,req.user!,row.id,`Automatic routing policy ${policy.id} v${policy.version}: ${assigneeId?'assigned to responder #'+assigneeId:policy.assigneeId?'eligible handler unavailable; retained for triage':'automatic assignment disabled'}`,true);
    return {id:row.id};
  }));res.status(201).json(result);
}));
router.get('/cases/:id',handle(async(req,res)=>{
  const id=idInput.parse(req.params.id);
  const result=await db.transaction(async tx=>{
    const row=await readCase(tx,req.user!,id),access=capabilities(req.user!,row);
    const [summary]=await tx.select(fields).from(cases).innerJoin(requesters,eq(cases.requesterId,requesters.id)).leftJoin(assignees,eq(cases.assigneeId,assignees.id)).where(eq(cases.id,id));
    const replies=await tx.select({id:messages.id,body:messages.body,internal:messages.internal,authorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,createdAt:messages.createdAt})
      .from(messages).innerJoin(users,eq(messages.authorId,users.id)).where(and(eq(messages.caseId,id),access.staff?undefined:eq(messages.internal,false))).orderBy(messages.id);
    const files=replies.length?await tx.select({id:attachments.id,messageId:attachments.messageId,filename:attachments.filename,size:attachments.size}).from(attachments).where(inArray(attachments.messageId,replies.map(m=>m.id))):[];
    const history=await tx.select({id:events.id,actorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,details:events.details,internal:events.internal,createdAt:events.createdAt})
      .from(events).innerJoin(users,eq(events.actorId,users.id)).where(and(eq(events.caseId,id),access.staff?undefined:eq(events.internal,false))).orderBy(events.id);
    return {case:summary,capabilities:access,messages:replies.map(m=>({...m,attachments:files.filter(a=>a.messageId===m.id).map(({messageId,...a})=>a)})),events:history};
  });res.json(result);
}));
router.get('/cases/:id/assignees',handle(async(req,res)=>{
  const id=idInput.parse(req.params.id),q=z.string().trim().min(2).max(80).parse(req.query.q);
  const result=await db.transaction(async tx=>{
    const row=await readCase(tx,req.user!,id);if(!capabilities(req.user!,row).assign)reject(403,'You cannot assign this case');
    return tx.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,role:users.role}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),
      inArray(users.role,['super_admin','admin','hr_director','hr','hr_manager']),ne(users.id,row.requesterId),ilike(sql`${users.firstName} || ' ' || ${users.lastName}`,'%'+q.replace(/[\\%_]/g,'\\$&')+'%'))).orderBy(users.id).limit(20);
  });res.json(result);
}));
router.post('/cases/:id/messages',upload,handle(async(req,res)=>{
  const id=idInput.parse(req.params.id),input=replyInput.parse(req.body);
  const result=await withUploads(uploaded=>db.transaction(async tx=>{
    const row=await readCase(tx,req.user!,id,true),access=capabilities(req.user!,row);checkVersion(row,input.version);
    if(!access.reply)reject(409,'Reopen this case before replying');
    if(input.internal&&!access.internal)reject(403,'Internal notes are restricted to HR case handlers');
    const [message]=await tx.insert(messages).values({caseId:id,authorId:req.user!.userId,body:input.body,internal:input.internal}).returning();
    await saveAttachment(tx,req,id,message.id,uploaded);
    const status=row.requesterId===req.user!.userId&&row.status==='waiting_employee'?(row.assigneeId?'in_progress':'open'):row.status;
    await tx.update(cases).set({version:row.version+1,updatedAt:new Date(),status,firstResponseAt:access.staff&&!input.internal&&!row.firstResponseAt?new Date():row.firstResponseAt}).where(eq(cases.id,id));
    await caseEvent(tx,req.user!,id,input.internal?'Internal note added':'Reply added',input.internal);
    if(status!==row.status)await caseEvent(tx,req.user!,id,'Employee replied; case returned to '+statusLabels[status]);
    return {id:message.id};
  }));res.status(201).json(result);
}));
router.post('/cases/:id/actions',handle(async(req,res)=>{
  const id=idInput.parse(req.params.id),input=caseActionInput.parse(req.body);
  await db.transaction(async tx=>{
    const row=await readCase(tx,req.user!,id,true),access=capabilities(req.user!,row);checkVersion(row,input.version);
    let updates:Partial<typeof cases.$inferInsert>={version:row.version+1,updatedAt:new Date()};
    if(input.action==='assign'){
      if(!access.assign)reject(403,'You cannot assign this case');
      if(row.status==='closed')reject(409,'Reopen the case before assigning a handler');
      let name='Unassigned';
      if(input.assigneeId){
        const [user]=await tx.select({id:users.id,role:users.role,firstName:users.firstName,lastName:users.lastName}).from(users).where(and(eq(users.id,input.assigneeId),eq(users.isActive,true),eq(users.approvalStatus,'approved'))).for('share');
        if(!user||!helpdeskResponder(user.role)||user.id===row.requesterId)reject(400,'Choose an active HR responder other than the requester');
        name=user.firstName+' '+user.lastName;
      }
      updates.assigneeId=input.assigneeId;if(row.status==='open'&&input.assigneeId)updates.status='in_progress';
      await caseEvent(tx,req.user!,id,'Case handler changed: '+name);
    }else if(input.action==='status'){
      if(!access.statuses.includes(input.status))reject(409,'This status change is not available to you');
      updates.status=input.status;
      updates.resolvedAt=input.status==='resolved'||input.status==='closed'?(row.resolvedAt||new Date()):null;
      if(row.escalatedAt&&(input.status==='resolved'||input.status==='closed')){
        updates.escalatedAt=null;await caseEvent(tx,req.user!,id,'Escalation completed with case resolution');
      }
      await caseEvent(tx,req.user!,id,`Status changed to ${statusLabels[input.status]}: ${input.reason}`);
    }else if(input.action==='escalate'){
      if(!access.escalate)reject(409,'This case cannot be escalated; review its current status');
      updates.escalatedAt=new Date();await caseEvent(tx,req.user!,id,'Escalated for HR review: '+input.reason);
    }else if(input.action==='clear_escalation'){
      if(!access.clearEscalation)reject(403,'An authorized HR triage reviewer must clear this escalation');
      updates.escalatedAt=null;await caseEvent(tx,req.user!,id,'Escalation cleared after HR review: '+input.reason);
    }else{
      if(!access.restrict)reject(403,'This case cannot be restricted by you');
      updates.confidential=true;await caseEvent(tx,req.user!,id,'Case marked confidential');
    }
    await tx.update(cases).set(updates).where(eq(cases.id,id));
  });res.json({success:true});
}));
router.get('/attachments/:id/download',handle(async(req,res)=>{
  const id=idInput.parse(req.params.id);
  const key=await db.transaction(async tx=>{
    const [file]=await tx.select({key:attachments.objectKey,caseId:messages.caseId,internal:messages.internal}).from(attachments).innerJoin(messages,eq(attachments.messageId,messages.id))
      .innerJoin(cases,eq(messages.caseId,cases.id)).where(and(eq(attachments.id,id),caseScope(req.user!)));
    if(!file) return reject(404,'Attachment not found');
    const row=await readCase(tx,req.user!,file.caseId);
    if(file.internal&&!capabilities(req.user!,row).staff)reject(404,'Attachment not found');return file.key;
  });res.redirect(await caseAttachmentUrl(key));
}));
export default router;
