import candidateCorrections from './candidateCorrections';
import { Router } from 'express';
import interviewRouter from './hiring-interviews';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, desc, sql, or, inArray } from 'drizzle-orm';
import { db } from '../db';
import { jobRequisitions as jobs, jobApplications as applications, jobOffers as offers, candidates, employees, interviews, hiringHandoffs, activityLogs } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { positiveId, civilDate, reason } from '@shared/hr-rules';
import { employeeWriteFields, checkEmploymentDates } from '@shared/employee-records';
import { validateManagers } from './employeeRecords';
import { createLifecycle } from './lifecycle';
import { audit, businessToday } from '../services/hr-rules';
import { fail, type WorkforceTransaction } from '../services/workforce';
import { getAccessScope, hasPermission, type Permission } from '@shared/permissions';
import type { TokenPayload } from '../services/auth';
const router = Router();
router.use(authenticate);
router.use(candidateCorrections);
router.use('/interviews', interviewRouter);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const scope = (u: TokenPayload, p: Permission = 'read') => !hasPermission(u.role, 'recruitment_onboarding', p) ? sql `false` : getAccessScope(u.role, 'recruitment_onboarding') === 'all' ? sql `true` : getAccessScope(u.role, 'recruitment_onboarding') === 'department' && u.department ? eq(jobs.department, u.department) : sql `false`;
async function requester(tx: WorkforceTransaction, user: TokenPayload) { const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.userId)); if (!e)
    fail(409, 'Link your account to an employee profile before creating requisitions or offers'); return e.id; }
async function getJob(tx: WorkforceTransaction, user: TokenPayload, id: number, p: Permission = 'read') { const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, id), scope(user, p))).for('update'); if (!job)
    fail(404, 'Requisition not found within your access'); return job; }
const version = (row: {
    version: number;
}, expected: number) => { if (row.version !== expected)
    fail(409, 'This record changed; refresh before continuing'); };
