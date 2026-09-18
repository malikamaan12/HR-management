import {Router} from 'express';
import {and, eq, inArray, gt, sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {workforceShifts as shifts, workforceSeries as series, workforceTeams as teams,
  workforceAssignments as assignments, workforceTimesheets as sheets, workforceShiftChanges as changes} from '@shared/schema';
import {positiveId,localDate,shiftInput,siteTimeToIso} from '@shared/workforce';
import {civilDate} from '@shared/hr-rules';
import {recurrenceInput, seriesInput, expandRecurrence, shiftChangeInput, shiftRevisionInput, seriesChangeInput,seriesRevisionInput,type Recurrence} from '@shared/workforce-rosters';
import {teamAccess, fail, audit, eligible, lockEmployee, resolveQualifications, type WorkforceTransaction} from '../services/workforce';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';
import {assertNoRecordedArrival} from '../services/workforce-operations';

// Mounted after the parent workforce authentication middleware.
const router = Router();
function occurrences(input: Recurrence, timezone: string) {
  try {return expandRecurrence(input, timezone);}
  catch(e) {return fail(400, e instanceof Error ? e.message : 'Invalid recurrence');}
}
async function checkOccurrences(tx: WorkforceTransaction, user: TokenPayload, teamId: number, rows: ReturnType<typeof occurrences>) {
  for(const row of rows) {
    if(row.startAt <= new Date()) fail(400, 'Every occurrence must start in the future');
    await teamAccess(tx, user, teamId, 'schedule', row);
  }
}
router.post('/teams/:teamId/series/preview', handle(async(req,res) => {
  const teamId = positiveId.parse(req.params.teamId), input = recurrenceInput.parse(req.body);
  res.json(await db.transaction(async tx => {
    const team = await teamAccess(tx, req.user!, teamId, 'schedule');
    const rows = occurrences(input, team.timezone);
    await checkOccurrences(tx, req.user!, teamId, rows);
    const requiredQualifications=await resolveQualifications(tx,input.qualificationIds);
    return {timezone: team.timezone, shifts: rows,requiredQualifications};
  }));
}));
router.post('/teams/:teamId/series', handle(async(req,res) => {
  const teamId = positiveId.parse(req.params.teamId), input = seriesInput.parse(req.body);
  const result = await db.transaction(async tx => {
    // A team lock serializes duplicate batch submissions before inserting any shifts.
    await tx.select({id: teams.id}).from(teams).where(eq(teams.id, teamId)).for('update');
    const team = await teamAccess(tx, req.user!, teamId, 'schedule');
    const [existing] = await tx.select().from(series).where(and(eq(series.teamId, teamId), eq(series.requestKey, input.requestKey)));
    if(existing) {
      if(existing.createdBy !== req.user!.userId || JSON.stringify(recurrenceInput.parse(existing.definition)) !== JSON.stringify(input.recurrence))
        fail(409, 'This request key was already used for different shifts');
      const rows = await tx.select().from(shifts).where(eq(shifts.seriesId, existing.id)).orderBy(shifts.startAt, shifts.id);
      for(const row of rows) await teamAccess(tx, req.user!, teamId, 'schedule', row);
      return {id: existing.id, shifts: rows, replayed: true};
    }
    const rows = occurrences(input.recurrence, team.timezone);
    await checkOccurrences(tx, req.user!, teamId, rows);
    const requiredQualifications=await resolveQualifications(tx,input.recurrence.qualificationIds);
    const [batch] = await tx.insert(series).values({teamId, requestKey: input.requestKey, definition: input.recurrence, timezone: team.timezone, createdBy: req.user!.userId}).returning();
    const saved = await tx.insert(shifts).values(rows.map(row => ({...row, requiredQualifications,teamId, seriesId: batch.id, createdBy: req.user!.userId}))).returning();
    await audit(tx, req.user!, 'series', batch.id, `${saved.length} recurring shifts created in ${team.timezone}`);
    return {id: batch.id, shifts: saved, replayed: false};
  });
  res.status(result.replayed ? 200 : 201).json(result);
}));

async function seriesTargets(tx:WorkforceTransaction,user:TokenPayload,id:number,fromDate:string,lock=false){
  const [batch]=await tx.select().from(series).where(eq(series.id,id));if(!batch)fail(404,'Recurring roster not found');
  const team=await teamAccess(tx,user,batch.teamId,'schedule');
  const current=(await tx.execute(sql`SELECT version FROM workforce_series WHERE id=${id} ${lock?sql`FOR UPDATE`:sql``}`)).rows[0];
  const query=tx.select().from(shifts).where(and(eq(shifts.seriesId,id),eq(shifts.status,'scheduled'),gt(shifts.startAt,new Date()))).orderBy(shifts.id);
  const candidates=lock?await query.for('update'):await query;
  const rows=candidates.filter(s=>localDate(s.startAt,team.timezone)>=fromDate);
  for(const row of rows)await teamAccess(tx,user,batch.teamId,'schedule',row);
  return {batch,team,rows,version:Number(current.version)};
}
router.get('/series/:id',handle(async(req,res)=>{
  const id=positiveId.parse(req.params.id),fromDate=civilDate.parse(req.query.fromDate||localDate(new Date(),'Asia/Qatar'));
  res.json(await db.transaction(async tx=>{
    const {team,rows,version}=await seriesTargets(tx,req.user!,id,fromDate);
    const counts=rows.length?await tx.select({shiftId:assignments.shiftId,count:sql<number>`count(*)::integer`}).from(assignments).where(and(inArray(assignments.shiftId,rows.map(s=>s.id)),inArray(assignments.status,['offered','accepted']))).groupBy(assignments.shiftId):[];
    const saved=(await tx.execute(sql`SELECT version,reason,created_at,snapshot FROM hr_workflow_history WHERE kind='workforce_series' AND record_id=${id} ORDER BY version DESC LIMIT 25`)).rows;
    return {id,version,timezone:team.timezone,fromDate,shifts:rows.map(s=>({...s,activeCount:counts.find(c=>c.shiftId===s.id)?.count||0})),history:saved};
  }));
}));
async function changeSeries(req:any,revise:boolean){
  const id=positiveId.parse(req.params.id),revision=revise?seriesRevisionInput.parse(req.body):null,input=revision||seriesChangeInput.parse(req.body);
  return db.transaction(async tx=>{
    const {team,rows,version}=await seriesTargets(tx,req.user,id,input.fromDate,true);
    if(version!==input.version||rows.length!==input.expectedShifts.length||rows.some(s=>!input.expectedShifts.some(e=>e.id===s.id&&e.version===s.version)))fail(409,'Recurring roster changed; reload the future occurrences before saving');
    if(!rows.length)fail(409,'No future scheduled occurrences remain in this date range');
    const roster=await tx.select().from(assignments).where(inArray(assignments.shiftId,rows.map(s=>s.id))).orderBy(assignments.employeeId,assignments.id).for('update');
    for(const employeeId of [...new Set(roster.map(a=>a.employeeId))].sort((a,b)=>a-b))await lockEmployee(tx,employeeId);
    for(const shift of rows){await assertNoRecordedArrival(tx,shift.id);if(shift.startAt<=new Date())fail(409,'An occurrence has started; reload the remaining future shifts');}
    const [reported]=await tx.select({id:sheets.id}).from(sheets).innerJoin(assignments,eq(sheets.assignmentId,assignments.id)).where(inArray(assignments.shiftId,rows.map(s=>s.id))).limit(1);
    if(reported)fail(409,'A selected occurrence has reported or payroll-linked time and cannot be changed in a series batch');
    if(revise&&roster.some(a=>a.replacesAssignmentId&&a.status==='offered'))fail(409,'Finish or cancel pending replacement offers before revising the series');
    const active=roster.filter(a=>['accepted','offered'].includes(a.status));
    const definitions=new Map<number,z.infer<typeof shiftInput>>();
    let requiredQualifications:Awaited<ReturnType<typeof resolveQualifications>>=[];
    if(revision){
      const d=revision.details;requiredQualifications=await resolveQualifications(tx,d.qualificationIds);
      for(const shift of rows){
        const day=localDate(shift.startAt,team.timezone),endDay=new Date(Date.parse(day+'T12:00:00Z')+d.endDayOffset*86400000).toISOString().slice(0,10);
        const details=shiftInput.parse({role:d.role,station:d.station,headcount:d.headcount,breakMinutes:d.breakMinutes,startAt:siteTimeToIso(`${day}T${d.startTime}`,team.timezone),endAt:siteTimeToIso(`${endDay}T${d.endTime}`,team.timezone)});
        if(details.startAt<=new Date())fail(400,'Every revised occurrence must still start in the future');
        await teamAccess(tx,req.user,shift.teamId,'schedule',details);definitions.set(shift.id,details);
      }
      if(rows.every(s=>{const d=definitions.get(s.id)!;return s.role===d.role&&(s.station||'')===(d.station||'')&&s.headcount===d.headcount&&s.breakMinutes===d.breakMinutes&&+s.startAt===+d.startAt&&+s.endAt===+d.endAt&&JSON.stringify(s.requiredQualifications)===JSON.stringify(requiredQualifications);}))fail(400,'Change at least one shift detail before revising the series');
      // Reoffered assignments must not overlap each other after applying the common hours.
      for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++)if(active[i].employeeId===active[j].employeeId){const a=definitions.get(active[i].shiftId)!,b=definitions.get(active[j].shiftId)!;if(a.startAt<b.endAt&&b.startAt<a.endAt)fail(409,'The revised series would offer overlapping shifts to the same employee');}
    }
    if(active.length)await tx.update(assignments).set({status:'cancelled',cancellationReason:`Recurring roster ${revise?'revised':'cancelled'}: ${input.reason}`,respondedAt:new Date()}).where(inArray(assignments.id,active.map(a=>a.id)));
    const replacements:number[]=[];
    for(const shift of rows){
      const prior=roster.filter(a=>a.shiftId===shift.id);let replacementId:number|null=null;
      if(revise){
        const [replacement]=await tx.insert(shifts).values({...definitions.get(shift.id)!,requiredQualifications,requiredSkills:shift.requiredSkills,teamId:shift.teamId,seriesId:id,replacesId:shift.id,changeReason:input.reason,createdBy:req.user.userId}).returning();replacementId=replacement.id;replacements.push(replacement.id);
        for(const assignment of active.filter(a=>a.shiftId===shift.id)){await eligible(tx,assignment.employeeId,replacement,team.timezone);const [offer]=await tx.insert(assignments).values({shiftId:replacement.id,employeeId:assignment.employeeId,createdBy:req.user.userId}).returning();await audit(tx,req.user,'assignment',offer.id,`Recurring revision reoffered from ${assignment.id}: ${input.reason}`);}
      }
      await tx.update(shifts).set({status:revise?'replaced':'cancelled',replacementId,changeReason:input.reason}).where(eq(shifts.id,shift.id));
      await tx.insert(changes).values({shiftId:shift.id,actorId:req.user.userId,reason:input.reason,snapshot:{shift,assignments:prior,replacementId,seriesId:id}});
    }
    await tx.execute(sql`UPDATE workforce_series SET version=version+1 WHERE id=${id}`);
    const snapshot={action:revise?'revised':'cancelled',fromDate:input.fromDate,shiftIds:rows.map(s=>s.id),replacementIds:replacements,offers:revise?active.length:0,...(revision?{details:revision.details}:{})};
    await tx.execute(sql`INSERT INTO hr_workflow_history(kind,record_id,version,snapshot,actor_id,reason) VALUES ('workforce_series',${id},${version+1},${JSON.stringify(snapshot)}::jsonb,${req.user.userId},${input.reason})`);
    await audit(tx,req.user,'series',id,`${snapshot.action} ${rows.length} future occurrences: ${input.reason}`);
    return {id,version:version+1,changed:rows.length,offers:revise?active.length:0};
  });
}
router.post('/series/:id/revise',handle(async(req,res)=>res.json(await changeSeries(req,true))));
router.post('/series/:id/cancel',handle(async(req,res)=>res.json(await changeSeries(req,false))));

