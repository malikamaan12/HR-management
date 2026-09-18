import {Router} from 'express';
import {and,desc,eq,gt,gte,inArray,isNull,lt,lte,ne,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {z} from 'zod';
import {db} from '../db';
import {employees,users,workforceGrants as grants,workforceMembers as members,workforceMemberChanges as changes,workforceTeams as teams,workforceAssignments as assignments,
  workforceShifts as shifts,workforceSites as sites,workforcePresence as presence,workforceArrivalRules as rules,workforceIncidents as incidents,workforceIncidentUpdates as updates} from '@shared/schema';
import {positiveId,workforceAdmin} from '@shared/workforce';
import {membershipChangeInput,arrivalRuleInput,operationReason,incidentInput,incidentUpdate,defaultArrivalRules} from '@shared/workforce-operations';
import {audit,eligible,fail,lockEmployee,requireWorkforceAdmin,teamAccess,currentGrants,WorkforceError,type WorkforceTransaction} from '../services/workforce';
import {arrivalPolicy,presenceFields} from '../services/workforce-operations';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';
import {locationFix,type LocationEvidence} from '@shared/attendance-location';
import {verifyAttendanceLocation,locationPolicy} from '../services/attendance-location';

const router=Router(); // Authenticated by parent workforce router.
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const name=sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`;

router.get('/members/:id/history',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id);
  const [member]=await db.select().from(members).where(eq(members.id,id));if(!member)fail(404,'Membership not found');
  res.json(await db.select().from(changes).where(eq(changes.memberId,id)).orderBy(desc(changes.version)));
}));
router.post('/members/:id/end-date',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),input=membershipChangeInput.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [initial]=await tx.select().from(members).where(eq(members.id,id));if(!initial)fail(404,'Membership not found');
    // Eligibility and membership edits serialize on employee, without taking a shift lock afterwards.
    await lockEmployee(tx,initial.employeeId);
    const [row]=await tx.select().from(members).where(eq(members.id,id)).for('update');const now=new Date();
    if(row.version!==input.version)fail(409,'Membership changed. Refresh before saving.');
    if(row.endAt<=now||input.endAt<=now||input.endAt<=row.startAt)fail(409,'Keep historical dates intact. The new end must be in the future and after membership starts.');
    if(+row.endAt===+input.endAt)fail(400,'Choose a different end date');
    const [overlap]=await tx.select({id:members.id}).from(members).where(and(eq(members.teamId,row.teamId),eq(members.employeeId,row.employeeId),ne(members.id,id),lt(members.startAt,input.endAt),gt(members.endAt,row.startAt)));
    if(overlap)fail(409,'The new end overlaps another membership period');
    const [affected]=await tx.select({id:assignments.id}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id))
      .where(and(eq(assignments.employeeId,row.employeeId),eq(shifts.teamId,row.teamId),eq(shifts.status,'scheduled'),inArray(assignments.status,['offered','accepted']),
        gte(shifts.startAt,row.startAt),lte(shifts.endAt,row.endAt),gt(shifts.endAt,input.endAt))).limit(1);
    if(affected)fail(409,'Cancel or replace the affected offers and accepted assignments before ending membership');
    const [saved]=await tx.update(members).set({endAt:input.endAt}).where(eq(members.id,id)).returning();
    await tx.insert(changes).values({memberId:id,actorId:req.user!.userId,version:saved.version,previousEndAt:row.endAt,endAt:input.endAt,reason:input.reason});
    await audit(tx,req.user!,'member',id,'Membership end date revised');return saved;
  }));
}));

router.get('/teams/:teamId/arrival-rules',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const teamId=positiveId.parse(req.params.teamId);
  await db.transaction(tx=>teamAccess(tx,req.user!,teamId,'view'));
  res.json({defaults:defaultArrivalRules,history:await db.select({id:rules.id,employeeId:rules.employeeId,employeeName:name,effectiveAt:rules.effectiveAt,rules:rules.rules,reason:rules.reason})
    .from(rules).leftJoin(employees,eq(rules.employeeId,employees.id)).where(eq(rules.teamId,teamId)).orderBy(desc(rules.effectiveAt),desc(rules.id)).limit(500)});
}));
router.post('/teams/:teamId/arrival-rules',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const teamId=positiveId.parse(req.params.teamId),input=arrivalRuleInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    await teamAccess(tx,req.user!,teamId,'view');
    await tx.select({id:teams.id}).from(teams).where(eq(teams.id,teamId)).for('update');
    if(input.employeeId) {
      const [member]=await tx.select({id:members.id}).from(members).where(and(eq(members.teamId,teamId),eq(members.employeeId,input.employeeId))).limit(1);
      if(!member)fail(400,'Choose an employee with membership in this team');
    }
    const effectiveAt=input.effectiveAt||new Date();if(input.effectiveAt&&effectiveAt<new Date())fail(400,'New rules must take effect now or in the future');
    const [row]=await tx.insert(rules).values({...input,effectiveAt,teamId,createdBy:req.user!.userId}).returning();
    await audit(tx,req.user!,'arrival_rule',row.id,'Dated arrival rules saved');return {id:row.id};
  }));
}));

async function ownAssignment(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false) {
  const [initial]=await tx.select({assignment:assignments}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id))
    .where(and(eq(assignments.id,id),eq(employees.userId,user.userId)));
  if(!initial)fail(404,'Assignment not found');
  const shiftQuery=tx.select().from(shifts).where(eq(shifts.id,initial.assignment.shiftId));
  const [shift]=lock?await shiftQuery.for('update'):await shiftQuery;
  const assignmentQuery=tx.select().from(assignments).where(eq(assignments.id,id));
  const [assignment]=lock?await assignmentQuery.for('update'):await assignmentQuery;
  if(lock){const employee=await lockEmployee(tx,assignment.employeeId);if(employee.userId!==user.userId)fail(404,'Assignment account link changed');}
  return {assignment,shift};
}
router.get('/assignments/:id/presence',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id);
  res.json(await db.transaction(async tx=>{
    const {assignment,shift}=await ownAssignment(tx,req.user!,id);
    const [recorded]=await tx.select({...presenceFields,policySnapshot:presence.policySnapshot}).from(presence).where(eq(presence.assignmentId,id));
    const policy=recorded?.policySnapshot||await arrivalPolicy(tx,shift.teamId,assignment.employeeId);
    return {presence:recorded?{...recorded,policySnapshot:undefined}:null,rules:policy.rules,locationRequired:(await locationPolicy(tx)).config.required,opensAt:new Date(+shift.startAt-policy.rules.earlyMinutes*60000),closesAt:new Date(Math.min(+shift.endAt,+shift.startAt+policy.rules.lateMinutes*60000))};
  }));
}));
router.post('/assignments/:id/arrival',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({position:locationFix.optional()}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {assignment,shift}=await ownAssignment(tx,req.user!,id,true);
    const [recorded]=await tx.select(presenceFields).from(presence).where(eq(presence.assignmentId,id));if(recorded)return recorded;
    const now=new Date(),policy=await arrivalPolicy(tx,shift.teamId,assignment.employeeId,now);
    if(assignment.status!=='accepted'||shift.status!=='scheduled')fail(409,'Arrival requires an accepted scheduled assignment');
    if(!policy.rules.enabled)fail(409,'Mobile arrival is disabled by your current team rules');
    if(+now<+shift.startAt-policy.rules.earlyMinutes*60000||+now>+shift.startAt+policy.rules.lateMinutes*60000||now>=shift.endAt)fail(409,'Outside your arrival window. Contact your lead to record the exception.');
    const team=await tx.select({timezone:sites.timezone}).from(teams).innerJoin(sites,eq(teams.siteId,sites.id)).where(eq(teams.id,shift.teamId));
    await eligible(tx,assignment.employeeId,shift,team[0].timezone,assignment.id,false);
    const [open]=await tx.select({id:presence.id}).from(presence).where(and(eq(presence.employeeId,assignment.employeeId),isNull(presence.departedAt)));
    if(open)fail(409,'Record departure from your previous assignment first, or ask your lead to close the open visit');
    const [site]=await tx.select({siteId:teams.siteId}).from(teams).where(eq(teams.id,shift.teamId));
    const evidence=await verifyAttendanceLocation(tx,assignment.employeeId,input.position,site.siteId,now);
    const [row]=await tx.insert(presence).values({assignmentId:id,employeeId:assignment.employeeId,arrivedAt:now,arrivedBy:req.user!.userId,policySnapshot:policy,locationIn:evidence,approvalStatus:'pending',flags:now>shift.startAt?['Arrival after scheduled start']:[]}).returning(presenceFields);
    await audit(tx,req.user!,'presence',row.id,'Employee recorded arrival');return row;
  }));
}));

async function depart(tx:WorkforceTransaction,user:TokenPayload,assignment:typeof assignments.$inferSelect,shift:typeof shifts.$inferSelect,reason?:string,version?:number,position?:import('@shared/attendance-location').LocationFix) {
  const [row]=await tx.select().from(presence).where(eq(presence.assignmentId,assignment.id)).for('update');if(!row)fail(409,'Record arrival first');
  if(version!==undefined&&row.version!==version)fail(409,'Visit changed. Refresh before saving.');
  if(row.departedAt)return row;
  const now=new Date(),flags=[...row.flags];
  if(now<shift.endAt)flags.push('Departure before scheduled end');
  if(+now>+shift.endAt+row.policySnapshot.rules.departureGraceMinutes*60000)flags.push('Departure beyond configured grace');
  if(reason)flags.push('Visit closed by lead');
  const [site]=await tx.select({siteId:teams.siteId}).from(teams).where(eq(teams.id,shift.teamId));
  const evidence:LocationEvidence=reason?{status:'exception',recordedAt:now.toISOString(),policyVersion:(await locationPolicy(tx)).version,reason}:await verifyAttendanceLocation(tx,assignment.employeeId,position,site.siteId,now);
  const [saved]=await tx.update(presence).set({departedAt:now,departedBy:user.userId,departureReason:reason||null,locationOut:evidence,flags}).where(eq(presence.id,row.id)).returning(presenceFields);
  await audit(tx,user,'presence',row.id,reason?'Lead closed open visit':'Employee recorded departure');return saved;
}
router.post('/assignments/:id/departure',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({position:locationFix.optional()}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const {assignment,shift}=await ownAssignment(tx,req.user!,id,true);return depart(tx,req.user!,assignment,shift,undefined,undefined,input.position);}));
}));
router.post('/presence/:id/review',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,action:z.enum(['close','review','approve','reject']),reason:operationReason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [initial]=await tx.select({presence,assignment:assignments}).from(presence).innerJoin(assignments,eq(presence.assignmentId,assignments.id)).where(eq(presence.id,id));if(!initial)fail(404,'Visit not found');
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,initial.assignment.shiftId)).for('update');
    await teamAccess(tx,req.user!,shift.teamId,input.action==='close'?'schedule':'review_time',shift);
    const employee=await lockEmployee(tx,initial.assignment.employeeId);
    if(employee.userId===req.user!.userId||initial.presence.arrivedBy===req.user!.userId)fail(403,'Another lead must review or close your visit');
    const [row]=await tx.select().from(presence).where(eq(presence.id,id)).for('update');
    if(row.version!==input.version)fail(409,'Visit changed. Refresh before saving.');
    if(input.action==='close')return depart(tx,req.user!,initial.assignment,shift,input.reason,input.version);
    if(!row.departedAt)fail(409,'Close the visit before reviewing it');
    if(row.reviewedAt)fail(409,'This visit has already been reviewed');
    const decision=input.action==='reject'?'rejected' as const:'approved' as const;
    const [saved]=await tx.update(presence).set({approvalStatus:decision,reviewedAt:new Date(),reviewedBy:req.user!.userId,reviewNote:input.reason}).where(eq(presence.id,id)).returning(presenceFields);
    await audit(tx,req.user!,'presence',id,`Attendance ${decision}: ${input.reason}; payroll time requires separate approval`);return saved;
  }));
}));

router.get('/assignments/:id/attendance-review',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id);res.json(await db.transaction(async tx=>{
  const [row]=await tx.select({assignment:assignments,shift:shifts,owner:employees.userId}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).where(eq(assignments.id,id));if(!row)fail(404,'Assignment not found');
  await teamAccess(tx,req.user!,row.shift.teamId,'review_time',row.shift);if(row.owner===req.user!.userId)fail(403,'Another supervisor must review your attendance');
  const [recorded]=await tx.select(presenceFields).from(presence).where(eq(presence.assignmentId,id));return {presence:recorded||null};
 }));
}));
router.post('/assignments/:id/attendance-exception',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({startAt:z.coerce.date(),endAt:z.coerce.date(),reason:operationReason}).strict().parse(req.body);
 if(input.endAt<=input.startAt||+input.endAt-+input.startAt>86400000||input.endAt>new Date())fail(400,'An attendance exception must describe completed work of up to 24 hours');
 res.json(await db.transaction(async tx=>{
  const [assignment]=await tx.select().from(assignments).where(eq(assignments.id,id));if(!assignment)fail(404,'Assignment not found');
  const [shift]=await tx.select().from(shifts).where(eq(shifts.id,assignment.shiftId)).for('update');
  await teamAccess(tx,req.user!,shift.teamId,'review_time',shift);const employee=await lockEmployee(tx,assignment.employeeId);
  if(employee.userId===req.user!.userId)fail(403,'Another supervisor must approve your attendance exception');
  if(assignment.status!=='accepted'||shift.status!=='scheduled'||input.startAt>=shift.endAt||input.endAt<=shift.startAt)fail(409,'Exception must overlap an accepted scheduled assignment');
  const [existing]=await tx.select().from(presence).where(eq(presence.assignmentId,id));if(existing)fail(409,'Attendance already exists; review or close the recorded visit');
  const now=new Date(),evidence:LocationEvidence={status:'exception',recordedAt:now.toISOString(),policyVersion:(await locationPolicy(tx)).version,reason:input.reason};
  const [row]=await tx.insert(presence).values({assignmentId:id,employeeId:employee.id,arrivedAt:input.startAt,departedAt:input.endAt,arrivedBy:req.user!.userId,departedBy:req.user!.userId,policySnapshot:await arrivalPolicy(tx,shift.teamId,employee.id),locationIn:evidence,locationOut:evidence,flags:['Supervisor recorded missing attendance exception'],approvalStatus:'approved',reviewedAt:now,reviewedBy:req.user!.userId,reviewNote:input.reason}).returning(presenceFields);
  await audit(tx,req.user!,'presence',row.id,'Attendance exception approved: '+input.reason);return row;
 }));
}));

async function operationsAccess(tx:WorkforceTransaction,user:TokenPayload,shift:typeof shifts.$inferSelect) {
  try {const team=await teamAccess(tx,user,shift.teamId,'schedule',shift);return {canManage:true,canReadAttendance:true,team};}
  catch(e){if(!(e instanceof WorkforceError)||e.status!==404)throw e;}
  try {const team=await teamAccess(tx,user,shift.teamId,'review_time',shift);return {canManage:false,canReadAttendance:true,team};}
  catch(e){if(!(e instanceof WorkforceError)||e.status!==404)throw e;}
  const [own]=await tx.select({id:assignments.id}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id))
    .where(and(eq(assignments.shiftId,shift.id),eq(assignments.status,'accepted'),eq(employees.userId,user.userId)));
  if(!own)fail(404,'Operations log is outside your access');
  return {canManage:false,canReadAttendance:false,team:null};
}
router.get('/shifts/:id/operations',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id);
  res.json(await db.transaction(async tx=>{
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id));if(!shift)fail(404,'Shift not found');
    const access=await operationsAccess(tx,req.user!,shift),reporter=alias(users,'reporter'),owner=alias(users,'owner');
    const rows=await tx.select({id:incidents.id,title:incidents.title,details:incidents.details,severity:incidents.severity,status:incidents.status,version:incidents.version,occurredAt:incidents.occurredAt,createdAt:incidents.createdAt,
      reporterName:sql<string>`${reporter.firstName} || ' ' || ${reporter.lastName}`,ownerName:sql<string>`${owner.firstName} || ' ' || ${owner.lastName}`})
      .from(incidents).innerJoin(reporter,eq(incidents.reporterId,reporter.id)).leftJoin(owner,eq(incidents.ownerId,owner.id)).where(and(eq(incidents.shiftId,id),access.canManage?undefined:eq(incidents.reporterId,req.user!.userId))).orderBy(desc(incidents.id)).limit(200);
    const history=rows.length?await tx.select({id:updates.id,incidentId:updates.incidentId,status:updates.status,note:updates.note,createdAt:updates.createdAt,actorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`}).from(updates).innerJoin(users,eq(updates.actorId,users.id)).where(inArray(updates.incidentId,rows.map(r=>r.id))).orderBy(updates.id):[];
    return {canManage:access.canManage,incidents:rows.map(r=>({...r,history:history.filter(h=>h.incidentId===r.id)})),presence:await tx.select({...presenceFields,name,canReview:sql<boolean>`(case when ${presence.departedAt} is null then ${access.canManage} else ${workforceAdmin(req.user!.role)} or exists (select 1 from ${grants} where ${grants.teamId}=${shift.teamId} and ${grants.permission}='review_time' and ${currentGrants(req.user!)} and ${grants.startAt}<=${shift.startAt} and ${grants.endAt}>=${shift.endAt}) end) and ${presence.arrivedBy} <> ${req.user!.userId} and (${employees.userId} is null or ${employees.userId} <> ${req.user!.userId})`}).from(presence).innerJoin(assignments,eq(presence.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id))
      .where(and(eq(assignments.shiftId,id),access.canReadAttendance?undefined:eq(employees.userId,req.user!.userId))).orderBy(presence.arrivedAt)};
  }));
}));
router.post('/shifts/:id/incidents',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=incidentInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx=>{
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id)).for('update');if(!shift)fail(404,'Shift not found');
    await operationsAccess(tx,req.user!,shift);
    // Serialize this reporter's request keys across shifts as well as same-shift retries.
    await tx.select({id:users.id}).from(users).where(eq(users.id,req.user!.userId)).for('update');
    const [existing]=await tx.select().from(incidents).where(and(eq(incidents.reporterId,req.user!.userId),eq(incidents.requestKey,input.requestKey)));
    if(existing){if(existing.shiftId!==id||existing.title!==input.title||existing.details!==input.details||existing.severity!==input.severity||+existing.occurredAt!==+input.occurredAt)fail(409,'This report request was already used with different details');return {id:existing.id};}
    if(input.occurredAt>new Date()||input.occurredAt<shift.startAt||input.occurredAt>shift.endAt)fail(400,'Incident time must be within the shift and cannot be in the future');
    const [row]=await tx.insert(incidents).values({...input,shiftId:id,reporterId:req.user!.userId}).returning();
    await audit(tx,req.user!,'incident',row.id,'Operational incident reported');return {id:row.id};
  }));
}));
router.post('/incidents/:id/status',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),input=incidentUpdate.parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [initial]=await tx.select().from(incidents).where(eq(incidents.id,id));if(!initial)fail(404,'Incident not found');
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,initial.shiftId));
    await teamAccess(tx,req.user!,shift.teamId,'schedule',shift);
    const [row]=await tx.select().from(incidents).where(eq(incidents.id,id)).for('update');
    if(row.version!==input.version)fail(409,'Incident changed. Refresh before updating.');
    if(row.status==='resolved'&&input.status!=='open')fail(409,'Reopen the incident before further work');
    if(row.status==='open'&&input.status==='open')fail(400,'Take ownership or resolve this open incident');
    const [saved]=await tx.update(incidents).set({status:input.status,ownerId:input.status==='open'?null:req.user!.userId}).where(eq(incidents.id,id)).returning();
    await tx.insert(updates).values({incidentId:id,version:saved.version,actorId:req.user!.userId,status:input.status,note:input.note});
    await audit(tx,req.user!,'incident',id,'Operational incident status updated');return {id:saved.id};
  }));
}));
export default router;
