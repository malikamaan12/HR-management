import { Router } from 'express';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { fail, type WorkforceTransaction } from '../services/workforce';
import { employeeScope } from '../services/access';
import type { TokenPayload } from '../services/auth';
import { hasPermission } from '@shared/permissions';
import { employees, users, performanceCycles as cycles, performanceAssessments as assessments, performanceObjectives as objectives, performanceHistory as history } from '@shared/schema';
import { cycleInput, participantInput, bulkParticipantInput, participationInput, assessmentInput, objectiveInput, objectiveProgressInput, performanceAdmin, type Scores, type Rubric } from '@shared/performance-cycles';

const router=Router(), id=z.coerce.number().int().positive();
router.use(authenticate);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!hasPermission(req.user!.role,'performance_management','read'))return res.status(403).json({message:'Performance access is required'});next();});
const isAdmin=(user:TokenPayload)=>performanceAdmin(user.role);
const published=(status:string)=>['published','acknowledged'].includes(status);
const activeParticipant=sql`NOT EXISTS (SELECT 1 FROM performance_participation p WHERE p.assessment_id=${assessments.id} AND p.status='withdrawn')`;
const scope=(user:TokenPayload)=>isAdmin(user)?sql`true`:or(eq(employees.userId,user.userId),and(eq(assessments.reviewerId,user.userId),employeeScope(user,'performance_management','update')))!;
const cycleScope=(user:TokenPayload)=>isAdmin(user)?sql`true`:sql`exists (select 1 from ${assessments} join ${employees} on ${employees.id}=${assessments.employeeId} where ${assessments.cycleId}=${cycles.id} and ${scope(user)})`;
function admin(user:TokenPayload){if(!isAdmin(user))fail(403,'HR administration access is required');}
function version(row:{version:number},expected:number){if(row.version!==expected)fail(409,'This record has changed. Refresh before saving again.');}
async function event(tx:WorkforceTransaction,user:TokenPayload,cycleId:number,assessmentId:number|null,action:string,reason:string|null=null,snapshot:unknown=null){
  await tx.insert(history).values({cycleId,assessmentId,actorId:user.userId,action,reason,snapshot});
}
async function readCycle(tx:WorkforceTransaction,user:TokenPayload,cycleId:number,lock=false){
  const q=tx.select().from(cycles).where(and(eq(cycles.id,cycleId),cycleScope(user)));const [row]=lock?await q.for('update'):await q;
  if(!row)fail(404,'Review cycle not found');return row;
}
async function readAssessment(tx:WorkforceTransaction,user:TokenPayload,assessmentId:number,lock=false){
  const [ref]=await tx.select({cycleId:assessments.cycleId}).from(assessments).where(eq(assessments.id,assessmentId));if(!ref)fail(404,'Review not found');
  const cycle=await readCycle(tx,user,ref.cycleId,lock);
  const q=tx.select().from(assessments).where(eq(assessments.id,assessmentId));const [row]=lock?await q.for('update'):await q;
  const [employee]=await tx.select({id:employees.id,userId:employees.userId,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`}).from(employees).where(eq(employees.id,row.employeeId));
  const [managed]=row.reviewerId===user.userId?await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,row.employeeId),employeeScope(user,'performance_management','update'))):[];
  const own=employee.userId===user.userId,reviewer=row.reviewerId===user.userId&&Boolean(managed);
  if(!isAdmin(user)&&!own&&!reviewer)fail(404,'Review not found');
  const participation=await tx.execute(sql`SELECT status,version,reason,changed_by,changed_at FROM performance_participation WHERE assessment_id=${row.id}`);
  const state=participation.rows[0] as {status:'active'|'withdrawn';version:number;reason:string;changed_by:number;changed_at:string}|undefined;
  return {cycle,row,employee,own,reviewer,participation:state||{status:'active' as const,version:0,reason:null,changed_by:null,changed_at:null}};
}
async function validateParticipant(tx:WorkforceTransaction,user:TokenPayload,employeeId:number){
  const [employee]=await tx.select({id:employees.id}).from(employees).innerJoin(users,eq(employees.userId,users.id)).where(and(eq(employees.id,employeeId),employeeScope(user,'performance_management','update'),eq(employees.status,'active'),eq(users.isActive,true),eq(users.approvalStatus,'approved')));
  if(!employee)fail(400,`Employee #${employeeId} must be active, in your scope and have an approved linked account`);
}
async function validateReviewer(tx:WorkforceTransaction,reviewerId:number,employeeId:number){
  const [person]=await tx.select().from(users).where(and(eq(users.id,reviewerId),eq(users.isActive,true),eq(users.approvalStatus,'approved'))).for('share');
  if(!person||!hasPermission(person.role,'performance_management','update'))fail(400,'Choose an active reviewer with performance management permission');
  const user={userId:person.id,username:person.username,role:person.role,department:person.department} as TokenPayload;
  const [employee]=await tx.select({id:employees.id,userId:employees.userId}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(user,'performance_management','update')));
  if(!employee||employee.userId===reviewerId)fail(400,'The reviewer must manage this employee and cannot review themselves');
}
function checkedScores(rubric:Rubric,scores:Scores|undefined){
  if(!scores||scores.length!==rubric.length||new Set(scores.map(s=>s.key)).size!==rubric.length||scores.some(s=>!rubric.some(r=>r.key===s.key)))fail(400,'Rate every criterion exactly once');
  return scores;
}
function summary(value:string|undefined){if(!value||value.trim().length<10)fail(400,'Include a summary of at least 10 characters');return value.trim();}
const pageInput=z.coerce.number().int().min(1).max(10000).default(1);

router.get('/config',handle(async(req,res)=>res.json({canManage:isAdmin(req.user!),userId:req.user!.userId})));
router.get('/directory',handle(async(req,res)=>{
  admin(req.user!);const q=z.string().max(100).parse(req.query.q||''),term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const people=await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,employeeId:employees.employeeId}).from(employees)
    .innerJoin(users,eq(employees.userId,users.id)).where(and(eq(employees.status,'active'),eq(users.isActive,true),eq(users.approvalStatus,'approved'),or(ilike(employees.firstName,term),ilike(employees.lastName,term),ilike(employees.employeeId,term)))).orderBy(employees.id).limit(50);
  const reviewers=await db.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,role:users.role}).from(users)
    .where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),ilike(sql`${users.firstName} || ' ' || ${users.lastName}`,term))).orderBy(users.id).limit(100);
  res.json({employees:people,reviewers:reviewers.filter(p=>hasPermission(p.role,'performance_management','update'))});
}));
router.get('/',handle(async(req,res)=>{
  const page=pageInput.parse(req.query.page),condition=cycleScope(req.user!);
  const items=await db.select().from(cycles).where(condition).orderBy(desc(cycles.id)).limit(20).offset((page-1)*20);
  const [total]=await db.select({count:sql<number>`count(*)::int`}).from(cycles).where(condition);res.json({items,total:total.count,page});
}));
router.post('/',handle(async(req,res)=>{
  admin(req.user!);const input=cycleInput.parse(req.body);
  const row=await db.transaction(async tx=>{const [saved]=await tx.insert(cycles).values({...input,createdBy:req.user!.userId}).returning();await event(tx,req.user!,saved.id,null,'Cycle created',null,saved);return saved;});res.status(201).json(row);
}));
router.get('/assessments/:id',handle(async(req,res)=>{
  const result=await db.transaction(async tx=>{
    const {cycle,row,employee,own,reviewer,participation}=await readAssessment(tx,req.user!,id.parse(req.params.id));
    const reveal=published(row.status),staff=!own&&(isAdmin(req.user!)||reviewer);
    const safe={...row,selfScores:own||row.status!=='self_review'?row.selfScores:null,selfSummary:own||row.status!=='self_review'?row.selfSummary:null,
      managerScores:staff||reveal?row.managerScores:null,managerSummary:staff||reveal?row.managerSummary:null,finalScores:reveal?row.finalScores:null,finalSummary:reveal?row.finalSummary:null,finalRating:reveal?row.finalRating:null};
    const goals=await tx.select().from(objectives).where(eq(objectives.assessmentId,row.id)).orderBy(objectives.id);
    const logs=await tx.select({id:history.id,action:history.action,reason:history.reason,actorId:history.actorId,createdAt:history.createdAt,actorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`})
      .from(history).innerJoin(users,eq(history.actorId,users.id)).where(eq(history.assessmentId,row.id)).orderBy(desc(history.id)).limit(200);
    return {cycle,review:{...safe,participationStatus:participation.status},participation,employee,objectives:goals,history:logs.map(log=>({...log,reason:staff||reveal||log.actorId===req.user!.userId||log.action.startsWith('Objective')||log.action.startsWith('Participant')?log.reason:null})),
      access:{own,reviewer:reviewer&&!own,calibrate:isAdmin(req.user!)&&!own&&!reviewer,manage:isAdmin(req.user!),editObjectives:participation.status==='active'&&(own||reviewer||isAdmin(req.user!)),manageParticipation:isAdmin(req.user!)&&!own}};
  });res.json(result);
}));
router.get('/:id',handle(async(req,res)=>{
  const result=await db.transaction(async tx=>{const cycle=await readCycle(tx,req.user!,id.parse(req.params.id));
    const reviews=await tx.select({id:assessments.id,employeeId:assessments.employeeId,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,reviewerId:assessments.reviewerId,
      reviewerName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,status:assessments.status,dueDate:assessments.dueDate,selfRequired:assessments.selfRequired,
      finalRating:assessments.finalRating,version:assessments.version,participationStatus:sql<string>`CASE WHEN ${activeParticipant} THEN 'active' ELSE 'withdrawn' END`}).from(assessments).innerJoin(employees,eq(assessments.employeeId,employees.id)).innerJoin(users,eq(assessments.reviewerId,users.id))
      .where(and(eq(assessments.cycleId,cycle.id),scope(req.user!))).orderBy(assessments.id);
    const active=reviews.filter(r=>r.participationStatus==='active'),rated=active.filter(r=>published(r.status)&&r.finalRating!==null);
    return {cycle,reviews,report:{total:active.length,withdrawn:reviews.length-active.length,published:rated.length,acknowledged:active.filter(r=>r.status==='acknowledged').length,
      averageRating:rated.length?Number((rated.reduce((n,r)=>n+Number(r.finalRating),0)/rated.length).toFixed(2)):null,sampleCount:rated.length}};
  });res.json(result);
}));
router.patch('/:id',handle(async(req,res)=>{
  admin(req.user!);const input=z.object({version:id,cycle:cycleInput}).strict().parse(req.body);
  await db.transaction(async tx=>{const row=await readCycle(tx,req.user!,id.parse(req.params.id),true);version(row,input.version);if(row.status!=='draft')fail(409,'Only draft cycles can be edited');
    const [participant]=await tx.select({id:assessments.id}).from(assessments).where(and(eq(assessments.cycleId,row.id),activeParticipant,sql`${assessments.dueDate}<${input.cycle.periodEnd}`)).limit(1);
    if(participant)fail(400,'An employee deadline is before the revised period end');
    const [saved]=await tx.update(cycles).set({...input.cycle,version:row.version+1,updatedAt:new Date()}).where(eq(cycles.id,row.id)).returning();await event(tx,req.user!,row.id,null,'Cycle revised',null,saved);
  });res.json({success:true});
}));
router.post('/:id/participants',handle(async(req,res)=>{
  admin(req.user!);const input=participantInput.extend({version:id}).parse(req.body);
  const result=await db.transaction(async tx=>{
    const cycle=await readCycle(tx,req.user!,id.parse(req.params.id),true);version(cycle,input.version);if(cycle.status!=='draft')fail(409,'Add employees before opening the cycle');
    if(input.dueDate<cycle.periodEnd)fail(400,'Employee deadline must follow the review period');
    await validateParticipant(tx,req.user!,input.employeeId);
    await validateReviewer(tx,input.reviewerId,input.employeeId);
    const [existing]=await tx.select({id:assessments.id}).from(assessments).where(and(eq(assessments.cycleId,cycle.id),eq(assessments.employeeId,input.employeeId)));
    if(existing)fail(409,'This employee is already in the cycle');
    const {version:_,...data}=input;const [row]=await tx.insert(assessments).values({...data,cycleId:cycle.id}).returning();
    await tx.update(cycles).set({version:cycle.version+1,updatedAt:new Date()}).where(eq(cycles.id,cycle.id));await event(tx,req.user!,cycle.id,row.id,'Employee assigned',null,row);return row;
  });res.status(201).json(result);
}));
router.post('/:id/participants/bulk',handle(async(req,res)=>{
  admin(req.user!);const input=bulkParticipantInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    const cycle=await readCycle(tx,req.user!,id.parse(req.params.id),true);version(cycle,input.version);
    if(cycle.status!=='draft')fail(409,'Assign the batch before opening this review cycle');
    const existing=await tx.select({employeeId:assessments.employeeId,id:assessments.id}).from(assessments).where(eq(assessments.cycleId,cycle.id));
    const existingIds=new Map(existing.map(r=>[r.employeeId,r.id])),seen=new Set<number>();
    const skipped:{employeeId:number;reason:string}[]=[],pending:z.infer<typeof participantInput>[]=[];
    for(const participant of input.participants){
      const duplicate=seen.has(participant.employeeId)?'Repeated employee in this batch':existingIds.has(participant.employeeId)?'Already assigned; use reinstatement for a withdrawn participant':null;
      seen.add(participant.employeeId);
      if(duplicate){if(input.duplicatePolicy==='reject')fail(409,`Employee #${participant.employeeId}: ${duplicate}. No batch changes were saved.`);skipped.push({employeeId:participant.employeeId,reason:duplicate});continue;}
      pending.push(participant);
    }
    // Validate the whole batch before inserting any participant. The transaction is all-or-nothing.
    for(const participant of pending){
      if(participant.dueDate<cycle.periodEnd)fail(400,`Employee #${participant.employeeId}: the deadline must follow the cycle period`);
      await validateParticipant(tx,req.user!,participant.employeeId);await validateReviewer(tx,participant.reviewerId,participant.employeeId);
    }
    const added:{id:number;employeeId:number}[]=[];
    for(const participant of pending){
      const [row]=await tx.insert(assessments).values({...participant,cycleId:cycle.id}).returning();
      await event(tx,req.user!,cycle.id,row.id,'Employee bulk assigned',input.reason,row);added.push({id:row.id,employeeId:row.employeeId});
    }
    if(added.length){await tx.update(cycles).set({version:cycle.version+1,updatedAt:new Date()}).where(eq(cycles.id,cycle.id));await event(tx,req.user!,cycle.id,null,'Participants assigned in batch',input.reason,{added,skipped});}
    return {added,skipped,cycleVersion:cycle.version+(added.length?1:0)};
  });res.status(result.added.length?201:200).json(result);
}));
router.post('/assessments/:id/participation',handle(async(req,res)=>{
  admin(req.user!);const input=participationInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    const {row,cycle,employee,own,participation}=await readAssessment(tx,req.user!,id.parse(req.params.id),true);
    version(row,input.version);version(cycle,input.cycleVersion);
    if(own)fail(403,'Another HR administrator must change your participation');
    if(!['draft','open'].includes(cycle.status))fail(409,'Participation is fixed in a closed or cancelled cycle');
    if(published(row.status))fail(409,'Published assessments remain part of the permanent review record');
    const changes:Partial<typeof assessments.$inferInsert>={version:row.version+1,updatedAt:new Date()};
    if(input.action==='withdraw'){
      if(participation.status==='withdrawn')fail(409,'This employee is already withdrawn');
      if(input.reviewerId!==undefined||input.dueDate!==undefined)fail(400,'Reviewer and deadline changes apply only when reinstating');
    }else{
      if(participation.status!=='withdrawn')fail(409,'Only a withdrawn employee can be reinstated');
      const reviewerId=input.reviewerId??row.reviewerId,dueDate=input.dueDate??row.dueDate;
      if(dueDate<cycle.periodEnd)fail(400,'Choose a deadline on or after the review period end');
      await validateParticipant(tx,req.user!,employee.id);await validateReviewer(tx,reviewerId,employee.id);
      changes.dueDate=dueDate;changes.reviewerId=reviewerId;
      if(cycle.status==='open'&&row.status==='pending')changes.status=row.selfRequired?'self_review':'manager_review';
      if(reviewerId!==row.reviewerId){changes.managerScores=null;changes.managerSummary=null;if(row.status==='calibration')changes.status='manager_review';}
    }
    const state=input.action==='withdraw'?'withdrawn':'active';
    await tx.execute(sql`INSERT INTO performance_participation(assessment_id,status,reason,changed_by) VALUES (${row.id},${state},${input.reason},${req.user!.userId})
      ON CONFLICT (assessment_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,changed_by=EXCLUDED.changed_by,changed_at=now(),version=performance_participation.version+1`);
    const [saved]=await tx.update(assessments).set(changes).where(eq(assessments.id,row.id)).returning();
    await tx.update(cycles).set({version:cycle.version+1,updatedAt:new Date()}).where(eq(cycles.id,cycle.id));
    await event(tx,req.user!,cycle.id,row.id,input.action==='withdraw'?'Participant withdrawn':'Participant reinstated',input.reason,{before:row,after:saved,participation:state});
    return {assessmentId:row.id,version:saved.version,cycleVersion:cycle.version+1,participationStatus:state};
  });res.json(result);
}));
router.post('/:id/actions',handle(async(req,res)=>{
  admin(req.user!);const input=z.object({version:id,action:z.enum(['open','close','cancel']),reason:z.string().trim().min(5).max(1000).optional()}).strict().parse(req.body);
  await db.transaction(async tx=>{
    const row=await readCycle(tx,req.user!,id.parse(req.params.id),true);version(row,input.version);
    const people=await tx.select().from(assessments).where(and(eq(assessments.cycleId,row.id),activeParticipant));
    if(input.action==='open'){
      if(row.status!=='draft'||!people.length)fail(409,'A draft cycle needs at least one employee before opening');
      for(const p of people){await validateParticipant(tx,req.user!,p.employeeId);await validateReviewer(tx,p.reviewerId,p.employeeId);await tx.update(assessments).set({status:p.selfRequired?'self_review':'manager_review',version:p.version+1,updatedAt:new Date()}).where(eq(assessments.id,p.id));}
    }else if(input.action==='close'){
      if(row.status!=='open'||people.some(p=>p.status!=='acknowledged'))fail(409,'Every employee must acknowledge their published review before the cycle closes');
    }else if(!input.reason||!['draft','open'].includes(row.status)||people.some(p=>published(p.status)))fail(409,'Only unpublished draft or open cycles can be cancelled, with a reason');
    await tx.update(cycles).set({status:input.action==='open'?'open':input.action==='close'?'closed':'cancelled',version:row.version+1,updatedAt:new Date()}).where(eq(cycles.id,row.id));
    await event(tx,req.user!,row.id,null,'Cycle '+input.action,input.reason||null);
  });res.json({success:true});
}));
router.post('/assessments/:id/actions',handle(async(req,res)=>{
  const input=assessmentInput.parse(req.body);
  await db.transaction(async tx=>{
    const {row,cycle,employee,own,reviewer,participation}=await readAssessment(tx,req.user!,id.parse(req.params.id),true);version(row,input.version);
    if(participation.status==='withdrawn')fail(409,'This participant has been withdrawn. HR must reinstate them before work continues.');
    if(cycle.status!=='open')fail(409,'The review cycle is not open');
    const changes:Partial<typeof assessments.$inferInsert>={version:row.version+1,updatedAt:new Date()};
    if(input.action==='reassign'){
      admin(req.user!);if(published(row.status)||!input.reviewerId||!input.reason||input.reason.length<5)fail(409,'Choose a reviewer and reason before publication');
      await validateReviewer(tx,input.reviewerId,employee.id);changes.reviewerId=input.reviewerId;changes.managerScores=null;changes.managerSummary=null;
      if(row.status==='calibration')changes.status='manager_review';
    }else if(input.action==='save_self'||input.action==='submit_self'){
      if(!own||row.status!=='self_review')fail(403,'Only the employee can complete the current self-assessment');
      changes.selfScores=checkedScores(cycle.rubric,input.scores);changes.selfSummary=summary(input.summary);if(input.action==='submit_self')changes.status='manager_review';
    }else if(input.action==='save_manager'||input.action==='submit_manager'){
      if(!reviewer||own||row.status!=='manager_review')fail(403,'Only the assigned reviewer can complete the manager review');
      await validateReviewer(tx,req.user!.userId,employee.id);
      changes.managerScores=checkedScores(cycle.rubric,input.scores);changes.managerSummary=summary(input.summary);if(input.action==='submit_manager')changes.status='calibration';
    }else if(input.action==='return_manager'||input.action==='publish'){
      admin(req.user!);if(own||reviewer||row.status!=='calibration')fail(403,'An independent HR administrator must calibrate this submitted review');
      if(!input.reason||input.reason.length<5)fail(400,'Include the calibration or return reason');
      if(input.action==='return_manager')changes.status='manager_review';
      else{const scores=checkedScores(cycle.rubric,input.scores);changes.finalScores=scores;changes.finalSummary=summary(input.summary);
        changes.finalRating=(cycle.rubric.reduce((n,r)=>n+r.weight*scores.find(s=>s.key===r.key)!.score,0)/100).toFixed(2);
        changes.calibratedBy=req.user!.userId;changes.publishedAt=new Date();changes.status='published';}
    }else{
      if(!own||row.status!=='published')fail(403,'Only the employee can acknowledge a published review');changes.status='acknowledged';changes.acknowledgedAt=new Date();
    }
    const [saved]=await tx.update(assessments).set(changes).where(eq(assessments.id,row.id)).returning();await event(tx,req.user!,cycle.id,row.id,input.action,input.reason||null,saved);
  });res.json({success:true});
}));
router.patch('/assessments/:id',handle(async(req,res)=>{
  admin(req.user!);const input=z.object({version:id,reviewerId:id,dueDate:participantInput.shape.dueDate,selfRequired:z.boolean()}).strict().parse(req.body);
  await db.transaction(async tx=>{
    const {row,cycle,participation}=await readAssessment(tx,req.user!,id.parse(req.params.id),true);version(row,input.version);
    if(participation.status==='withdrawn')fail(409,'Reinstate this participant to change their review settings');
    if(cycle.status!=='draft')fail(409,'Employee settings are fixed when the cycle opens');
    if(input.dueDate<cycle.periodEnd)fail(400,'Employee deadline must follow the review period');
    await validateReviewer(tx,input.reviewerId,row.employeeId);
    const [saved]=await tx.update(assessments).set({reviewerId:input.reviewerId,dueDate:input.dueDate,selfRequired:input.selfRequired,version:row.version+1,updatedAt:new Date()}).where(eq(assessments.id,row.id)).returning();
    await tx.update(cycles).set({version:cycle.version+1,updatedAt:new Date()}).where(eq(cycles.id,cycle.id));await event(tx,req.user!,cycle.id,row.id,'Employee settings revised',null,saved);
  });res.json({success:true});
}));
router.post('/assessments/:id/objectives',handle(async(req,res)=>{
  const input=objectiveInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    const {row,cycle,participation}=await readAssessment(tx,req.user!,id.parse(req.params.id),true);if(cycle.status==='cancelled')fail(409,'This cycle was cancelled');
    if(participation.status==='withdrawn')fail(409,'Objectives are read-only while this participant is withdrawn');
    const [goal]=await tx.insert(objectives).values({...input,assessmentId:row.id,createdBy:req.user!.userId}).returning();await event(tx,req.user!,cycle.id,row.id,'Objective created',input.title,goal);return goal;
  });res.status(201).json(result);
}));
router.post('/objectives/:id/progress',handle(async(req,res)=>{
  const input=objectiveProgressInput.parse(req.body),objectiveId=id.parse(req.params.id);
  await db.transaction(async tx=>{
    const [ref]=await tx.select().from(objectives).where(eq(objectives.id,objectiveId));if(!ref)fail(404,'Objective not found');
    const {row,cycle,participation}=await readAssessment(tx,req.user!,ref.assessmentId,true);if(cycle.status==='cancelled')fail(409,'This cycle was cancelled');
    if(participation.status==='withdrawn')fail(409,'Objectives are read-only while this participant is withdrawn');
    const [goal]=await tx.select().from(objectives).where(eq(objectives.id,objectiveId)).for('update');version(goal,input.version);
    const [saved]=await tx.update(objectives).set({progress:input.progress,status:input.status,version:goal.version+1,updatedAt:new Date()}).where(eq(objectives.id,goal.id)).returning();
    await event(tx,req.user!,cycle.id,row.id,'Objective progress',goal.title+': '+input.note,saved);
  });res.json({success:true});
}));
export default router;
