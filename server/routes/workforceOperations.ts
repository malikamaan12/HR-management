import {Router} from 'express';
import {z} from 'zod';
import {and,eq,gt,gte,inArray,isNull,lt,lte,ne,or,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,leaves,skills,workforceTeams as teams,workforceMembers as members,workforceGrants as grants,workforceShifts as shifts,workforceAssignments as assignments,workforceTimesheets as timesheets} from '@shared/schema';
import {positiveId,shiftInput,siteTimeToIso,workforceAdmin} from '@shared/workforce';
import {WorkforceError,fail,teamAccess,lockEmployee,eligible,capacityCount,audit,currentGrants,type WorkforceTransaction} from '../services/workforce';
import {candidateQuery,candidateScope,withinWindow,reviewWindow,permissionScope,otherEmployee,hasReviewGrant} from '../services/assignmentReviews';
import {employeeScope} from '../services/access';
const router=Router();
const handle=(fn:(req:any,res:any)=>Promise<unknown>)=>async(req:any,res:any)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(e){res.status(e instanceof WorkforceError?e.status:e instanceof z.ZodError?400:500).json({message:e instanceof WorkforceError?e.message:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):'Unable to complete workforce operation'});}};
const instant=z.string().datetime({offset:true}).transform(s=>new Date(s));

