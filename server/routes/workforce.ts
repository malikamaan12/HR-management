import {Router, type Request, type Response} from 'express';
import {and, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {employees, users, workforceSites as sites, workforceTeams as teams, workforceMembers as members,
  workforceGrants as grants, workforceShifts as shifts, workforceAssignments as assignments, employeeQualifications as credentials, skills, employeeSkills} from '@shared/schema';
import {workforceAdmin, positiveId, siteInput, teamInput, memberInput, grantInput, shiftInput, workforceSkillInput, workforceQualificationInput} from '@shared/workforce';
import {WorkforceError,fail,requireWorkforceAdmin,currentGrants,teamAccess,eligible,audit,capacityCount,resolveQualifications,missingQualifications,lockEmployee} from '../services/workforce';
import rosterRouter from './workforce-rosters';
import staffingRouter from './workforce-staffing';
import operationsRouter from './workforce-operations';
import availabilityRouter from './workforce-availability';
import renewalRouter from './workforce-renewals';
import {assertNoRecordedArrival} from '../services/workforce-operations';

const router=Router(); router.use(authenticate);
router.use(rosterRouter);
router.use(staffingRouter);
router.use(operationsRouter);
router.use(availabilityRouter);
router.use(renewalRouter);
const replacementFields={replacesAssignmentId:assignments.replacesAssignmentId,replacementReason:assignments.replacementReason,
  replacementPending:sql<boolean>`exists (select 1 from workforce_assignments r where r.replaces_assignment_id=${assignments.id} and r.status='offered')`};
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  try {await fn(req,res);} catch(error) {
    if(error instanceof WorkforceError) return res.status(error.status).json({message:error.message});
    if(error instanceof z.ZodError) return res.status(400).json({message:error.issues.map(i=>i.message).join('; ')});
    if((error as {code?:string}).code==='23503') return res.status(400).json({message:'The selected record no longer exists'});
    if((error as {code?:string}).code==='23505') return res.status(409).json({message:'This employee already has an offer for this shift'});
    console.error('Workforce request failed',error instanceof Error?error.name:'Unknown error');
    return res.status(500).json({message:'Unable to complete workforce request'});
  }
};
const teamFields={id:teams.id,name:teams.name,kind:teams.kind,siteId:teams.siteId,siteName:sites.name,timezone:sites.timezone};
const skillFields={id:skills.id,name:skills.name,category:skills.category};
router.get('/skills',handle(async(req,res)=>{
  if(!workforceAdmin(req.user!.role)) {
    const teamId=positiveId.parse(req.query.teamId);
    await db.transaction(tx=>teamAccess(tx,req.user!,teamId,'schedule'));
  }
  res.json(await db.select(skillFields).from(skills).orderBy(skills.name,skills.id));
}));
router.post('/skills',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const input=workforceSkillInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    // Serialize catalogue creation without changing or deduplicating legacy skill IDs.
    await tx.execute(sql`LOCK TABLE skills IN SHARE ROW EXCLUSIVE MODE`);
    const [existing]=await tx.select({id:skills.id}).from(skills).where(sql`lower(trim(${skills.name})) = lower(${input.name})`);
    if(existing) fail(409,'A skill with this name already exists; choose it from the catalogue');
    const [row]=await tx.insert(skills).values({...input,category:input.category||null}).returning(skillFields);
    await audit(tx,req.user!,'skill',row.id,'Skill catalogue entry created');return row;
  });res.status(201).json(result);
}));
router.get('/employees/:employeeId/qualifications',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const employeeId=positiveId.parse(req.params.employeeId);
  const [employee]=await db.select({id:employees.id}).from(employees).where(eq(employees.id,employeeId));
  if(!employee) fail(404,'Employee not found');
  res.json(await db.select({id:employeeSkills.id,skillId:employeeSkills.skillId,name:skills.name,proficiencyLevel:employeeSkills.proficiencyLevel,
    certificationExpiry:employeeSkills.certificationExpiry,updatedAt:employeeSkills.updatedAt}).from(employeeSkills).innerJoin(skills,eq(employeeSkills.skillId,skills.id))
    .where(eq(employeeSkills.employeeId,employeeId)).orderBy(skills.name,employeeSkills.id));
}));
router.post('/employees/:employeeId/qualifications',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const employeeId=positiveId.parse(req.params.employeeId),input=workforceQualificationInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    await lockEmployee(tx,employeeId);
    const [skill]=await tx.select({id:skills.id}).from(skills).where(eq(skills.id,input.skillId)).for('share');
    if(!skill) fail(400,'Choose an existing skill');
    const rows=await tx.select().from(employeeSkills).where(and(eq(employeeSkills.employeeId,employeeId),eq(employeeSkills.skillId,input.skillId))).for('update');
    if(rows.length>1) fail(409,'Duplicate legacy qualifications need reconciliation before editing');
    const existing=rows[0];
    if((existing?.updatedAt.toISOString()??null)!==(input.expectedUpdatedAt?new Date(input.expectedUpdatedAt).toISOString():null)) fail(409,'This qualification changed; reload it before saving');
    const values={proficiencyLevel:input.proficiencyLevel,certificationExpiry:input.certificationExpiry?new Date(input.certificationExpiry):null,
      updatedAt:new Date(Math.max(Date.now(),(existing?.updatedAt.getTime()??0)+1))};
    const [row]=existing?await tx.update(employeeSkills).set(values).where(eq(employeeSkills.id,existing.id)).returning({id:employeeSkills.id}):
      await tx.insert(employeeSkills).values({...values,employeeId,skillId:input.skillId}).returning({id:employeeSkills.id});
    await audit(tx,req.user!,'employee_qualification',row.id,existing?'Employee qualification updated':'Employee qualification recorded');return row;
  });res.status(200).json(result);
}));
function windowFor(req:Request) {
  const from=req.query.from?new Date(z.string().datetime({offset:true}).parse(req.query.from)):new Date(new Date().toISOString().slice(0,10)+'T00:00:00Z');
  const to=req.query.to?new Date(z.string().datetime({offset:true}).parse(req.query.to)):new Date(+from+14*86400000);
  if (+to<=+from || +to-+from>31*86400000) fail(400,'Choose a window of up to 31 days');
  return {from,to};
}
router.get('/teams',handle(async(req,res)=>{
  const isAdmin=workforceAdmin(req.user!.role);
  const rows=await db.select(teamFields).from(teams).innerJoin(sites,eq(teams.siteId,sites.id)).where(isAdmin?undefined:
    inArray(teams.id,db.select({id:grants.teamId}).from(grants).where(currentGrants(req.user!)))).orderBy(teams.name);
  res.json({isAdmin,teams:rows,sites:isAdmin?await db.select().from(sites).orderBy(sites.name):[]});
}));
router.get('/directory',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);
  const kind=z.enum(['employees','users']).parse(req.query.kind),q=z.string().trim().min(2).max(80).parse(req.query.q);
  // Parameterization plus escaping prevents user wildcards from broadening a lookup.
  const pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  if(kind==='employees') {
    const rows=await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,label:employees.employeeId}).from(employees)
      .where(and(eq(employees.status,'active'),or(ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`,pattern),ilike(employees.employeeId,pattern)))).orderBy(employees.id).limit(20);
    res.json(rows);
  } else {
    res.json(await db.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,label:users.username}).from(users)
      .where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),or(ilike(sql`${users.firstName} || ' ' || ${users.lastName}`,pattern),ilike(users.username,pattern)))).orderBy(users.id).limit(20));
  }
}));
router.post('/sites',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!); const input=siteInput.parse(req.body);
  const result=await db.transaction(async tx=>{const [row]=await tx.insert(sites).values(input).returning();await audit(tx,req.user!,'site',row.id,'Site created');return row;});
  res.status(201).json(result);
}));
router.post('/teams',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!); const input=teamInput.parse(req.body);
  const result=await db.transaction(async tx=>{const [row]=await tx.insert(teams).values(input).returning();await audit(tx,req.user!,'team',row.id,'Team created');return row;});
  res.status(201).json(result);
}));
router.post('/teams/:teamId/members',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const teamId=positiveId.parse(req.params.teamId),input=memberInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    await teamAccess(tx,req.user!,teamId,'view');
    // Team lock serializes membership creation for duplicate/overlap detection.
    await tx.select({id:teams.id}).from(teams).where(eq(teams.id,teamId)).for('update');
    const employee=await lockEmployee(tx,input.employeeId);
    if(employee.status!=='active') fail(400,'Choose an active employee');
    const [overlap]=await tx.select({id:members.id}).from(members).where(and(eq(members.teamId,teamId),eq(members.employeeId,input.employeeId),lt(members.startAt,input.endAt),gt(members.endAt,input.startAt)));
    if(overlap) fail(409,'This employee already has team membership during these dates');
    const [row]=await tx.insert(members).values({...input,teamId}).returning();await audit(tx,req.user!,'member',row.id,'Dated team membership created');return row;
  });res.status(201).json(result);
}));
router.post('/teams/:teamId/grants',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const teamId=positiveId.parse(req.params.teamId),input=grantInput.parse(req.body);
  const result=await db.transaction(async tx=>{
    await teamAccess(tx,req.user!,teamId,'view');
    const [user]=await tx.select({id:users.id}).from(users).where(and(eq(users.id,input.userId),eq(users.isActive,true),eq(users.approvalStatus,'approved')));
    if(!user) fail(400,'Choose an active approved user account');
    const [row]=await tx.insert(grants).values({...input,teamId}).returning();await audit(tx,req.user!,'grant',row.id,`Team access granted: ${input.permission}`);return row;
  });res.status(201).json(result);
}));
router.post('/teams/:teamId/grants/:id/revoke',handle(async(req,res)=>{
  requireWorkforceAdmin(req.user!);const teamId=positiveId.parse(req.params.teamId),id=positiveId.parse(req.params.id);
  await db.transaction(async tx=>{
    const [row]=await tx.update(grants).set({revokedAt:new Date()}).where(and(eq(grants.id,id),eq(grants.teamId,teamId),isNull(grants.revokedAt))).returning();
    if(!row) fail(404,'Active grant not found');await audit(tx,req.user!,'grant',id,'Team access revoked');
  });res.json({success:true});
}));
router.get('/teams/:teamId/dashboard',handle(async(req,res)=>{
  const teamId=positiveId.parse(req.params.teamId),{from,to}=windowFor(req),isAdmin=workforceAdmin(req.user!.role);
  const result=await db.transaction(async tx=>{
    const team=await teamAccess(tx,req.user!,teamId,'view');
    const permissions=isAdmin?[]:await tx.select().from(grants).where(and(eq(grants.teamId,teamId),currentGrants(req.user!)));
    if(!isAdmin&&!permissions.length) fail(404,'Team access has expired or been revoked');
    const memberWindows=permissions.filter(g=>g.startAt<to && g.endAt>from).map(g=>and(
      lt(members.startAt,new Date(Math.min(+to,+g.endAt))),gt(members.endAt,new Date(Math.max(+from,+g.startAt)))));
    const visibleShifts=await tx.select().from(shifts).where(and(eq(shifts.teamId,teamId),lt(shifts.startAt,to),gt(shifts.endAt,from),isAdmin?undefined:or(...permissions.map(g=>and(gte(shifts.startAt,g.startAt),lte(shifts.endAt,g.endAt)))))).orderBy(shifts.startAt);
    const roster=visibleShifts.length?await tx.select({...replacementFields,id:assignments.id,shiftId:assignments.shiftId,employeeId:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,status:assignments.status,cancellationReason:assignments.cancellationReason})
      .from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).where(inArray(assignments.shiftId,visibleShifts.map(s=>s.id))):[];
    const memberRows=await tx.select({id:members.id,version:members.version,employeeId:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,type:employees.type,startAt:members.startAt,endAt:members.endAt})
      .from(members).innerJoin(employees,eq(members.employeeId,employees.id)).where(and(eq(members.teamId,teamId),lt(members.startAt,to),gt(members.endAt,from),
        isAdmin?undefined:memberWindows.length?or(...memberWindows):sql`false`)).orderBy(employees.firstName);
    const grantRows=isAdmin?await tx.select({id:grants.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,permission:grants.permission,startAt:grants.startAt,endAt:grants.endAt,revokedAt:grants.revokedAt})
      .from(grants).innerJoin(users,eq(grants.userId,users.id)).where(and(eq(grants.teamId,teamId),gt(grants.endAt,from))).orderBy(grants.id):[];
    const verified=roster.length?await tx.select().from(credentials).where(and(inArray(credentials.employeeId,[...new Set(roster.map(a=>a.employeeId))]),isNull(credentials.revokedAt))):[];
    const requiredIds=[...new Set(visibleShifts.flatMap(s=>s.requiredSkills))];
    const requiredCatalogue=requiredIds.length?await tx.select(skillFields).from(skills).where(inArray(skills.id,requiredIds)):[];
    return {team,from,to,canSchedule:isAdmin||permissions.some(g=>g.permission==='schedule'),members:memberRows,grants:grantRows,skills:requiredCatalogue,
      shifts:visibleShifts.map(s=>({...s,createdBy:undefined,canSchedule:isAdmin||permissions.some(g=>g.permission==='schedule' && g.startAt<=s.startAt && g.endAt>=s.endAt),assignments:roster.filter(a=>a.shiftId===s.id).map(a=>({...a,missingQualifications:['offered','accepted'].includes(a.status)&&s.endAt>new Date()?missingQualifications(s,team.timezone,verified.filter(c=>c.employeeId===a.employeeId)):[]}))}))};
  });res.json(result);
}));
router.post('/teams/:teamId/shifts',handle(async(req,res)=>{
  const teamId=positiveId.parse(req.params.teamId),input=shiftInput.parse(req.body);
  if(input.startAt<=new Date()) fail(400,'New shifts must start in the future');
  const result=await db.transaction(async tx=>{await teamAccess(tx,req.user!,teamId,'schedule',input);
    if(input.requiredSkills.length) {
      const found=await tx.select({id:skills.id}).from(skills).where(inArray(skills.id,input.requiredSkills)).for('share');
      if(found.length!==input.requiredSkills.length) fail(400,'One or more required skills no longer exist; reload the catalogue');
    }
    const {qualificationIds,...details}=input;const requiredQualifications=await resolveQualifications(tx,qualificationIds);
    const [row]=await tx.insert(shifts).values({...details,requiredQualifications,teamId,createdBy:req.user!.userId}).returning();await audit(tx,req.user!,'shift',row.id,'Shift created');return row;});
  res.status(201).json(result);
}));
router.post('/shifts/:id/offers',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{employeeId}=z.object({employeeId:positiveId}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id)).for('update');if(!shift) return fail(404,'Shift not found');
    const team=await teamAccess(tx,req.user!,shift.teamId,'schedule',shift);
    if(shift.status!=='scheduled' || shift.startAt<=new Date()) fail(409,'This shift is no longer open for offers');
    const [existing]=await tx.select().from(assignments).where(and(eq(assignments.shiftId,id),eq(assignments.employeeId,employeeId)));
    if(existing?.status==='offered') return existing; // Safe retry; terminal offers retain their history.
    if(existing) return fail(409,'This employee already responded or the assignment was cancelled');
    await eligible(tx,employeeId,shift,team.timezone);
    if(await capacityCount(tx,id)>=shift.headcount) fail(409,'This shift is fully staffed');
    const [row]=await tx.insert(assignments).values({shiftId:id,employeeId,createdBy:req.user!.userId}).returning();
    await audit(tx,req.user!,'assignment',row.id,'Shift offered');return row;
  });res.status(201).json(result);
}));
router.get('/my-assignments',handle(async(req,res)=>{
  const {from,to}=windowFor(req);
  const rows=await db.select({...replacementFields,requiredSkills:shifts.requiredSkills,shiftId:shifts.id,employeeId:employees.id,requiredQualifications:shifts.requiredQualifications,id:assignments.id,status:assignments.status,cancellationReason:assignments.cancellationReason,replacesId:shifts.replacesId,changeReason:shifts.changeReason,role:shifts.role,station:shifts.station,startAt:shifts.startAt,endAt:shifts.endAt,breakMinutes:shifts.breakMinutes,
    teamName:teams.name,siteName:sites.name,timezone:sites.timezone,kind:teams.kind})
    .from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id))
    .innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).where(and(eq(employees.userId,req.user!.userId),lt(shifts.startAt,to),gt(shifts.endAt,from))).orderBy(shifts.startAt);
  const verified=rows.length?await db.select().from(credentials).where(and(inArray(credentials.employeeId,[...new Set(rows.map(a=>a.employeeId))]),isNull(credentials.revokedAt))):[];
  const requiredIds=[...new Set(rows.flatMap(row=>row.requiredSkills))];
  const catalogue=requiredIds.length?await db.select(skillFields).from(skills).where(inArray(skills.id,requiredIds)):[];
  res.json(rows.map(row=>({...row,requiredSkills:row.requiredSkills.map(id=>catalogue.find(skill=>skill.id===id)??{id,name:`Unavailable skill #${id}`,category:null}),employeeId:undefined,missingQualifications:['offered','accepted'].includes(row.status)&&row.endAt>new Date()?missingQualifications(row,row.timezone,verified.filter(c=>c.employeeId===row.employeeId)):[]})));
}));
router.post('/assignments/:id/respond',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{decision}=z.object({decision:z.enum(['accepted','declined'])}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    const [own]=await tx.select({assignment:assignments}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id))
      .where(and(eq(assignments.id,id),eq(employees.userId,req.user!.userId)));
    if(!own) return fail(404,'Assignment not found');
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,own.assignment.shiftId)).for('update');
    const [assignment]=await tx.select().from(assignments).where(eq(assignments.id,id)).for('update');
    if(assignment.status===decision) return assignment;
    if(assignment.status!=='offered' || shift.status!=='scheduled' || shift.startAt<=new Date()) fail(409,'This offer can no longer be answered');
    if(decision==='accepted') {
      const [source]=assignment.replacesAssignmentId?await tx.select().from(assignments).where(eq(assignments.id,assignment.replacesAssignmentId)).for('update'):[];
      if(assignment.replacesAssignmentId&&(!source||source.shiftId!==shift.id))fail(409,'Replacement source is no longer valid');
      for(const employeeId of [...new Set([assignment.employeeId,...(source?[source.employeeId]:[])])].sort((a,b)=>a-b))await lockEmployee(tx,employeeId);
      const [site]=await tx.select({timezone:sites.timezone}).from(teams).innerJoin(sites,eq(teams.siteId,sites.id)).where(eq(teams.id,shift.teamId));
      await eligible(tx,assignment.employeeId,shift,site.timezone,id);
      if(await capacityCount(tx,shift.id)-(source?.status==='accepted'?1:0)>=shift.headcount) fail(409,'This shift is fully staffed; contact your team lead');
      if(source&&['offered','accepted'].includes(source.status)){
        await assertNoRecordedArrival(tx,shift.id,source.id);
        await tx.update(assignments).set({status:'cancelled',cancellationReason:'Replacement accepted: '+assignment.replacementReason,respondedAt:new Date()}).where(eq(assignments.id,source.id));
        await audit(tx,req.user!,'assignment',source.id,JSON.stringify({action:'replacement_accepted',replacementId:id,reason:assignment.replacementReason,previous:source}));
      }
    }
    const [row]=await tx.update(assignments).set({status:decision,respondedAt:new Date()}).where(eq(assignments.id,id)).returning();
    await audit(tx,req.user!,'assignment',id,`Offer ${decision}`);return row;
  });res.json(result);
}));
router.post('/assignments/:id/cancel',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),{reason}=z.object({reason:z.string().trim().min(5).max(500)}).strict().parse(req.body);
  await db.transaction(async tx=>{
    const [initial]=await tx.select().from(assignments).where(eq(assignments.id,id));if(!initial) return fail(404,'Assignment not found');
    const [shift]=await tx.select().from(shifts).where(eq(shifts.id,initial.shiftId)).for('update');
    await teamAccess(tx,req.user!,shift.teamId,'schedule',shift);
    const [row]=await tx.select().from(assignments).where(eq(assignments.id,id)).for('update');
    if(row.status==='cancelled') return;
    await assertNoRecordedArrival(tx,shift.id,id);
    if(!['offered','accepted'].includes(row.status) || shift.startAt<=new Date()) fail(409,'Only future offered or accepted assignments can be cancelled');
    await tx.update(assignments).set({status:'cancelled',cancellationReason:reason,respondedAt:new Date()}).where(eq(assignments.id,id));
    await audit(tx,req.user!,'assignment',id,'Assignment cancelled: '+reason);
  });res.json({success:true});
}));
export default router;
