import {and,desc,eq,lte} from 'drizzle-orm';
import {workforceRenewalPolicies as policies} from '@shared/schema';
import {defaultRenewalPolicy,renewalPolicy} from '@shared/workforce-renewals';
import type {WorkforceTransaction} from './workforce';

export function policyFor(rows:typeof policies.$inferSelect[],qualificationId:number,employeeId:number){
  const relevant=rows.filter(r=>r.qualificationId===qualificationId);
  const row=relevant.find(r=>r.employeeId===employeeId)||relevant.find(r=>r.employeeId===null);
  return {id:row?.id||null,config:renewalPolicy.parse(row?.config||defaultRenewalPolicy)};
}
export async function effectiveRenewalPolicies(tx:WorkforceTransaction,qualificationId?:number){
  return tx.select().from(policies).where(and(lte(policies.effectiveAt,new Date()),qualificationId?eq(policies.qualificationId,qualificationId):undefined)).orderBy(desc(policies.effectiveAt),desc(policies.id));
}
export function nextDate(date:string){return date==='9999-12-31'?date:new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
