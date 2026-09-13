import {and,eq,or,sql} from 'drizzle-orm';
import {db} from '../db';
import {helpdeskCases as cases,helpdeskEvents as events} from '@shared/schema';
import {helpdeskResponder,helpdeskTriage,type CaseCapabilities,type CaseStatus} from '@shared/helpdesk';
import type {TokenPayload} from './auth';

export type HelpdeskTransaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
export class HelpdeskError extends Error {constructor(public status:number,message:string){super(message);}}
export function reject(status:number,message:string):never{throw new HelpdeskError(status,message);}
export function caseScope(user:TokenPayload){
  return or(eq(cases.requesterId,user.userId),helpdeskResponder(user.role)?eq(cases.assigneeId,user.userId):sql`false`,
    helpdeskTriage(user.role,true)?sql`true`:helpdeskTriage(user.role,false)?eq(cases.confidential,false):sql`false`)!;
}
export function capabilities(user:TokenPayload,row:typeof cases.$inferSelect):CaseCapabilities{
  const requester=row.requesterId===user.userId;
  const triage=!requester&&helpdeskTriage(user.role,row.confidential);
  const staff=!requester&&(triage||(row.assigneeId===user.userId&&helpdeskResponder(user.role)));
  const reopen:CaseStatus=row.assigneeId?'in_progress':'open';
  const transitions:Record<CaseStatus,CaseStatus[]>={open:['in_progress','waiting_employee','resolved'],in_progress:['waiting_employee','resolved'],waiting_employee:['in_progress','resolved'],resolved:[reopen,'closed'],closed:[reopen]};
  return {staff,assign:triage,restrict:!row.confidential&&(requester||triage),reply:row.status!=='closed'&&row.status!=='resolved',
    internal:staff&&row.status!=='closed'&&row.status!=='resolved',statuses:staff?transitions[row.status]:requester?(row.status==='resolved'?[reopen,'closed']:row.status==='closed'?[reopen]:[]):[]};
}
export async function readCase(tx:HelpdeskTransaction,user:TokenPayload,id:number,lock=false){
  const query=tx.select().from(cases).where(and(eq(cases.id,id),caseScope(user)));
  const [row]=lock?await query.for('update'):await query;
  if(!row)return reject(404,'Case not found');return row;
}
export function checkVersion(row:typeof cases.$inferSelect,version:number){
  if(row.version!==version)reject(409,'This case has changed. Review the latest details and try again.');
}
export async function caseEvent(tx:HelpdeskTransaction,user:TokenPayload,caseId:number,details:string,internal=false){
  await tx.insert(events).values({caseId,actorId:user.userId,details,internal});
}
