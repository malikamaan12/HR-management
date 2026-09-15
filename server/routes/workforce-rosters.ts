import {Router} from 'express';
import {and, eq, inArray} from 'drizzle-orm';
import {db} from '../db';
import {workforceShifts as shifts, workforceSeries as series, workforceTeams as teams,
  workforceAssignments as assignments, workforceTimesheets as sheets, workforceShiftChanges as changes} from '@shared/schema';
import {positiveId} from '@shared/workforce';
import {recurrenceInput, seriesInput, expandRecurrence, shiftChangeInput, shiftRevisionInput, type Recurrence} from '@shared/workforce-rosters';
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
    const [replacement] = await tx.insert(shifts).values({...details,requiredQualifications, teamId: shift.teamId, seriesId: shift.seriesId, replacesId: id, changeReason: input.reason, createdBy: req.user!.userId}).returning();
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
