import {Router} from 'express';
import {and,eq,gt,gte,ilike,inArray,isNull,lt,lte,notInArray,or,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {employees,workforceUnavailable as unavailable,workforceQualifications as qualifications,employeeQualifications as credentials,
  workforceShifts as shifts,workforceAssignments as assignments,workforceMembers as members,workforceTimesheets as sheets} from '@shared/schema';
import {positiveId,workforceAdmin} from '@shared/workforce';
import {unavailableInput,credentialInput,staffingReason} from '@shared/workforce-staffing';
import {audit,eligible,fail,lockEmployee,requireWorkforceAdmin,teamAccess,WorkforceError,capacityCount,type WorkforceTransaction} from '../services/workforce';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';
import {assertNoRecordedArrival} from '../services/workforce-operations';

const router=Router(); // Parent workforce router authenticates all requests.
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
async function employeeAccess(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false){
  const query=tx.select().from(employees).where(and(eq(employees.id,id),workforceAdmin(user.role)?undefined:eq(employees.userId,user.userId)));
  const [row]=lock?await query.for('update'):await query;
  return row||fail(404,'Employee not found or outside your access');
}
router.get('/staffing/catalog',handle(async(_req,res)=>res.json(await db.select({id:qualifications.id,name:qualifications.name}).from(qualifications).orderBy(qualifications.name))));
router.post('/staffing/catalog',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const {name}=z.object({name:z.string().trim().min(2).max(120)}).strict().parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE workforce_qualifications IN SHARE ROW EXCLUSIVE MODE`);
    const [existing]=await tx.select({id:qualifications.id}).from(qualifications).where(sql`lower(${qualifications.name})=lower(${name})`);
    if(existing)fail(409,'This qualification already exists');
    const [row]=await tx.insert(qualifications).values({name,createdBy:req.user!.userId}).returning();
    await audit(tx,req.user!,'qualification',row.id,'Qualification type created');return {id:row.id,name:row.name};
  }));
}));
router.get('/staffing/profile',handle(async(req,res)=>{
  res.json(await db.transaction(async tx=>{
    const id=req.query.employeeId?positiveId.parse(req.query.employeeId):(await tx.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId)))[0]?.id;
    if(!id)fail(404,'Link your account to an employee record to manage availability');
    const employee=await employeeAccess(tx,req.user!,id);
    return {employee:{id:employee.id,name:employee.firstName+' '+employee.lastName},isAdmin:workforceAdmin(req.user!.role),
      unavailable:await tx.select({id:unavailable.id,startAt:unavailable.startAt,endAt:unavailable.endAt,note:unavailable.note,cancelledAt:unavailable.cancelledAt,cancellationReason:unavailable.cancellationReason}).from(unavailable).where(and(eq(unavailable.employeeId,id),isNull(unavailable.seriesId))).orderBy(sql`${unavailable.startAt} desc`).limit(200),
      qualifications:await tx.select({id:credentials.id,renewsCredentialId:credentials.renewsCredentialId,renewedById:sql<number|null>`(select r.id from employee_qualifications r where r.renews_credential_id=${credentials.id})`,qualificationId:credentials.qualificationId,name:qualifications.name,validFrom:credentials.validFrom,validThrough:credentials.validThrough,verificationReference:credentials.verificationReference,revokedAt:credentials.revokedAt,revocationReason:credentials.revocationReason}).from(credentials).innerJoin(qualifications,eq(credentials.qualificationId,qualifications.id)).where(eq(credentials.employeeId,id)).orderBy(sql`${credentials.validFrom} desc`).limit(200)};
  }));
}));
router.post('/staffing/employees/:id/unavailable',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=unavailableInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const employee=await employeeAccess(tx,req.user!,id,true);
    if(employee.status!=='active')fail(409,'Availability can be added only for an active employee');
    if(input.startAt<=new Date())fail(400,'Unavailable periods must start in the future');
    const [overlap]=await tx.select({id:unavailable.id}).from(unavailable).where(and(eq(unavailable.employeeId,id),isNull(unavailable.cancelledAt),lt(unavailable.startAt,input.endAt),gt(unavailable.endAt,input.startAt)));
    if(overlap)fail(409,'An unavailable period already covers these hours');
    const [accepted]=await tx.select({id:assignments.id}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).where(and(eq(assignments.employeeId,id),eq(assignments.status,'accepted'),lt(shifts.startAt,input.endAt),gt(shifts.endAt,input.startAt))).limit(1);
    if(accepted)fail(409,'Ask your lead to release or replace the overlapping accepted assignment first');
    const [row]=await tx.insert(unavailable).values({...input,employeeId:id,createdBy:req.user!.userId}).returning();
    // Personal notes stay in the owner/HR view, never in shared activity or candidate data.
    await audit(tx,req.user!,'availability',row.id,'Unavailable period recorded');return {id:row.id};
  }));
}));
router.post('/staffing/unavailable/:id/cancel',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{reason}=staffingReason.parse(req.body);
  await db.transaction(async tx=>{
    const [initial]=await tx.select().from(unavailable).where(eq(unavailable.id,id));if(!initial)fail(404,'Unavailable period not found');
    await employeeAccess(tx,req.user!,initial.employeeId,true);
    const [row]=await tx.select().from(unavailable).where(eq(unavailable.id,id)).for('update');
    if(row.cancelledAt)return;
    if(row.endAt<=new Date())fail(409,'Past availability history cannot be changed');
    await tx.update(unavailable).set({cancelledAt:new Date(),cancelledBy:req.user!.userId,cancellationReason:reason}).where(eq(unavailable.id,id));
    await audit(tx,req.user!,'availability',id,'Unavailable period cancelled');
  });res.json({success:true});
}));
router.post('/staffing/employees/:id/qualifications',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),input=credentialInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    await employeeAccess(tx,req.user!,id,true);
    const [kind]=await tx.select({id:qualifications.id}).from(qualifications).where(eq(qualifications.id,input.qualificationId));if(!kind)fail(400,'Choose an existing qualification');
    const [overlap]=await tx.select({id:credentials.id}).from(credentials).where(and(eq(credentials.employeeId,id),eq(credentials.qualificationId,input.qualificationId),isNull(credentials.revokedAt),lte(credentials.validFrom,input.validThrough||'9999-12-31'),or(isNull(credentials.validThrough),gte(credentials.validThrough,input.validFrom))));
    if(overlap)fail(409,'A verified qualification already covers these dates. Revoke an incorrect record before replacing it.');
    const [row]=await tx.insert(credentials).values({...input,employeeId:id,verifiedBy:req.user!.userId}).returning();
    await audit(tx,req.user!,'credential',row.id,'Dated employee qualification verified');return {id:row.id};
  }));
}));
router.post('/staffing/qualifications/:id/revoke',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),{reason}=staffingReason.parse(req.body);
  await db.transaction(async tx=>{
    const [initial]=await tx.select().from(credentials).where(eq(credentials.id,id));if(!initial)fail(404,'Qualification record not found');
    await lockEmployee(tx,initial.employeeId);
    const [row]=await tx.select().from(credentials).where(eq(credentials.id,id)).for('update');if(row.revokedAt)return;
    await tx.update(credentials).set({revokedAt:new Date(),revokedBy:req.user!.userId,revocationReason:reason}).where(eq(credentials.id,id));
    await audit(tx,req.user!,'credential',id,'Qualification revoked; affected assignments require review');
  });res.json({success:true});
}));
router.get('/shifts/:id/candidates',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),q=z.string().trim().max(80).parse(req.query.q||''),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  res.json(await db.transaction(async tx=>{
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id));if(!shift)fail(404,'Shift not found');
    const team=await teamAccess(tx,req.user!,shift.teamId,'schedule',shift);
    if(shift.status!=='scheduled'||shift.startAt<=new Date())fail(409,'Choose a future scheduled shift');
    const people=await tx.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`}).from(employees)
      .where(and(eq(employees.status,'active'),ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`,pattern),
        inArray(employees.id,tx.select({id:members.employeeId}).from(members).where(and(eq(members.teamId,shift.teamId),lte(members.startAt,shift.startAt),gte(members.endAt,shift.endAt)))),
        notInArray(employees.id,tx.select({id:assignments.employeeId}).from(assignments).where(eq(assignments.shiftId,id)))))
      .orderBy(employees.firstName,employees.id).limit(51);
    const candidates=[];
    for(const person of people.slice(0,50)){
      try{await eligible(tx,person.id,shift,team.timezone,undefined,false);candidates.push({...person,eligible:true,issue:null});}
      catch(e){if(!(e instanceof WorkforceError))throw e;candidates.push({...person,eligible:false,issue:e.message});}
    }
    return {candidates,hasMore:people.length>50};
  }));
}));
router.post('/assignments/:id/replacement',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({employeeId:positiveId,shiftVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const [initial]=await tx.select().from(assignments).where(eq(assignments.id,id));if(!initial)fail(404,'Assignment not found');
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,initial.shiftId)).for('update');
    const team=await teamAccess(tx,req.user!,shift.teamId,'schedule',shift);
    if(shift.status!=='scheduled'||shift.startAt<=new Date()||shift.version!==input.shiftVersion)fail(409,'This shift changed or already started. Refresh the roster.');
    const [source]=await tx.select().from(assignments).where(eq(assignments.id,id)).for('update');
    await assertNoRecordedArrival(tx,shift.id,id);
    if(source.employeeId===input.employeeId)fail(400,'Choose a different replacement employee');
    if(source.replacesAssignmentId&&source.status==='offered')fail(409,'Cancel or answer the pending replacement offer first');
    const [pending]=await tx.select().from(assignments).where(and(eq(assignments.replacesAssignmentId,id),inArray(assignments.status,['offered','accepted'])));
    if(pending){if(pending.employeeId===input.employeeId&&pending.replacementReason===input.reason)return {id:pending.id};fail(409,'A replacement is already pending or accepted for this assignment');}
    for(const employeeId of [source.employeeId,input.employeeId].sort((a,b)=>a-b))await lockEmployee(tx,employeeId);
    const [reported]=await tx.select({id:sheets.id}).from(sheets).where(eq(sheets.assignmentId,id));if(reported)fail(409,'Reported assignments cannot be replaced');
    const [existing]=await tx.select({id:assignments.id}).from(assignments).where(and(eq(assignments.shiftId,shift.id),eq(assignments.employeeId,input.employeeId)));if(existing)fail(409,'This employee already has an assignment or response for this shift');
    await eligible(tx,input.employeeId,shift,team.timezone);
    if(await capacityCount(tx,shift.id)-(source.status==='accepted'?1:0)>=shift.headcount)fail(409,'This shift is fully staffed');
    const [row]=await tx.insert(assignments).values({shiftId:shift.id,employeeId:input.employeeId,createdBy:req.user!.userId,replacesAssignmentId:id,replacementReason:input.reason}).returning();
    await audit(tx,req.user!,'assignment',row.id,`Replacement offered for assignment ${id}: ${input.reason}`);return {id:row.id};
  }));
}));
export default router;