router.get('/', handle(async (req, res) => { const jobRows = await db.select().from(jobs).where(scope(req.user!)).orderBy(desc(jobs.id)).limit(500); const appRows = await db.select({ application: applications, candidate: { id: candidates.id, fullNameEn: candidates.fullNameEn, email: candidates.email, phone: candidates.phone }, jobTitle: jobs.jobTitle, department: jobs.department }).from(applications).innerJoin(jobs, eq(applications.requisitionId, jobs.id)).innerJoin(candidates, eq(applications.candidateId, candidates.id)).where(scope(req.user!)).orderBy(desc(applications.id)).limit(1000); const offerRows = await db.select({ offer: offers, candidateName: candidates.fullNameEn, jobTitle: jobs.jobTitle, employeeId: hiringHandoffs.employeeId }).from(offers).innerJoin(applications, eq(offers.applicationId, applications.id)).innerJoin(jobs, eq(applications.requisitionId, jobs.id)).innerJoin(candidates, eq(applications.candidateId, candidates.id)).leftJoin(hiringHandoffs, eq(offers.id, hiringHandoffs.offerId)).where(scope(req.user!)).orderBy(desc(offers.id)).limit(1000); res.json({ jobs: jobRows, applications: appRows, offers: offerRows, canCreate: hasPermission(req.user!.role, 'recruitment_onboarding', 'create'), canApprove: hasPermission(req.user!.role, 'recruitment_onboarding', 'approve'), canHandoff: ['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role) }); }));
router.post('/jobs', handle(async (req, res) => {
    const input = z.object({ jobTitle: z.string().trim().min(1).max(200), department: z.string().trim().min(1).max(150), location: z.string().trim().min(1).max(150), positionType: z.enum(['permanent', 'temporary', 'contract']), numberOfVacancies: z.number().int().min(1).max(1000), jobDescription: reason, qualifications: reason, responsibilities: reason, requiredSkills: reason }).strict().parse(req.body);
    if (!hasPermission(req.user!.role, 'recruitment_onboarding', 'create') || (getAccessScope(req.user!.role, 'recruitment_onboarding') !== 'all' && input.department !== req.user!.department))
        fail(403, 'You cannot create requisitions for this department');
    res.status(201).json(await db.transaction(async (tx) => { const requestedBy = await requester(tx, req.user!); const [row] = await tx.insert(jobs).values({ ...input, requisitionId: 'JR-' + randomUUID(), requestedBy, status: 'draft' }).returning(); await audit(tx, req.user!, 'requisition', row.id, 'Created draft requisition'); return row; }));
}));
router.post('/jobs/:id/action', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), status: z.enum(['pending_approval', 'approved', 'open', 'on_hold', 'closed', 'cancelled']), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => { const job = await getJob(tx, req.user!, positiveId.parse(req.params.id), input.status === 'approved' ? 'approve' : 'update'); version(job, input.version); const allowed: Record<string, string[]> = { draft: ['pending_approval', 'cancelled'], pending_approval: ['approved', 'cancelled'], approved: ['open', 'cancelled'], open: ['on_hold', 'closed', 'cancelled'], on_hold: ['open', 'closed', 'cancelled'] }; if (!allowed[job.status]?.includes(input.status))
        fail(409, 'Invalid requisition transition'); const actor = await requester(tx, req.user!); if (input.status === 'approved' && job.requestedBy === actor)
        fail(403, 'Another approver must approve the requisition'); const [row] = await tx.update(jobs).set({ status: input.status, ...(input.status === 'approved' ? { approvedBy: actor, approvedAt: new Date() } : {}), updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning(); await audit(tx, req.user!, 'requisition', row.id, input.status + ': ' + input.reason); return row; }));
}));
router.post('/applications', handle(async (req, res) => {
    const input = z.object({ requisitionId: positiveId, fullNameEn: z.string().trim().min(1).max(200), email: z.string().trim().email().max(250), phone: z.string().trim().min(1).max(100), source: z.enum(['job_board', 'company_website', 'referral', 'internal', 'linkedin', 'social_media', 'other']) }).strict().parse(req.body);
    res.status(201).json(await db.transaction(async (tx) => { const job = await getJob(tx, req.user!, input.requisitionId, 'create'); if (job.status !== 'open')
        fail(409, 'Open the requisition before adding applicants'); const [duplicate] = await tx.select({ id: applications.id }).from(applications).innerJoin(candidates, eq(applications.candidateId, candidates.id)).where(and(eq(applications.requisitionId, job.id), sql `lower(${candidates.email})=lower(${input.email})`)); if (duplicate)
        fail(409, 'This email already has an application for the requisition'); const [candidate] = await tx.insert(candidates).values({ fullNameEn: input.fullNameEn, email: input.email, phone: input.phone, source: input.source }).returning(); const [row] = await tx.insert(applications).values({ candidateId: candidate.id, requisitionId: job.id, applicationDate: businessToday(), status: 'new' }).returning(); await audit(tx, req.user!, 'application', row.id, 'Candidate application created'); return row; }));
}));
router.post('/applications/:id/action', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), status: z.enum(['screening', 'shortlisted', 'interview', 'rejected']), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => { const [app] = await tx.select().from(applications).where(eq(applications.id, positiveId.parse(req.params.id))).for('update'); if (!app)
        fail(404, 'Application not found'); await getJob(tx, req.user!, app.requisitionId, 'update'); version(app, input.version); const transitions: Record<string, string[]> = { new: ['screening', 'rejected'], screening: ['shortlisted', 'rejected'], shortlisted: ['interview', 'rejected'], interview: ['rejected'] }; if (!transitions[app.status]?.includes(input.status))
        fail(409, 'Invalid application transition'); const [row] = await tx.update(applications).set({ status: input.status, screeningNotes: input.reason, ...(input.status === 'rejected' ? { rejectionReason: input.reason } : {}), updatedAt: new Date() }).where(eq(applications.id, app.id)).returning(); await audit(tx, req.user!, 'application', app.id, input.status); return row; }));
}));
router.post('/offers', handle(async (req, res) => {
    const input = z.object({ applicationId: positiveId, version: z.number().int().positive(), salary: z.number().int().min(0).max(1000000000), currency: z.string().regex(/^[A-Z]{3}$/), startDate: civilDate, expiryDate: civilDate, reason }).strict().parse(req.body);
    if (input.expiryDate < businessToday() || input.startDate < input.expiryDate)
        fail(400, 'Offer expiry must be today or later and on or before joining');
    res.status(201).json(await db.transaction(async (tx) => { const [app] = await tx.select().from(applications).where(eq(applications.id, input.applicationId)).for('update'); if (!app)
        fail(404, 'Application not found'); const job = await getJob(tx, req.user!, app.requisitionId, 'approve'); version(app, input.version); if (job.status !== 'open' || !['shortlisted', 'interview'].includes(app.status))
        fail(409, 'Offers require an open job and shortlisted or interviewed candidate'); const [active] = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.applicationId, app.id), inArray(offers.status, ['pending', 'accepted']))); if (active)
        fail(409, 'An active offer already exists'); const [row] = await tx.insert(offers).values({ applicationId: app.id, salary: input.salary, currency: input.currency, startDate: input.startDate, expiryDate: input.expiryDate, offerDate: businessToday(), status: 'pending', createdBy: await requester(tx, req.user!) }).returning(); await tx.update(applications).set({ status: 'offer', updatedAt: new Date() }).where(eq(applications.id, app.id)); await audit(tx, req.user!, 'offer', row.id, 'Offer issued: ' + input.reason); return row; }));
}));
router.post('/offers/:id/action', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), status: z.enum(['accepted', 'declined', 'expired']), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => { const [offer] = await tx.select().from(offers).where(eq(offers.id, positiveId.parse(req.params.id))).for('update'); if (!offer)
        fail(404, 'Offer not found'); const [app] = await tx.select().from(applications).where(eq(applications.id, offer.applicationId)); await getJob(tx, req.user!, app.requisitionId, 'update'); version(offer, input.version); if (offer.status !== 'pending')
        fail(409, 'Offer already decided'); if (input.status === 'accepted' && offer.expiryDate < businessToday())
        fail(409, 'The offer has expired'); if (input.status === 'expired' && offer.expiryDate >= businessToday())
        fail(409, 'This offer has not expired'); const [row] = await tx.update(offers).set({ status: input.status, acceptanceDate: input.status === 'accepted' ? businessToday() : null, declineReason: input.status === 'declined' ? input.reason : null, updatedAt: new Date() }).where(eq(offers.id, offer.id)).returning(); if (input.status !== 'accepted')
        await tx.update(applications).set({ status: 'shortlisted', updatedAt: new Date() }).where(eq(applications.id, app.id)); await audit(tx, req.user!, 'offer', offer.id, 'Recorded candidate response: ' + input.status + '; ' + input.reason); return row; }));
}));
router.post('/offers/:id/handoff', handle(async (req, res) => {
    if (!['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role))
        fail(403, 'HR administrator access is required to create employees');
    const input = z.object({ version: z.number().int().positive(), employee: employeeWriteFields, templateId: positiveId, ownerId: positiveId, reason }).strict().parse(req.body);
    const err = checkEmploymentDates(input.employee);
    if (err)
        fail(400, err);
    res.status(201).json(await db.transaction(async (tx) => { const id = positiveId.parse(req.params.id); await tx.execute(sql `LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE`); const [offer] = await tx.select().from(offers).where(eq(offers.id, id)).for('update'); if (!offer)
        fail(404, 'Offer not found'); const [app] = await tx.select().from(applications).where(eq(applications.id, offer.applicationId)).for('update'); const job = await getJob(tx, req.user!, app.requisitionId, 'update'); const [existing] = await tx.select().from(hiringHandoffs).where(eq(hiringHandoffs.offerId, id)); if (existing)
        return existing; version(offer, input.version); if (offer.status !== 'accepted' || app.status === 'hired')
        fail(409, 'Only an accepted, unconverted offer can become an employee'); if (input.employee.department !== job.department || input.employee.type !== job.positionType || input.employee.joiningDate !== offer.startDate)
        fail(400, 'Employee department, employment type and joining date must match the accepted offer'); const [count] = await tx.select({ total: sql<number> `count(*)::int` }).from(applications).where(and(eq(applications.requisitionId, job.id), eq(applications.status, 'hired'))); if (count.total >= job.numberOfVacancies)
        fail(409, 'All vacancies have been filled'); try {
        await validateManagers(tx, input.employee);
    }
    catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 400)
            fail(400, error.message);
        throw error;
    } const [employee] = await tx.insert(employees).values(input.employee).returning(); await tx.insert(hiringHandoffs).values({ offerId: id, candidateId: app.candidateId, employeeId: employee.id, createdBy: req.user!.userId }); const workflow = await createLifecycle(tx, req.user!, { employeeId: employee.id, templateId: input.templateId, ownerId: input.ownerId, startDate: employee.joiningDate, reason: input.reason }); if (workflow.kind !== 'onboarding')
        fail(400, 'Choose an onboarding template'); await tx.update(applications).set({ status: 'hired', updatedAt: new Date() }).where(eq(applications.id, app.id)); await audit(tx, req.user!, 'employee', employee.id, 'Created from accepted offer #' + id); return { employeeId: employee.id, caseId: workflow.id }; }));
}));
export default router;
