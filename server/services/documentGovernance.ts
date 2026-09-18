import type {Request} from 'express';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {employees,users} from '@shared/schema';
import {getAccessScope,hasPermission} from '@shared/permissions';
import {employeeScope} from './access';
import {recordHistory,qatarToday} from './workplaceRecords';

export class DocumentError extends Error {constructor(public status:number,message:string){super(message);}}
export const documentPolicySchema=z.object({replacementMode:z.enum(['optional','self_service','all']),
 documentTypes:z.array(z.string().trim().min(1).max(100).transform(s=>s.toLowerCase())).max(50).refine(a=>new Set(a).size===a.length,'Remove duplicate document types'),
 requireAssignedReviewer:z.boolean(),reviewDays:z.number().int().min(1).max(365)}).strict();
export type DocumentPolicy=z.infer<typeof documentPolicySchema>&{version:number};
export const defaultDocumentPolicy:DocumentPolicy={version:0,replacementMode:'optional',documentTypes:[],requireAssignedReviewer:false,reviewDays:7};
export async function documentPolicy(tx:any,lock=false):Promise<DocumentPolicy>{
 // Serialize policy changes with submission and replacement, including the default before the first policy exists.
 if(lock)await tx.execute(sql`LOCK TABLE document_review_policies IN SHARE MODE`);
 const r=await tx.execute(sql`SELECT version,replacement_mode AS "replacementMode",document_types AS "documentTypes",require_assigned_reviewer AS "requireAssignedReviewer",review_days AS "reviewDays" FROM document_review_policies ORDER BY version DESC LIMIT 1`);
 return r.rows[0] as DocumentPolicy??defaultDocumentPolicy;
}
export function needsDocumentApproval(policy:DocumentPolicy,user:NonNullable<Request['user']>,type:string){
 const applicable=!policy.documentTypes.length||policy.documentTypes.includes(type.trim().toLowerCase());
 return applicable&&(policy.replacementMode==='all'||(policy.replacementMode==='self_service'&&getAccessScope(user.role,'compliance_documents')==='self'));
}
export const documentReviewerScope=(req:Request)=>getAccessScope(req.user!.role,'compliance_documents')==='self'?sql`false`:employeeScope(req.user!,'compliance_documents','update');
export const canAssignDocuments=(req:Request)=>hasPermission(req.user!.role,'compliance_documents','update')&&!['self','none'].includes(getAccessScope(req.user!.role,'compliance_documents'));
export async function eligibleDocumentReviewer(tx:any,userId:number,employeeId:number,requesterId:number){
 const [u]=await tx.select({id:users.id,username:users.username,role:users.role,department:users.department,isActive:users.isActive,approvalStatus:users.approvalStatus}).from(users).where(eq(users.id,userId));
 if(!u||!u.isActive||u.approvalStatus!=='approved'||u.id===requesterId||getAccessScope(u.role,'compliance_documents')==='self')return false;
 const [e]=await tx.select({userId:employees.userId}).from(employees).where(and(eq(employees.id,employeeId),employeeScope({userId:u.id,username:u.username,role:u.role,department:u.department},'compliance_documents','update')));
 return !!e&&e.userId!==u.id;
}
export async function renewalHistory(tx:any,req:Request,row:any,action:string,reason:string){
 // Keep file keys and document contents out of the general history and activity feed.
 await recordHistory(tx,req,'document_renewal',{id:row.id,version:row.version,documentId:row.documentId,status:row.status,assignedReviewerId:row.assignedReviewerId,requestedBy:row.requestedBy,reviewedBy:row.reviewedBy,reviewDueDate:row.reviewDueDate,policySnapshot:row.policySnapshot,action},reason);
}
export const reviewDueDate=(days:number)=>new Date(Date.parse(qatarToday())+days*86400000).toISOString().slice(0,10);

export function documentExpiryStatus(expiry:string,days:number){const today=qatarToday(),soon=new Date(Date.parse(today)+days*86400000).toISOString().slice(0,10);return expiry<today?'expired':expiry<=soon?'expiring_soon':'valid';}
