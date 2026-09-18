import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {activityLogs} from '@shared/schema';
export class WorkflowError extends Error { constructor(public status:number,message:string){super(message);} }
export const isAdmin=(req:any)=>['admin','super_admin'].includes(req.user.role);
export function requireAdmin(req:any){if(!isAdmin(req))throw new WorkflowError(403,'Administrator access required');}
export function recordHandler(fn:(req:any,res:any)=>Promise<any>){return async(req:any,res:any)=>{try{await fn(req,res);}catch(e:any){res.status(e instanceof WorkflowError?e.status:e instanceof z.ZodError?400:(e.code||e.cause?.code)==='23505'?409:500).json({message:e instanceof WorkflowError?e.message:e instanceof z.ZodError?e.issues.map((i:any)=>i.message).join('; '):(e.code||e.cause?.code)==='23505'?'This record already exists or is already assigned':'Unable to save record; reload and retry'});}};}
export async function recordHistory(tx:any,req:any,kind:string,row:any,reason:string){
 await tx.execute(sql`INSERT INTO hr_workflow_history(kind,record_id,version,snapshot,actor_id,reason) VALUES (${kind},${row.id},${row.version},${JSON.stringify(row)}::jsonb,${req.user.userId},${reason})`);
 await tx.insert(activityLogs).values({userId:req.user.userId,action:'update',entityType:kind,entityId:row.id,details:'Recorded version '+row.version});
}
export const qatarToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
