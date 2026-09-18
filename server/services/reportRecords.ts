import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {activityLogs} from '@shared/schema';
import {hasPermission,getAccessScope} from '@shared/permissions';
import {WorkforceError as OnboardingError} from './workforce';
export const recordId=z.number().int().positive();
export const decisionReason=z.string().trim().min(5).max(2000);
export const shortText=z.string().trim().min(2).max(200);
export const isAdmin=(req:any)=>['admin','super_admin'].includes(req.user.role);
export const managesRecords=(req:any)=>hasPermission(req.user.role,'employee_database','update')&&getAccessScope(req.user.role,'employee_database')==='all';
export function requireManager(req:any){if(!managesRecords(req))throw new OnboardingError(403,'Organization-wide HR management access required');}
export function requireAdmin(req:any){if(!isAdmin(req))throw new OnboardingError(403,'Administrator access required');}
export function recordHandler(fn:(req:any,res:any)=>Promise<any>){return async(req:any,res:any)=>{try{await fn(req,res);}catch(e:any){res.status(e instanceof OnboardingError?e.status:e instanceof z.ZodError?400:(e.code||e.cause?.code)==='23505'?409:500).json({message:e instanceof OnboardingError?e.message:e instanceof z.ZodError?e.issues.map((i:any)=>i.message).join('; '):(e.code||e.cause?.code)==='23505'?'This record already exists or is already assigned':'Unable to save record; reload and retry'});}};}
export async function recordHistory(tx:any,req:any,kind:string,row:any,reason:string){
 await tx.execute(sql`INSERT INTO report_correction_history(kind,record_id,version,snapshot,actor_id,reason) VALUES (${kind},${row.id},${row.version},${JSON.stringify(row)}::jsonb,${req.user.userId},${reason})`);
 await tx.insert(activityLogs).values({userId:req.user.userId,action:'update',entityType:kind,entityId:row.id,details:'Recorded version '+row.version});
}
export const qatarToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
