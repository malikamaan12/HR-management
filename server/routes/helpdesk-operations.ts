import { requireCategory } from '../services/helpdesk-workspace';
import { categoryIdInput } from '@shared/helpdesk-workspace';
import { Router } from 'express';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { helpdeskPolicies as policies, helpdeskArticles as articles, helpdeskArticleHistory as revisions, helpdeskCases as cases, employees, users } from '@shared/schema';
import { helpdeskResponder, helpdeskTriage, idInput } from '@shared/helpdesk';
import { helpdeskPolicyAdmin, helpdeskPolicyInput, articleInput, articleRevisionInput } from '@shared/helpdesk-operations';
import { capabilities, readCase, checkVersion, caseEvent, reject, HelpdeskError } from '../services/helpdesk';
import { requireHandler, validHandler } from '../services/helpdesk-operations';
import type { Request,Response } from 'express';
const router=Router();
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{await fn(req,res);}catch(e){res.status(e instanceof HelpdeskError?e.status:e instanceof z.ZodError?400:500).json({message:e instanceof HelpdeskError?e.message:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):'Unable to complete helpdesk action'});}};
function admin(req:Request,confidential=false){if(!helpdeskPolicyAdmin(req.user!.role)||confidential&&!helpdeskTriage(req.user!.role,true))reject(403,'Helpdesk policy administration access is required');}
const articleScope=(req:Request)=>helpdeskPolicyAdmin(req.user!.role)?sql`true`:and(eq(articles.status,'published'),helpdeskResponder(req.user!.role)?undefined:eq(articles.audience,'all'))!;
router.get('/policies/directory',handle(async(req,res)=>{
  admin(req);const q=z.string().trim().max(100).parse(req.query.q||''),term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  res.json({employees:await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,employeeId:employees.employeeId}).from(employees).where(and(eq(employees.status,'active'),or(ilike(employees.firstName,term),ilike(employees.lastName,term),ilike(employees.employeeId,term)))).orderBy(employees.id).limit(50),
    handlers:await db.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,role:users.role}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),sql`${users.role} in ('super_admin','admin','hr_director','hr','hr_manager')`)).orderBy(users.id)});
}));
router.get('/policies',handle(async(req,res)=>{
  admin(req);const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),condition=helpdeskTriage(req.user!.role,true)?undefined:eq(policies.confidential,false);
  const items=await db.select({policy:policies,employeeName:sql<string|null>`${employees.firstName} || ' ' || ${employees.lastName}`}).from(policies).leftJoin(employees,eq(policies.employeeId,employees.id)).where(condition).orderBy(desc(policies.id)).limit(25).offset((page-1)*25);
  const [total]=await db.select({count:sql<number>`count(*)::int`}).from(policies).where(condition);res.json({items,total:total.count,page});
}));
router.post('/policies',handle(async(req,res)=>{
  const input=helpdeskPolicyInput.parse(req.body);admin(req,input.confidential);
  const result=await db.transaction(async tx=>{
    const category=await requireCategory(tx,input.category,true);
    if(category.confidential&&!input.confidential)reject(400,'This category requires confidential routing');
    if(input.employeeId){const [employee]=await tx.select({id:employees.id}).from(employees).where(eq(employees.id,input.employeeId));if(!employee)reject(400,'Employee not found');}
    await requireHandler(tx,input.defaultAssigneeId,input.confidential);await requireHandler(tx,input.escalationAssigneeId,input.confidential);
    const [row]=await tx.insert(policies).values({...input,effectiveAt:new Date(input.effectiveAt),createdBy:req.user!.userId}).returning();return row;
  });res.status(201).json(result);
}));
router.post('/cases/:id/escalate',handle(async(req,res)=>{
  const input=z.object({version:idInput,reason:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
  await db.transaction(async tx=>{
    const row=await readCase(tx,req.user!,idInput.parse(req.params.id),true);checkVersion(row,input.version);
    if(!capabilities(req.user!,row).staff)reject(403,'Only case handlers can escalate a case');
    if(['resolved','closed'].includes(row.status))reject(409,'Reopen the case before escalating');
    if(row.escalatedAt)reject(409,'This case is already escalated; use handler assignment for further changes');
    const target=await validHandler(tx,row.policySnapshot?.escalationAssigneeId||null,row.confidential,row.requesterId);
    if(!target)reject(409,'No eligible escalation handler is configured for this case. Ask a triager to assign a handler.');
    await tx.update(cases).set({assigneeId:target.id,escalatedAt:new Date(),status:row.status==='open'?'in_progress':row.status,version:row.version+1,updatedAt:new Date()}).where(eq(cases.id,row.id));
    await caseEvent(tx,req.user!,row.id,'Case escalated: '+input.reason);
  });res.json({success:true});
}));
router.get('/articles',handle(async(req,res)=>{
  const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),q=z.string().trim().max(100).parse(req.query.q||'');
  const category=req.query.category?categoryIdInput.parse(req.query.category):null,term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const condition=and(articleScope(req),category?eq(articles.category,category):undefined,q?or(ilike(articles.title,term),ilike(articles.body,term)):undefined);
  const items=await db.select({id:articles.id,title:articles.title,category:articles.category,audience:articles.audience,status:articles.status,version:articles.version,updatedAt:articles.updatedAt}).from(articles).where(condition).orderBy(desc(articles.updatedAt),desc(articles.id)).limit(20).offset((page-1)*20);
  const [total]=await db.select({count:sql<number>`count(*)::int`}).from(articles).where(condition);res.json({items,total:total.count,page});
}));
router.get('/articles/:id',handle(async(req,res)=>{
  const [row]=await db.select().from(articles).where(and(eq(articles.id,idInput.parse(req.params.id)),articleScope(req)));if(!row)reject(404,'Article not found');
  const history=helpdeskPolicyAdmin(req.user!.role)?await db.select().from(revisions).where(eq(revisions.articleId,row.id)).orderBy(desc(revisions.version)).limit(100):[];
  res.json({article:row,history});
}));
router.post('/articles',handle(async(req,res)=>{
  admin(req);const input=articleInput.parse(req.body);
  const row=await db.transaction(async tx=>{await requireCategory(tx,input.category);const [saved]=await tx.insert(articles).values({...input,createdBy:req.user!.userId,publishedAt:input.status==='published'?new Date():null}).returning();
    await tx.insert(revisions).values({articleId:saved.id,version:saved.version,actorId:req.user!.userId,reason:'Article created',snapshot:saved});return saved;});res.status(201).json(row);
}));
router.patch('/articles/:id',handle(async(req,res)=>{
  admin(req);const input=articleRevisionInput.parse(req.body);
  await db.transaction(async tx=>{
    const [row]=await tx.select().from(articles).where(eq(articles.id,idInput.parse(req.params.id))).for('update');if(!row)reject(404,'Article not found');if(row.version!==input.version)reject(409,'This article has changed. Refresh before saving.');
    await requireCategory(tx,input.category,input.category===row.category);
    const {version,reason,...content}=input;
    const [saved]=await tx.update(articles).set({...content,version:version+1,updatedAt:new Date(),publishedAt:input.status==='published'?new Date():row.publishedAt}).where(eq(articles.id,row.id)).returning();
    await tx.insert(revisions).values({articleId:saved.id,version:saved.version,actorId:req.user!.userId,reason,snapshot:saved});
  });res.json({success:true});
}));
export default router;
