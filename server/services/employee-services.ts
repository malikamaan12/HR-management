import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { employees, users, servicePolicies, serviceRequests, learningEnrollments, serviceFiles } from '@shared/schema';
import { serviceModule, eligibilityRule, type ServiceKind, type WorkflowEvent } from '@shared/employee-services';
import { hasPermission, type HRModule } from '@shared/permissions';
import { employeeScope } from './access';
import { scopedEmployee, businessToday } from './hr-rules';
import { fail, type WorkforceTransaction } from './workforce';
import type { TokenPayload } from './auth';
import { moneyCents, moneyText } from '@shared/money';
export function versionCheck(actual:number,expected:number){if(actual!==expected)fail(409,'This record changed. Refresh before continuing');}
export function event(history:WorkflowEvent[],user:TokenPayload,action:string,reason:string,version:number,snapshot?:unknown):WorkflowEvent[]{return [...history,{action,reason,version,actorId:user.userId,at:new Date().toISOString(),snapshot}];}
export function employed(e:typeof employees.$inferSelect,date=businessToday()){
  if(e.status!=='active'||date<e.joiningDate||(e.contractEndDate&&date>e.contractEndDate)||(e.terminationDate&&date>=e.terminationDate))fail(409,'This request must fall within active employment');
}
export async function approver(tx:WorkforceTransaction,id:number,module:HRModule,employee?:typeof employees.$inferSelect){
  const [user]=await tx.select().from(users).where(eq(users.id,id));
  if(!user||!user.isActive||user.approvalStatus!=='approved'||!hasPermission(user.role,module,'approve'))fail(400,'Select an active approver with approval access');
  if(employee){const [visible]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,employee.id),employeeScope({userId:user.id,role:user.role,department:user.department||undefined} as TokenPayload,module,'approve')));if(!visible||employee.userId===id)fail(400,'The approver must independently cover this employee');}
  return user;
}
export function requireWriter(user:TokenPayload,e:typeof employees.$inferSelect,module:HRModule){if(e.userId!==user.userId&&!hasPermission(user.role,module,'create'))fail(403,'You cannot submit on behalf of this employee');}
export async function effectivePolicy(tx:WorkforceTransaction,kind:ServiceKind,key:string,employeeId:number,date:string){
  const [row]=await tx.select().from(servicePolicies).where(and(eq(servicePolicies.kind,kind),eq(servicePolicies.key,key),lte(servicePolicies.effectiveFrom,date),or(eq(servicePolicies.employeeId,employeeId),isNull(servicePolicies.employeeId)))).orderBy(sql`${servicePolicies.employeeId} IS NOT NULL DESC`,desc(servicePolicies.effectiveFrom),desc(servicePolicies.id)).limit(1);
  return row;
}
export function eligible(e:typeof employees.$inferSelect,date:string,config:ReturnType<typeof eligibilityRule.parse>){
  employed(e,date);
  if(!config.enabled||!config.employeeTypes.includes(e.type)||config.departments.length&&!config.departments.includes(e.department)||Date.parse(date)-Date.parse(e.joiningDate)<config.minServiceDays*86400000)fail(409,'The employee is not eligible under this effective policy');
}
export async function reservedAmount(tx:WorkforceTransaction,e:number,kind:ServiceKind,key:string,date:string,unit:string,exclude?:number){
  const year=date.slice(0,4);const rows=await tx.select({amount:serviceRequests.amount,snapshot:serviceRequests.policySnapshot}).from(serviceRequests).where(and(eq(serviceRequests.employeeId,e),eq(serviceRequests.kind,kind),eq(serviceRequests.policyKey,key),gte(serviceRequests.requestDate,year+'-01-01'),lte(serviceRequests.requestDate,year+'-12-31'),inArray(serviceRequests.status,['submitted','approved','fulfilled']),exclude?ne(serviceRequests.id,exclude):undefined));
  if(rows.some(r=>r.snapshot?.config.unit!==unit))fail(409,'This program has a different unit or currency in the same year. Use a separate program code');
  return rows.reduce((n,r)=>n+moneyCents(r.amount),0);
}
export async function requestRecord(tx:WorkforceTransaction,user:TokenPayload,id:number,kind:ServiceKind,lock=false){
  const module=serviceModule(kind);const [initial]=await tx.select({employeeId:serviceRequests.employeeId}).from(serviceRequests).where(and(eq(serviceRequests.id,id),eq(serviceRequests.kind,kind)));
  if(!initial)fail(404,'Request not found');
  const employee=await scopedEmployee(tx,user,initial.employeeId,module,'read',lock);
  const query=tx.select().from(serviceRequests).where(eq(serviceRequests.id,id));const [row]=lock?await query.for('update'):await query;return {row,employee};
}
export async function enrollmentRecord(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false){
  const [initial]=await tx.select({employeeId:learningEnrollments.employeeId}).from(learningEnrollments).where(eq(learningEnrollments.id,id));if(!initial)fail(404,'Enrollment not found');
  const employee=await scopedEmployee(tx,user,initial.employeeId,'training_development','read',lock);
  const query=tx.select().from(learningEnrollments).where(eq(learningEnrollments.id,id));const [row]=lock?await query.for('update'):await query;return {row,employee};
}
export async function fileMetadata(tx:WorkforceTransaction,kind:'learning'|ServiceKind,id:number){return tx.select({id:serviceFiles.id,filename:serviceFiles.filename,size:serviceFiles.size,createdAt:serviceFiles.createdAt}).from(serviceFiles).where(kind==='learning'?eq(serviceFiles.enrollmentId,id):eq(serviceFiles.requestId,id));}
export async function directory(tx:WorkforceTransaction,user:TokenPayload,module:HRModule,q:string){
  const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';return tx.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,code:employees.employeeId,own:sql<boolean>`${employees.userId} = ${user.userId}`}).from(employees).where(and(employeeScope(user,module),or(ilike(employees.firstName,term),ilike(employees.lastName,term),ilike(employees.employeeId,term)))).orderBy(employees.id).limit(50);
}
export function normalizedAmount(kind:ServiceKind,input:{quantity?:string;items?:{description:string;amount:string}[]}){if(kind==='benefit'){if(!input.quantity||input.items)fail(400,'Enter benefit units only');return {amount:moneyText(moneyCents(input.quantity)),items:[]};}if(!input.items?.length||input.quantity)fail(400,'Enter itemized expenses only');const cents=input.items.reduce((n,i)=>n+moneyCents(i.amount),0);if(cents>9999999999)fail(400,'Claim total is too large');return {amount:moneyText(cents),items:input.items.map(i=>({...i,amount:moneyText(moneyCents(i.amount))}))};}
