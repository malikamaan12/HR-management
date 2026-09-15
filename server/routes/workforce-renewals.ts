import {Router} from 'express';
import {and,desc,eq,inArray,isNull,lte,ne,or,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {employees,workforceQualifications as qualifications,employeeQualifications as credentials,workforceRenewalPolicies as policies,workforceRenewals as renewals,workforceRenewalHistory as history} from '@shared/schema';
import {positiveId,workforceAdmin,localDate} from '@shared/workforce';
import {renewalPolicyInput,renewalCreate,renewalResubmit,renewalDecision,defaultRenewalPolicy,type RenewalDue} from '@shared/workforce-renewals';
import {fail,audit,requireWorkforceAdmin,type WorkforceTransaction} from '../services/workforce';
import {effectiveRenewalPolicies,policyFor,nextDate} from '../services/workforce-renewals';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';
const router=Router();
const employeeName=sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`;
async function employeeAccess(tx:WorkforceTransaction,user:TokenPayload,id:number){
  const [employee]=await tx.select().from(employees).where(and(eq(employees.id,id),workforceAdmin(user.role)?undefined:eq(employees.userId,user.userId))).for('update');
  return employee||fail(404,'Employee not found or outside your access');
}
async function renewalAccess(tx:WorkforceTransaction,user:TokenPayload,id:number){
  const [initial]=await tx.select().from(renewals).where(eq(renewals.id,id));if(!initial)fail(404,'Renewal not found');
  const employee=await employeeAccess(tx,user,initial.employeeId);
  const [row]=await tx.select().from(renewals).where(eq(renewals.id,id)).for('update');return {row,employee};
}
async function recordHistory(tx:WorkforceTransaction,user:TokenPayload,row:typeof renewals.$inferSelect,action:string,reason:string){
  await tx.insert(history).values({renewalId:row.id,version:row.version,actorId:user.userId,action,reason,snapshot:row});
  await audit(tx,user,'renewal',row.id,'Qualification renewal '+action);
}
router.get('/renewal-policies',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);
  res.json({defaults:defaultRenewalPolicy,history:await db.select({id:policies.id,qualificationId:policies.qualificationId,qualificationName:qualifications.name,employeeId:policies.employeeId,employeeName,effectiveAt:policies.effectiveAt,config:policies.config,reason:policies.reason})
    .from(policies).innerJoin(qualifications,eq(policies.qualificationId,qualifications.id)).leftJoin(employees,eq(policies.employeeId,employees.id)).orderBy(desc(policies.effectiveAt),desc(policies.id)).limit(500)});
}));
router.post('/renewal-policies',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const input=renewalPolicyInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const [kind]=await tx.select().from(qualifications).where(eq(qualifications.id,input.qualificationId));if(!kind)fail(400,'Choose an existing qualification');
    if(input.employeeId){const employee=await employeeAccess(tx,req.user!,input.employeeId);if(employee.status!=='active')fail(400,'Choose an active employee');}
    const effectiveAt=input.effectiveAt||new Date();if(input.effectiveAt&&effectiveAt<new Date())fail(400,'Rules must take effect now or in the future');
    const [row]=await tx.insert(policies).values({...input,effectiveAt,createdBy:req.user!.userId}).returning();await audit(tx,req.user!,'renewal_policy',row.id,'Qualification reminder rules saved');return {id:row.id};
  }));
}));
router.get('/renewals/due',handle(async(req,res)=>{
  const page=req.query.page?positiveId.parse(req.query.page):1;
  res.json(await db.transaction(async tx=>{
    const rows=await tx.select({id:credentials.id,employeeId:employees.id,employeeName,qualificationId:qualifications.id,qualificationName:qualifications.name,validFrom:credentials.validFrom,validThrough:credentials.validThrough,renewsCredentialId:credentials.renewsCredentialId})
      .from(credentials).innerJoin(employees,eq(credentials.employeeId,employees.id)).innerJoin(qualifications,eq(credentials.qualificationId,qualifications.id))
      .where(and(isNull(credentials.revokedAt),eq(employees.status,'active'),workforceAdmin(req.user!.role)?undefined:eq(employees.userId,req.user!.userId))).orderBy(credentials.validThrough,credentials.id);
    const rules=await effectiveRenewalPolicies(tx);
    const pending=await tx.select({id:renewals.id,previousCredentialId:renewals.previousCredentialId,status:renewals.status}).from(renewals).innerJoin(employees,eq(renewals.employeeId,employees.id)).where(and(eq(employees.status,'active'),workforceAdmin(req.user!.role)?undefined:eq(employees.userId,req.user!.userId),inArray(renewals.status,['submitted','returned'])));
    const pendingBySource=new Map(pending.map(r=>[r.previousCredentialId,r])),renewedBySource=new Map(rows.filter(r=>r.renewsCredentialId).map(r=>[r.renewsCredentialId,r]));
    const groups=new Map<string,typeof rows>(),policyCache=new Map<string,ReturnType<typeof policyFor>>();
    for(const row of rows){const key=row.employeeId+':'+row.qualificationId;const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
    const due:RenewalDue[]=[];
    for(const row of rows){
      if(!row.validThrough)continue;
      const key=row.employeeId+':'+row.qualificationId;if(!policyCache.has(key))policyCache.set(key,policyFor(rules,row.qualificationId,row.employeeId));
      const {config}=policyCache.get(key)!,today=localDate(new Date(),config.timezone),boundary=nextDate(row.validThrough)>today?nextDate(row.validThrough):today;
      // Suppress a superseded expiry only when later verified coverage is contiguous or has already started.
      if(groups.get(key)!.some(other=>other.id!==row.id&&other.validFrom<=boundary&&(!other.validThrough||other.validThrough>row.validThrough!)))continue;
      const daysLeft=Math.round((Date.parse(row.validThrough)-Date.parse(today))/86400000);if(daysLeft>config.reminderDays)continue;
      const request=pendingBySource.get(row.id),renewed=renewedBySource.get(row.id);
      due.push({credentialId:row.id,employeeId:row.employeeId,employeeName:row.employeeName,qualificationId:row.qualificationId,qualificationName:row.qualificationName,validThrough:row.validThrough,daysLeft,reminderDays:config.reminderDays,timezone:config.timezone,requestId:request?.id||null,requestStatus:request?.status||null,renewedFrom:renewed?.validFrom||null});
    }
    due.sort((a,b)=>a.daysLeft-b.daysLeft||a.credentialId-b.credentialId);return {total:due.length,rows:due.slice((page-1)*25,page*25),hasMore:due.length>page*25};
  }));
}));
router.get('/renewals',handle(async(req,res)=>{
  const page=req.query.page?positiveId.parse(req.query.page):1,status=z.enum(['all','submitted','returned','verified','cancelled']).parse(req.query.status||'submitted');
  const rows=await db.select({id:renewals.id,employeeId:employees.id,employeeName,qualificationName:qualifications.name,previousCredentialId:credentials.id,previousValidFrom:credentials.validFrom,previousValidThrough:credentials.validThrough,
    status:renewals.status,version:renewals.version,reference:renewals.reference,note:renewals.note,reviewNote:renewals.reviewNote,newCredentialId:renewals.newCredentialId,createdAt:renewals.createdAt,
    canReview:sql<boolean>`${workforceAdmin(req.user!.role)} and ${renewals.submittedBy} <> ${req.user!.userId} and (${employees.userId} is null or ${employees.userId} <> ${req.user!.userId})`})
    .from(renewals).innerJoin(employees,eq(renewals.employeeId,employees.id)).innerJoin(credentials,eq(renewals.previousCredentialId,credentials.id)).innerJoin(qualifications,eq(credentials.qualificationId,qualifications.id))
    .where(and(workforceAdmin(req.user!.role)?undefined:eq(employees.userId,req.user!.userId),status==='all'?undefined:eq(renewals.status,status))).orderBy(desc(renewals.id)).limit(26).offset((page-1)*25);
  res.json({rows:rows.slice(0,25),hasMore:rows.length>25});
}));
router.get('/renewals/:id/history',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id);res.json(await db.transaction(async tx=>{await renewalAccess(tx,req.user!,id);return tx.select().from(history).where(eq(history.renewalId,id)).orderBy(history.version);}));
}));
router.post('/staffing/qualifications/:id/renew',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=renewalCreate.parse(req.body);
  const result=await db.transaction(async tx=>{
    const [initial]=await tx.select().from(credentials).where(eq(credentials.id,id));if(!initial)fail(404,'Qualification record not found');
    const employee=await employeeAccess(tx,req.user!,initial.employeeId);
    const [existing]=await tx.select().from(renewals).where(and(eq(renewals.employeeId,employee.id),eq(renewals.requestKey,input.requestKey)));
    if(existing){if(existing.previousCredentialId!==id)fail(409,'This request key belongs to another qualification');const [first]=await tx.select().from(history).where(and(eq(history.renewalId,existing.id),eq(history.version,1)));
      const original=first?.snapshot as typeof renewals.$inferSelect|undefined;if(original?.reference!==input.reference||original?.note!==input.note)fail(409,'This request key was already used with different details');return {id:existing.id,replayed:true};}
    const [old]=await tx.select().from(credentials).where(eq(credentials.id,id)).for('update');
    if(employee.status!=='active'||old.revokedAt||!old.validThrough)fail(409,'Renewal requires an active employee and a non-revoked qualification with an expiry date');
    const [child]=await tx.select({id:credentials.id}).from(credentials).where(eq(credentials.renewsCredentialId,id));if(child)fail(409,'This record already has a renewal. Use the latest qualification or ask HR to record a correction.');
    const [active]=await tx.select({id:renewals.id}).from(renewals).where(and(eq(renewals.previousCredentialId,id),inArray(renewals.status,['submitted','returned'])));if(active)fail(409,'A renewal is already awaiting verification or changes');
    const policySnapshot=policyFor(await effectiveRenewalPolicies(tx,old.qualificationId),old.qualificationId,employee.id);
    const [row]=await tx.insert(renewals).values({...input,employeeId:employee.id,previousCredentialId:id,submittedBy:req.user!.userId,policySnapshot}).returning();
    await recordHistory(tx,req.user!,row,'submitted','Renewal evidence submitted');return {id:row.id,replayed:false};
  });res.status(result.replayed?200:201).json(result);
}));
router.post('/renewals/:id/resubmit',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=renewalResubmit.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await renewalAccess(tx,req.user!,id);if(row.version!==input.version||row.status!=='returned')fail(409,'Refresh the returned request before resubmitting');if(employee.status!=='active')fail(409,'Employee is no longer active');
    const [saved]=await tx.update(renewals).set({reference:input.reference,note:input.note,status:'submitted',submittedBy:req.user!.userId,reviewedBy:null,reviewedAt:null,reviewNote:null}).where(eq(renewals.id,id)).returning();
    await recordHistory(tx,req.user!,saved,'resubmitted','Updated evidence submitted');return {id};
  }));
}));
router.post('/renewals/:id/cancel',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row}=await renewalAccess(tx,req.user!,id);if(row.version!==input.version||!['submitted','returned'].includes(row.status))fail(409,'Only the current pending renewal can be cancelled');
    const [saved]=await tx.update(renewals).set({status:'cancelled',reviewNote:input.reason,reviewedAt:new Date(),reviewedBy:req.user!.userId}).where(eq(renewals.id,id)).returning();await recordHistory(tx,req.user!,saved,'cancelled',input.reason);return {id};
  }));
}));
router.post('/renewals/:id/review',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),input=renewalDecision.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await renewalAccess(tx,req.user!,id);if(row.version!==input.version||row.status!=='submitted')fail(409,'Refresh the submitted renewal before reviewing');
    if(row.submittedBy===req.user!.userId||employee.userId===req.user!.userId)fail(403,'Another HR administrator must review this renewal');
    let newCredentialId:number|null=null;
    if(input.decision==='verify'){
      const [old]=await tx.select().from(credentials).where(eq(credentials.id,row.previousCredentialId)).for('update');
      if(employee.status!=='active'||old.revokedAt||!old.validThrough)fail(409,'Original qualification or employment changed; return the request for correction');
      if(input.validFrom<=old.validFrom||(input.validThrough&&(input.validThrough<input.validFrom||input.validThrough<=old.validThrough)))fail(400,'Renewal must start after the previous start and extend its expiry');
      const [child]=await tx.select({id:credentials.id}).from(credentials).where(eq(credentials.renewsCredentialId,old.id));if(child)fail(409,'This qualification was already renewed');
      const [overlap]=await tx.select({id:credentials.id}).from(credentials).where(and(eq(credentials.employeeId,employee.id),eq(credentials.qualificationId,old.qualificationId),ne(credentials.id,old.id),isNull(credentials.revokedAt),lte(credentials.validFrom,input.validThrough||'9999-12-31'),or(isNull(credentials.validThrough),sql`${credentials.validThrough} >= ${input.validFrom}`)));
      if(overlap)fail(409,'The renewal overlaps another verification period. Resolve that record first.');
      const [saved]=await tx.insert(credentials).values({employeeId:employee.id,qualificationId:old.qualificationId,renewsCredentialId:old.id,validFrom:input.validFrom,validThrough:input.validThrough,verificationReference:input.verificationReference,verifiedBy:req.user!.userId}).returning();newCredentialId=saved.id;
    }
    const [saved]=await tx.update(renewals).set({status:input.decision==='verify'?'verified':'returned',newCredentialId,reviewNote:input.reason,reviewedBy:req.user!.userId,reviewedAt:new Date()}).where(eq(renewals.id,id)).returning();
    await recordHistory(tx,req.user!,saved,input.decision==='verify'?'verified':'returned',input.reason);return {id,newCredentialId};
  }));
}));
export default router;
