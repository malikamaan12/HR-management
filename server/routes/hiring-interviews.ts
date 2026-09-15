import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import { interviews, jobApplications as applications, jobRequisitions as jobs, candidates, employees, users } from '@shared/schema';
import { hasPermission, getAccessScope } from '@shared/permissions';
import { positiveId, reason } from '@shared/hr-rules';
import { handle } from './hr-rules';
import { audit } from '../services/hr-rules';
import { employeeScope } from '../services/access';
import { fail, type WorkforceTransaction } from '../services/workforce';
import type { TokenPayload } from '../services/auth';
const router = Router();
const scope = (u: TokenPayload, write = false) => !hasPermission(u.role, 'recruitment_onboarding', write ? 'update' : 'read') ? sql `false` : getAccessScope(u.role, 'recruitment_onboarding') === 'all' ? sql `true` : getAccessScope(u.role, 'recruitment_onboarding') === 'department' && u.department ? eq(jobs.department, u.department) : sql `false`;
async function application(tx: WorkforceTransaction, user: TokenPayload, id: number) {
    const [row] = await tx.select({ app: applications, job: jobs }).from(applications).innerJoin(jobs, eq(applications.requisitionId, jobs.id)).where(and(eq(applications.id, id), scope(user, true))).for('update', { of: applications });
    if (!row)
        fail(404, 'Application not found within your access');
    return row;
}
router.get('/', handle(async (req, res) => {
    const rows = await db.select({ interview: interviews, candidate: candidates.fullNameEn, jobTitle: jobs.jobTitle, interviewer: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(interviews).innerJoin(applications, eq(interviews.applicationId, applications.id)).innerJoin(jobs, eq(applications.requisitionId, jobs.id)).innerJoin(candidates, eq(applications.candidateId, candidates.id)).innerJoin(employees, eq(interviews.interviewerId, employees.id)).where(scope(req.user!)).orderBy(desc(interviews.interviewDate)).limit(1000);
    const people = await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, role: users.role }).from(employees).innerJoin(users, eq(employees.userId, users.id)).where(and(eq(employees.status, 'active'), eq(users.isActive, true), eq(users.approvalStatus, 'approved'), employeeScope(req.user!, 'recruitment_onboarding', 'update')));
    res.json({ rows, interviewers: people.filter(p => hasPermission(p.role, 'recruitment_onboarding', 'update')).map(({ role, ...p }) => p), canManage: hasPermission(req.user!.role, 'recruitment_onboarding', 'update') });
}));
router.post('/', handle(async (req, res) => {
    const input = z.object({ applicationId: positiveId, version: positiveId, interviewerId: positiveId, interviewDate: z.string().datetime(), interviewType: z.enum(['phone', 'video', 'in-person']), interviewRound: z.enum(['first', 'second', 'final', 'technical', 'hr']), reason }).strict().parse(req.body);
    if (Date.parse(input.interviewDate) < Date.now())
        fail(400, 'Choose a future interview time');
    res.status(201).json(await db.transaction(async (tx) => {
        const { app, job } = await application(tx, req.user!, input.applicationId);
        if (app.version !== input.version)
            fail(409, 'Application changed; refresh');
        if (job.status !== 'open' || !['shortlisted', 'interview'].includes(app.status))
            fail(409, 'Schedule interviews for shortlisted candidates on open requisitions');
        const [owner] = await tx.select({ employee: employees, user: users }).from(employees).innerJoin(users, eq(employees.userId, users.id)).where(and(eq(employees.id, input.interviewerId), employeeScope(req.user!, 'recruitment_onboarding', 'update'))).for('update', { of: employees });
        if (!owner || owner.employee.status !== 'active' || !owner.user.isActive || owner.user.approvalStatus !== 'approved' || !hasPermission(owner.user.role, 'recruitment_onboarding', 'update') || (getAccessScope(owner.user.role, 'recruitment_onboarding') !== 'all' && owner.user.department !== job.department))
            fail(400, 'Choose an active interviewer with recruitment access to this department');
        const [conflict] = await tx.select({ id: interviews.id }).from(interviews).where(and(eq(interviews.interviewerId, input.interviewerId), eq(interviews.status, 'scheduled'), eq(interviews.interviewDate, new Date(input.interviewDate))));
        if (conflict)
            fail(409, 'The interviewer already has an interview at this time');
        const [row] = await tx.insert(interviews).values({ applicationId: app.id, interviewerId: input.interviewerId, interviewDate: new Date(input.interviewDate), interviewType: input.interviewType, interviewRound: input.interviewRound, status: 'scheduled', feedback: input.reason }).returning();
        await tx.update(applications).set({ status: 'interview', updatedAt: new Date() }).where(eq(applications.id, app.id));
        await audit(tx, req.user!, 'interview', row.id, 'Scheduled: ' + input.reason);
        return row;
    }));
}));
router.post('/:id/result', handle(async (req, res) => {
    const input = z.object({ version: positiveId, status: z.enum(['completed', 'cancelled', 'no-show']), rating: z.number().int().min(1).max(5).optional(), recommendation: z.enum(['hire', 'reject', 'hold']).optional(), feedback: reason }).strict().parse(req.body);
    if (input.status === 'completed' && (!input.rating || !input.recommendation))
        fail(400, 'Record a rating and recommendation');
    res.json(await db.transaction(async (tx) => {
        const [row] = await tx.select({ interview: interviews }).from(interviews).innerJoin(applications, eq(interviews.applicationId, applications.id)).innerJoin(jobs, eq(applications.requisitionId, jobs.id)).where(and(eq(interviews.id, positiveId.parse(req.params.id)), scope(req.user!, true))).for('update', { of: interviews });
        if (!row)
            fail(404, 'Interview not found within your access');
        const previous = row.interview;
        if (previous.version !== input.version || previous.status !== 'scheduled')
            fail(409, 'Interview changed or already decided');
        if (input.status !== 'cancelled' && +previous.interviewDate > Date.now())
            fail(409, 'Record results after the scheduled interview time');
        const [saved] = await tx.update(interviews).set({ status: input.status, rating: input.status === 'completed' ? input.rating : null, recommendation: input.status === 'completed' ? input.recommendation : null, feedback: input.feedback, updatedAt: new Date() }).where(eq(interviews.id, previous.id)).returning();
        await audit(tx, req.user!, 'interview', saved.id, JSON.stringify({ action: 'Interview result', previous, current: saved }));
        return saved;
    }));
}));
export default router;
