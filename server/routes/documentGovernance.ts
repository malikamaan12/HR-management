import {Router} from 'express';
import {and,asc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {documents,employees} from '@shared/schema';
import {hasPermission} from '@shared/permissions';
import {db} from '../db';
import {employeeScope} from '../services/access';
import {documentPolicy,documentPolicySchema} from '../services/documentGovernance';
import {isAdmin,requireAdmin,recordHandler as handle,recordHistory,qatarToday} from '../services/workflowRecords';
import {WorkflowError} from '../services/workflowRecords';
import {getCompanySettings} from '../services/settings';
import {documentIsArchived} from '../services/retention';
const router=Router();
const read=(req:any)=>{if(!hasPermission(req.user.role,'compliance_documents','read'))throw new WorkflowError(403,'Document access required');};
router.get('/review-policy',handle(async(req,res)=>{read(req);res.json({...await documentPolicy(db),canEdit:isAdmin(req)});}));
router.post('/review-policy',handle(async(req,res)=>{
 requireAdmin(req);
 const input=documentPolicySchema.extend({version:z.number().int().min(0),reason:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE document_review_policies IN SHARE ROW EXCLUSIVE MODE`);
  const old=await documentPolicy(tx);if(old.version!==input.version)throw new WorkflowError(409,'Policy changed; reload before saving');
  const r=await tx.execute(sql`INSERT INTO document_review_policies(version,replacement_mode,document_types,require_assigned_reviewer,review_days,created_by) VALUES (${old.version+1},${input.replacementMode},${JSON.stringify(input.documentTypes)}::jsonb,${input.requireAssignedReviewer},${input.reviewDays},${req.user.userId}) RETURNING *`);
  await recordHistory(tx,req,'document_review_policy',r.rows[0],input.reason);return documentPolicy(tx);
 });res.status(201).json(result);
}));
router.get('/review-policy/history',handle(async(req,res)=>{
 requireAdmin(req);const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const r=await db.execute(sql`SELECT version,actor_id,reason,created_at,snapshot FROM hr_workflow_history WHERE kind='document_review_policy' ORDER BY version DESC LIMIT 21 OFFSET ${(page-1)*20}`);
 res.json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});
}));
router.get('/register',handle(async(req,res)=>{
 read(req);
 const input=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),q:z.string().trim().max(100).default(''),type:z.string().trim().max(100).default(''),status:z.enum(['all','valid','expired','expiring_soon','archived']).default('all')}).strict().parse(req.query);
 const settings=await getCompanySettings(),today=qatarToday(),soon=new Date(Date.parse(today)+settings.documentExpiryDays*86400000).toISOString().slice(0,10);
 const state=sql<string>`CASE WHEN ${documentIsArchived} THEN 'archived' WHEN ${documents.expiryDate}<${today}::date THEN 'expired' WHEN ${documents.expiryDate}<=${soon}::date THEN 'expiring_soon' ELSE 'valid' END`;
 const filters=and(employeeScope(req.user,'compliance_documents'),input.q?sql`strpos(lower(${employees.firstName}||' '||${employees.lastName}||' '||${documents.documentNumber}||' '||${documents.documentType}),lower(${input.q}))>0`:undefined,input.type?sql`lower(${documents.documentType})=lower(${input.type})`:undefined);
 const result=await db.transaction(async tx=>{
 const [counts]=await tx.select({all:sql<number>`count(*)::int`,valid:sql<number>`count(*) FILTER (WHERE ${state}='valid')::int`,expired:sql<number>`count(*) FILTER (WHERE ${state}='expired')::int`,expiring_soon:sql<number>`count(*) FILTER (WHERE ${state}='expiring_soon')::int`,archived:sql<number>`count(*) FILTER (WHERE ${state}='archived')::int`}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id)).where(filters);
 const rows=await tx.select({document:documents,status:state,employeeName:sql<string>`${employees.firstName}||' '||${employees.lastName}`}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id)).where(and(filters,input.status==='all'?undefined:sql`${state}=${input.status}`)).orderBy(asc(documents.expiryDate),asc(documents.id)).limit(25).offset((input.page-1)*25);
 return {counts,rows};
 },{isolationLevel:'repeatable read',accessMode:'read only'});
 const {counts,rows}=result,total=counts[input.status];
 res.json({items:rows.map(({document,...rest})=>({...document,...rest})),counts,total,page:input.page,pageSize:25,hasMore:input.page*25<total,expiryDays:settings.documentExpiryDays,asOf:today,canUpload:hasPermission(req.user.role,'compliance_documents','create')});
}));
export default router;