const reason=z.string().trim().min(5).max(500);
async function ownEmployee(tx:WorkforceTransaction,userId:number){const [row]=await tx.select().from(employees).where(eq(employees.userId,userId)).for('update');if(!row)fail(404,'Link an employee record before recording availability');return row;}
router.get('/availability',handle(async(req,res)=>{
 const range=reviewWindow(req);const result=await db.execute(sql`SELECT a.id,a.start_at,a.end_at,a.kind,a.cancelled_at FROM workforce_availability a JOIN employees ON employees.id=a.employee_id WHERE employees.user_id=${req.user.userId} AND a.start_at<${range.to} AND a.end_at>${range.from} ORDER BY a.start_at,a.id LIMIT 200`);res.json(result.rows);
}));
router.post('/availability',handle(async(req,res)=>{
 const input=z.object({startAt:instant,endAt:instant,kind:z.enum(['available','unavailable'])}).strict().refine(v=>v.endAt>v.startAt&&+v.endAt-+v.startAt<=90*86400000,'Choose a period of up to 90 days').parse(req.body);
 if(input.startAt<=new Date())fail(400,'Availability must start in the future');
 const result=await db.transaction(async tx=>{
  const employee=await ownEmployee(tx,req.user.userId);
  const overlap=await tx.execute(sql`SELECT id FROM workforce_availability WHERE employee_id=${employee.id} AND cancelled_at IS NULL AND start_at<${input.endAt} AND end_at>${input.startAt} LIMIT 1`);if(overlap.rows.length)fail(409,'Cancel the overlapping availability declaration before replacing it');
  if(input.kind==='unavailable'){
   const [accepted]=await tx.select({id:assignments.id}).from(assignments).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).where(and(eq(assignments.employeeId,employee.id),eq(assignments.status,'accepted'),lt(shifts.startAt,input.endAt),gt(shifts.endAt,input.startAt)));
   if(accepted)fail(409,'Ask your scheduler to arrange coverage and cancel the accepted assignment first');
  }
  const rows=await tx.execute(sql`INSERT INTO workforce_availability(employee_id,start_at,end_at,kind) VALUES (${employee.id},${input.startAt},${input.endAt},${input.kind}) RETURNING id`);
  await audit(tx,req.user,'availability',Number(rows.rows[0].id),'Employee availability declared');return rows.rows[0];
 });res.status(201).json(result);
}));
router.post('/availability/:id/cancel',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id);await db.transaction(async tx=>{const employee=await ownEmployee(tx,req.user.userId);
  const row=await tx.execute(sql`SELECT * FROM workforce_availability WHERE id=${id} AND employee_id=${employee.id} FOR UPDATE`);if(!row.rows.length)fail(404,'Availability not found');if(row.rows[0].cancelled_at)return;
  if(new Date(String(row.rows[0].end_at))<=new Date())fail(409,'Past availability is retained as history');
  await tx.execute(sql`UPDATE workforce_availability SET cancelled_at=now() WHERE id=${id}`);await audit(tx,req.user,'availability',id,'Availability cancelled');});res.json({success:true});
}));
function wall(date:Date,zone:string){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;}
function recurringInstant(value:string,zone:string){try{return siteTimeToIso(value,zone);}catch(e){return fail(400,(e as Error).message);}}
function laterWall(value:string,days:number){return new Date(Date.parse(value+':00Z')+days*86400000).toISOString().slice(0,16);}
router.post('/teams/:teamId/series',handle(async(req,res)=>{
 const teamId=positiveId.parse(req.params.teamId),input=z.object({shift:shiftInput,count:z.number().int().min(2).max(12),intervalDays:z.number().int().min(1).max(28),requestKey:z.string().uuid()}).strict().parse(req.body);
 if((input.count-1)*input.intervalDays>90)fail(400,'A recurring roster must fit within 90 days');
 const rows=await db.transaction(async tx=>{
  const team=await teamAccess(tx,req.user,teamId,'schedule',input.shift);await tx.select().from(teams).where(eq(teams.id,teamId)).for('update');
  const payload=JSON.stringify({teamId,...input});const prior=await tx.execute(sql`SELECT * FROM workforce_series WHERE created_by=${req.user.userId} AND request_key=${input.requestKey}`);
  if(prior.rows.length){if(JSON.stringify(prior.rows[0].payload)!==JSON.stringify(JSON.parse(payload))) {
    // jsonb key ordering differs; compare semantic payload through PostgreSQL.
    const match=await tx.execute(sql`SELECT id FROM workforce_series WHERE id=${prior.rows[0].id} AND payload=${payload}::jsonb`);if(!match.rows.length)fail(409,'This roster request key was used for different input');
   }const ids=prior.rows[0].shift_ids as number[];const saved=await tx.select().from(shifts).where(inArray(shifts.id,ids));for(const shift of saved)await teamAccess(tx,req.user,teamId,'schedule',shift);return saved;
  }
  const saved=[];for(let n=0;n<input.count;n++){
   const offset=n*input.intervalDays;
   const occurrence=shiftInput.parse({...input.shift,startAt:recurringInstant(laterWall(wall(input.shift.startAt,team.timezone),offset),team.timezone),endAt:recurringInstant(laterWall(wall(input.shift.endAt,team.timezone),offset),team.timezone)});
   if(occurrence.startAt<=new Date())fail(400,'All recurring shifts must start in the future');
   await teamAccess(tx,req.user,teamId,'schedule',occurrence);
   if(occurrence.requiredSkills.length){const found=await tx.select().from(skills).where(inArray(skills.id,occurrence.requiredSkills));if(found.length!==occurrence.requiredSkills.length)fail(400,'Required skills no longer exist');}
   const [row]=await tx.insert(shifts).values({...occurrence,teamId,createdBy:req.user.userId}).returning();saved.push(row);await audit(tx,req.user,'shift',row.id,'Recurring roster shift created');
  }
  await tx.execute(sql`INSERT INTO workforce_series(team_id,created_by,request_key,payload,shift_ids) VALUES (${teamId},${req.user.userId},${input.requestKey},${payload}::jsonb,${JSON.stringify(saved.map(s=>s.id))}::jsonb)`);return saved;
 });res.status(201).json({shifts:rows});
}));
router.get('/shifts/:id/candidates',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const result=await db.transaction(async tx=>{
  const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id));if(!shift)fail(404,'Shift not found');const team=await teamAccess(tx,req.user,shift.teamId,'schedule',shift);
  if(shift.cancelledAt||shift.startAt<=new Date())fail(409,'Choose a future active shift');
  const people=await tx.selectDistinct({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`}).from(employees).innerJoin(members,eq(members.employeeId,employees.id)).where(and(eq(members.teamId,shift.teamId),lte(members.startAt,shift.startAt),gte(members.endAt,shift.endAt))).orderBy(employees.id).limit(25).offset((page-1)*25);
  const result=[];for(const p of people){let error:string|null=null;try{await eligible(tx,p.id,shift,team.timezone);}catch(e){if(!(e instanceof WorkforceError))throw e;error=e.message;}
   const [previous]=await tx.select({status:assignments.status}).from(assignments).where(and(eq(assignments.shiftId,id),eq(assignments.employeeId,p.id)));if(previous)error='Already has an assignment or previous offer for this shift';
   const available=await tx.execute(sql`SELECT id FROM workforce_availability WHERE employee_id=${p.id} AND cancelled_at IS NULL AND kind='available' AND start_at<=${shift.startAt} AND end_at>=${shift.endAt} LIMIT 1`);
   result.push({...p,eligible:!error,reason:error,declaredAvailable:!!available.rows.length});
  }return {items:result,page};
 });res.json(result);
}));
router.post('/assignments/:id/replace',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({employeeId:positiveId,reason}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [initial]=await tx.select().from(assignments).where(eq(assignments.id,id));if(!initial)fail(404,'Assignment not found');
  const [shift]=await tx.select().from(shifts).where(eq(shifts.id,initial.shiftId)).for('update');const team=await teamAccess(tx,req.user,shift.teamId,'schedule',shift);
  if(shift.cancelledAt||shift.startAt<=new Date())fail(409,'Only future active shifts support replacement');
  const prior=await tx.execute(sql`SELECT r.replacement_id,a.employee_id FROM workforce_replacements r JOIN workforce_assignments a ON a.id=r.replacement_id WHERE r.original_id=${id}`);if(prior.rows.length){if(prior.rows[0].employee_id!==input.employeeId)fail(409,'A replacement was already offered');return {id:prior.rows[0].replacement_id};}
  const [original]=await tx.select().from(assignments).where(eq(assignments.id,id)).for('update');
  if(!['offered','accepted','cancelled'].includes(original.status)||original.employeeId===input.employeeId)fail(409,'Choose another employee for an active or cancelled assignment');
  for(const employeeId of [original.employeeId,input.employeeId].sort((a,b)=>a-b))await lockEmployee(tx,employeeId);
  if(await capacityCount(tx,shift.id)-(original.status==='accepted'?1:0)>=shift.headcount)fail(409,'This shift is already fully staffed');
  await eligible(tx,input.employeeId,shift,team.timezone);
  const [exists]=await tx.select().from(assignments).where(and(eq(assignments.shiftId,shift.id),eq(assignments.employeeId,input.employeeId)));if(exists)fail(409,'Employee already has an assignment or previous offer');
  const [replacement]=await tx.insert(assignments).values({shiftId:shift.id,employeeId:input.employeeId,createdBy:req.user.userId}).returning();
  if(original.status!=='cancelled')await tx.update(assignments).set({status:'cancelled',cancellationReason:input.reason,respondedAt:new Date()}).where(eq(assignments.id,id));
  await tx.execute(sql`INSERT INTO workforce_replacements(original_id,replacement_id,reason,created_by) VALUES (${id},${replacement.id},${input.reason},${req.user.userId})`);
  await audit(tx,req.user,'assignment',id,'Coverage replacement offered: '+input.reason);return {id:replacement.id};
 });res.status(201).json(result);
}));
router.post('/shifts/:id/revise',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({version:z.number().int().positive(),shift:shiftInput,reason}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [old]=await tx.select().from(shifts).where(eq(shifts.id,id)).for('update');if(!old)fail(404,'Shift not found');
  await teamAccess(tx,req.user,old.teamId,'schedule',old);await teamAccess(tx,req.user,old.teamId,'schedule',input.shift);
  if(old.version!==input.version||old.cancelledAt||old.startAt<=new Date()||input.shift.startAt<=new Date())fail(409,'Only the current version of a future shift can be revised');
  const active=await tx.select().from(assignments).where(and(eq(assignments.shiftId,id),inArray(assignments.status,['offered','accepted']))).orderBy(assignments.employeeId).for('update');
  // Revision explicitly cancels old responses. Schedulers must send new offers for staff to accept again.
  for(const a of active)await lockEmployee(tx,a.employeeId);
  if(input.shift.requiredSkills.length){const found=await tx.select().from(skills).where(inArray(skills.id,input.shift.requiredSkills));if(found.length!==input.shift.requiredSkills.length)fail(400,'Required skills no longer exist');}
  const [next]=await tx.insert(shifts).values({...input.shift,teamId:old.teamId,createdBy:req.user.userId,supersedesId:old.id}).returning();
  await tx.update(assignments).set({status:'cancelled',cancellationReason:'Shift revised: '+input.reason,respondedAt:new Date()}).where(and(eq(assignments.shiftId,id),inArray(assignments.status,['offered','accepted'])));
  const [archived]=await tx.update(shifts).set({cancelledAt:new Date(),version:old.version+1}).where(eq(shifts.id,id)).returning();
  await tx.execute(sql`INSERT INTO workforce_shift_history(shift_id,version,snapshot,reason,actor_id) VALUES (${id},${old.version},${JSON.stringify(old)}::jsonb,'Original shift before revision',${req.user.userId}),(${id},${archived.version},${JSON.stringify({...archived,replacementShiftId:next.id})}::jsonb,${input.reason},${req.user.userId})`);
  // No automatic re-offers: eligibility/capacity may have changed. Scheduler selects candidates on new shift.
  await audit(tx,req.user,'shift',id,'Superseded by shift #'+next.id+': '+input.reason);return {id:next.id,cancelledAssignments:active.length};
 });res.status(201).json(result);
}));
router.get('/shifts/:id/history',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id);const result=await db.transaction(async tx=>{const [shift]=await tx.select().from(shifts).where(eq(shifts.id,id));if(!shift)fail(404,'Shift not found');await teamAccess(tx,req.user,shift.teamId,'schedule',shift);const rows=await tx.execute(sql`SELECT version,snapshot,reason,created_at FROM workforce_shift_history WHERE shift_id=${id} ORDER BY version DESC`);return rows.rows;});res.json(result);
}));
router.get('/teams/:teamId/approvals',handle(async(req,res)=>{
 const teamId=positiveId.parse(req.params.teamId),range=reviewWindow(req),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),offset=(page-1)*25;
 const result=await db.transaction(async tx=>{
  const team=await teamAccess(tx,req.user,teamId,'view');
  const expiry=await tx.select({id:grants.id,permission:grants.permission,endAt:grants.endAt}).from(grants).where(and(eq(grants.teamId,teamId),currentGrants(req.user)));
  const time=await hasReviewGrant(req.user,'review_time',teamId,tx)?await tx.select({id:timesheets.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,role:shifts.role,startAt:shifts.startAt,version:timesheets.version}).from(timesheets).innerJoin(assignments,eq(timesheets.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).where(and(eq(teams.id,teamId),withinWindow(range),eq(timesheets.status,'submitted'),otherEmployee(req.user),permissionScope(req.user,'review_time'))).orderBy(timesheets.id).limit(25).offset(offset):[];
  const performance=await hasReviewGrant(req.user,'review_performance',teamId,tx)?await candidateQuery(tx).where(and(eq(teams.id,teamId),withinWindow(range),candidateScope(req.user))).orderBy(assignments.id).limit(25).offset(offset):[];
  const leave=await tx.selectDistinct({id:leaves.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,startDate:leaves.startDate,endDate:leaves.endDate}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id)).innerJoin(members,eq(members.employeeId,employees.id)).where(and(eq(members.teamId,teamId),eq(leaves.status,'pending'),employeeScope(req.user,'leave_absence_management','approve'),or(isNull(employees.userId),ne(employees.userId,req.user.userId)),
   sql`${leaves.startDate}::timestamp at time zone ${team.timezone}<${range.to} AND (${leaves.endDate}::date+1)::timestamp at time zone ${team.timezone}>${range.from}`,
   sql`${members.startAt}<=${leaves.startDate}::timestamp at time zone ${team.timezone} AND ${members.endAt}>=(${leaves.endDate}::date+1)::timestamp at time zone ${team.timezone}`,
   workforceAdmin(req.user.role)?undefined:sql`EXISTS(SELECT 1 FROM workforce_grants WHERE team_id=${teamId} AND ${currentGrants(req.user)} AND start_at<=${leaves.startDate}::timestamp at time zone ${team.timezone} AND end_at>=(${leaves.endDate}::date+1)::timestamp at time zone ${team.timezone})`)).orderBy(leaves.id).limit(25).offset(offset);
  return {time,performance:performance.map(p=>({id:p.assignmentId,employeeName:p.employeeName,role:p.role,startAt:p.startAt})),leave,grants:expiry,page,hasMore:time.length===25||performance.length===25||leave.length===25};
 });res.json(result);
}));

router.get('/teams/:teamId/coverage',handle(async(req,res)=>{
 const teamId=positiveId.parse(req.params.teamId),range=reviewWindow(req),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const result=await db.transaction(async tx=>{
  const team=await teamAccess(tx,req.user,teamId,'schedule');
  const rows=await tx.select().from(shifts).innerJoin(teams,eq(shifts.teamId,teams.id)).where(and(eq(shifts.teamId,teamId),isNull(shifts.cancelledAt),gt(shifts.startAt,new Date()),withinWindow(range),permissionScope(req.user,'schedule'))).orderBy(shifts.startAt,shifts.id).limit(25).offset((page-1)*25);
  const items=[];for(const {workforce_shifts:shift} of rows){
   const staff=await tx.select({id:assignments.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,employeeId:employees.id,status:assignments.status}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).where(and(eq(assignments.shiftId,shift.id),inArray(assignments.status,['offered','accepted'])));
   const warnings=[];for(const a of staff){
    const leave=await tx.execute(sql`SELECT status FROM leaves WHERE employee_id=${a.employeeId} AND status IN ('pending','approved') AND start_date::timestamp at time zone ${team.timezone}<${shift.endAt} AND (end_date::date+1)::timestamp at time zone ${team.timezone}>${shift.startAt} LIMIT 1`);
    const unavailable=await tx.execute(sql`SELECT id FROM workforce_availability WHERE employee_id=${a.employeeId} AND cancelled_at IS NULL AND kind='unavailable' AND start_at<${shift.endAt} AND end_at>${shift.startAt} LIMIT 1`);
    if(leave.rows.length||unavailable.rows.length)warnings.push({assignmentId:a.id,name:a.name,status:a.status,issue:unavailable.rows.length?'Declared unavailable':leave.rows[0].status==='approved'?'Approved absence':'Absence request pending'});
   }items.push({id:shift.id,role:shift.role,startAt:shift.startAt,unfilled:Math.max(0,shift.headcount-staff.filter(a=>a.status==='accepted').length),warnings});
  }return {items,page,hasMore:rows.length===25};
 });res.json(result);
}));
export default router;