async function editableShift(tx: WorkforceTransaction, user: TokenPayload, id: number, version: number) {
  const [shift] = await tx.select().from(shifts).where(eq(shifts.id, id)).for('update');
  if(!shift) return fail(404, 'Shift not found');
  const team = await teamAccess(tx, user, shift.teamId, 'schedule', shift);
  if(shift.version !== version) fail(409, 'This shift changed. Refresh and review its latest status.');
  if(shift.status !== 'scheduled' || shift.startAt <= new Date()) fail(409, 'Only future scheduled shifts can be changed');
  await assertNoRecordedArrival(tx,id);
  const roster = await tx.select().from(assignments).where(eq(assignments.shiftId, id)).orderBy(assignments.employeeId).for('update');
  // Match employee-based leave/employment serialization while locking in a stable order.
  for(const row of roster) await lockEmployee(tx, row.employeeId);
  const [reported] = await tx.select({id: sheets.id}).from(sheets).innerJoin(assignments, eq(sheets.assignmentId, assignments.id)).where(eq(assignments.shiftId, id)).limit(1);
  if(reported) fail(409, 'A shift with reported time cannot be revised or cancelled');
  return {shift, team, roster};
}
router.post('/shifts/:id/revise', handle(async(req,res) => {
  const id = positiveId.parse(req.params.id), input = shiftRevisionInput.parse(req.body);
  const result = await db.transaction(async tx => {
    const {shift, team, roster} = await editableShift(tx, req.user!, id, input.version);
    if(input.shift.startAt <= new Date()) fail(400, 'The revised shift must start in the future');
    await teamAccess(tx, req.user!, shift.teamId, 'schedule', input.shift);
    if(roster.some(a=>a.replacesAssignmentId&&a.status==='offered'))fail(409,'Cancel or finish pending replacement offers before revising this shift');
    const {qualificationIds,...details}=input.shift;
    const requiredQualifications=qualificationIds===undefined?shift.requiredQualifications:await resolveQualifications(tx,qualificationIds);
    if(shift.role === input.shift.role && (shift.station || '') === (input.shift.station || '') && shift.headcount === input.shift.headcount && shift.breakMinutes === input.shift.breakMinutes && +shift.startAt === +input.shift.startAt && +shift.endAt === +input.shift.endAt&&JSON.stringify(requiredQualifications)===JSON.stringify(shift.requiredQualifications))
      fail(400, 'Change at least one shift detail before creating a revision');
    const active = roster.filter(a => ['offered','accepted'].includes(a.status));
    if(active.length) await tx.update(assignments).set({status: 'cancelled', cancellationReason: 'Shift revised: ' + input.reason, respondedAt: new Date()}).where(inArray(assignments.id, active.map(a => a.id)));
    const [replacement] = await tx.insert(shifts).values({...details,requiredQualifications,requiredSkills:shift.requiredSkills, teamId: shift.teamId, seriesId: shift.seriesId, replacesId: id, changeReason: input.reason, createdBy: req.user!.userId}).returning();
    for(const row of active) {
      await eligible(tx, row.employeeId, replacement, team.timezone);
      const [offer] = await tx.insert(assignments).values({shiftId: replacement.id, employeeId: row.employeeId, createdBy: req.user!.userId}).returning();
      await audit(tx, req.user!, 'assignment', offer.id, `Revised shift offered; replaces assignment ${row.id}: ${input.reason}`);
    }
    await tx.update(shifts).set({status: 'replaced', replacementId: replacement.id, changeReason: input.reason}).where(eq(shifts.id, id));
    await tx.insert(changes).values({shiftId: id, actorId: req.user!.userId, reason: input.reason, snapshot: {shift, assignments: roster, replacementId: replacement.id}});
    await audit(tx, req.user!, 'shift', id, `Replaced by shift ${replacement.id}; ${active.length} employees must respond again: ${input.reason}`);
    return {shift: replacement, offers: active.length};
  });
  res.status(201).json(result);
}));
router.post('/shifts/:id/cancel', handle(async(req,res) => {
  const id = positiveId.parse(req.params.id), input = shiftChangeInput.parse(req.body);
  await db.transaction(async tx => {
    const {shift, roster} = await editableShift(tx, req.user!, id, input.version);
    await tx.update(assignments).set({status: 'cancelled', cancellationReason: input.reason, respondedAt: new Date()}).where(and(eq(assignments.shiftId, id), inArray(assignments.status, ['offered','accepted'])));
    await tx.update(shifts).set({status: 'cancelled', changeReason: input.reason}).where(eq(shifts.id, id));
    await tx.insert(changes).values({shiftId: id, actorId: req.user!.userId, reason: input.reason, snapshot: {shift, assignments: roster}});
    await audit(tx, req.user!, 'shift', id, 'Shift cancelled: ' + input.reason);
  });
  res.json({success: true});
}));
export default router;
