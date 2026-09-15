import { Router } from 'express';
import { clockStatus } from '../services/attendance';
import { z } from 'zod';
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { attendance, attendanceCorrections, employees, leaves, workforceAssignments, workforceShifts, workforceTeams, workforceSites } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { civilDate, positiveId, reason, dayAt } from '@shared/hr-rules';
import { employeeScope } from '../services/access';
import { scopedEmployee, attendancePolicy, audit } from '../services/hr-rules';
import { fail } from '../services/workforce';
import { siteTimeToIso } from '@shared/workforce';
import { hasPermission } from '@shared/permissions';
const router = Router();
router.use(authenticate);
const proposalSchema = z.object({ employeeId: positiveId, date: civilDate, expectedVersion: z.number().int().min(0), checkIn: z.string().datetime(), checkOut: z.string().datetime(), breakMinutes: z.number().int().min(0).max(1439), reason }).strict();
router.get('/options', handle(async (req, res) => res.json(await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, own: sql<boolean> `${employees.userId}=${req.user!.userId}` }).from(employees).where(employeeScope(req.user!, 'attendance_time_tracking')).orderBy(employees.id).limit(1000))));
router.get('/day/:employeeId/:date', handle(async (req, res) => {
    const id = positiveId.parse(req.params.employeeId), date = civilDate.parse(req.params.date);
    res.json(await db.transaction(async (tx) => {
        const e = await scopedEmployee(tx, req.user!, id, 'attendance_time_tracking');
        const policy = await attendancePolicy(tx, e, date);
        const [record] = await tx.select().from(attendance).where(and(eq(attendance.employeeId, id), eq(attendance.date, date)));
        const shifts = await tx.select({ assignmentId: workforceAssignments.id, startAt: workforceShifts.startAt, endAt: workforceShifts.endAt, breakMinutes: workforceShifts.breakMinutes, role: workforceShifts.role, timezone: workforceSites.timezone, team: workforceTeams.name }).from(workforceAssignments).innerJoin(workforceShifts, eq(workforceAssignments.shiftId, workforceShifts.id)).innerJoin(workforceTeams, eq(workforceShifts.teamId, workforceTeams.id)).innerJoin(workforceSites, eq(workforceTeams.siteId, workforceSites.id)).where(and(eq(workforceAssignments.employeeId, id), eq(workforceAssignments.status, 'accepted'), gte(workforceShifts.startAt, new Date(Date.parse(date) - 86400000)), lte(workforceShifts.startAt, new Date(Date.parse(date) + 2 * 86400000))));
        const roster = shifts.filter(s => dayAt(s.startAt, s.timezone) === date), holiday = policy.holidays.find(h => h.date === date);
        const planned = roster.length ? roster.reduce((s, r) => s + (+r.endAt - +r.startAt) / 60000 - r.breakMinutes, 0) : e.workSchedule !== 'shift_based' && policy.hasSchedule && !holiday && policy.workingDays.includes(new Date(date).getUTCDay()) ? (Date.parse(siteTimeToIso(date + 'T' + policy.endTime, policy.timezone)) - Date.parse(siteTimeToIso(date + 'T' + policy.startTime, policy.timezone))) / 60000 - policy.breakMinutes : 0;
        return { employeeId: id, date, record: record || null, policy, roster, holiday: holiday?.name || null, plannedMinutes: planned, varianceMinutes: record?.totalWorkHours != null ? record.totalWorkHours - planned : null };
    }));
}));
router.get('/corrections', handle(async (req, res) => { const rows = await db.select({ correction: attendanceCorrections, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, owner: employees.userId }).from(attendanceCorrections).innerJoin(employees, eq(attendanceCorrections.employeeId, employees.id)).where(employeeScope(req.user!, 'attendance_time_tracking')).orderBy(desc(attendanceCorrections.id)).limit(500); res.json(rows.map(({ correction, name, owner }) => ({ ...correction, name, canDecide: hasPermission(req.user!.role, 'attendance_time_tracking', 'approve') && owner !== req.user!.userId && correction.requestedBy !== req.user!.userId }))); }));
router.post('/corrections', handle(async (req, res) => {
    const input = proposalSchema.parse(req.body), minutes = (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 60000;
    if (minutes <= 0 || minutes > 1440 || !Number.isInteger(minutes) || input.breakMinutes >= minutes || Date.parse(input.checkOut) > Date.now())
        fail(400, 'Enter completed work of up to 24 hours with shorter breaks');
    res.status(201).json(await db.transaction(async (tx) => { const e = await scopedEmployee(tx, req.user!, input.employeeId, 'attendance_time_tracking', 'read', true); if (e.userId !== req.user!.userId && !hasPermission(req.user!.role, 'attendance_time_tracking', 'update'))
        fail(403, 'You cannot request a correction for this employee'); const policy = await attendancePolicy(tx, e, input.date); if (dayAt(new Date(input.checkIn), policy.timezone) !== input.date)
        fail(400, 'Check-in must match the attendance date in the employee timezone'); if (input.date < e.joiningDate || (e.contractEndDate && input.date > e.contractEndDate) || (e.terminationDate && input.date > e.terminationDate))
        fail(400, 'Attendance must fall within employment dates'); const [record] = await tx.select().from(attendance).where(and(eq(attendance.employeeId, e.id), eq(attendance.date, input.date))); if ((record?.version || 0) !== input.expectedVersion)
        fail(409, 'Attendance changed; reload before requesting a correction'); const [pending] = await tx.select({ id: attendanceCorrections.id }).from(attendanceCorrections).where(and(eq(attendanceCorrections.employeeId, e.id), eq(attendanceCorrections.date, input.date), eq(attendanceCorrections.status, 'pending'))); if (pending)
        fail(409, 'A correction is already awaiting review'); const [row] = await tx.insert(attendanceCorrections).values({ employeeId: e.id, date: input.date, expectedVersion: input.expectedVersion, proposal: { checkIn: input.checkIn, checkOut: input.checkOut, breakMinutes: input.breakMinutes, policy }, before: record || null, reason: input.reason, requestedBy: req.user!.userId }).returning(); await audit(tx, req.user!, 'attendance_correction', row.id, 'Correction submitted'); return row; }));
}));
router.post('/corrections/:id/review', handle(async (req, res) => {
    const id = positiveId.parse(req.params.id), input = z.object({ decision: z.enum(['approved', 'rejected']), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const [initial] = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id));
        if (!initial)
            fail(404, 'Correction not found');
        const e = await scopedEmployee(tx, req.user!, initial.employeeId, 'attendance_time_tracking', 'approve', true);
        const [row] = await tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)).for('update');
        if (row.status !== 'pending')
            fail(409, 'This correction has already been decided');
        if (row.requestedBy === req.user!.userId || e.userId === req.user!.userId)
            fail(403, 'Another approver must review this correction');
        if (input.decision === 'approved') {
            const [record] = await tx.select().from(attendance).where(and(eq(attendance.employeeId, e.id), eq(attendance.date, row.date)));
            if ((record?.version || 0) !== row.expectedVersion)
                fail(409, 'Attendance changed; reject this correction and request a fresh one');
            const [leave] = await tx.select({ id: leaves.id }).from(leaves).where(and(eq(leaves.employeeId, e.id), eq(leaves.status, 'approved'), lte(leaves.startDate, row.date), gte(leaves.endDate, row.date)));
            if (leave)
                fail(409, 'Resolve approved leave before recording worked time');
            const p = row.proposal as {
                checkIn: string;
                checkOut: string;
                breakMinutes: number;
            };
            const value = { checkIn: new Date(p.checkIn), checkOut: new Date(p.checkOut), totalBreakMinutes: p.breakMinutes, totalWorkHours: (Date.parse(p.checkOut) - Date.parse(p.checkIn)) / 60000 - p.breakMinutes, breakStartTime: null, breakEndTime: null, checkInMethod: 'manual' as const, checkOutMethod: 'manual' as const, status: await clockStatus(tx, e, row.date, new Date(p.checkIn), (row.proposal as any).policy || await attendancePolicy(tx, e, row.date)), notes: row.reason, updatedAt: new Date() };
            if (record)
                await tx.update(attendance).set(value).where(eq(attendance.id, record.id));
            else
                await tx.insert(attendance).values({ ...value, employeeId: e.id, date: row.date });
        }
        const [saved] = await tx.update(attendanceCorrections).set({ status: input.decision, reviewedBy: req.user!.userId, reviewNote: input.reason, reviewedAt: new Date() }).where(eq(attendanceCorrections.id, id)).returning();
        await audit(tx, req.user!, 'attendance_correction', id, `${input.decision}: ${input.reason}`);
        return saved;
    }));
}));
export default router;
