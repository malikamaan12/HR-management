import { Router } from 'express';
import { z } from 'zod';
import { and, eq, or, desc, sql, gte, inArray, gt } from 'drizzle-orm';
import { db } from '../db';
import { employees, users, authSessions, documents, lifecycleCases as cases, lifecycleTasks as tasks, lifecycleTemplates as templates, workforceAssignments, workforceShifts, workforceTeams, workforceSites } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { handle } from './hr-rules';
import { employeeScope } from '../services/access';
import { positiveId, civilDate, reason, dayAt } from '@shared/hr-rules';
import { audit, scopedEmployee, businessToday } from '../services/hr-rules';
import { fail, type WorkforceTransaction } from '../services/workforce';
import { hasPermission, getAccessScope } from '@shared/permissions';
import type { TokenPayload } from '../services/auth';
const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const templateInput = z.object({ name: z.string().trim().min(1).max(150), kind: z.enum(['onboarding', 'offboarding']), tasks: z.array(z.object({ title: z.string().trim().min(1).max(200), kind: z.enum(['general', 'document', 'asset_return']), required: z.boolean(), offsetDays: z.number().int().min(-90).max(365) })).min(1).max(100) }).strict();
const canManage = (u: TokenPayload) => hasPermission(u.role, 'recruitment_onboarding', 'update');
const caseScope = (u: TokenPayload) => or(employeeScope(u, 'recruitment_onboarding'), eq(employees.userId, u.userId), sql `exists(select 1 from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.ownerId}=${u.userId})`);
export async function createLifecycle(tx: WorkforceTransaction, user: TokenPayload, input: {
    employeeId: number;
    templateId: number;
    startDate: string;
    reason: string;
    ownerId: number;
}) {
    const e = await scopedEmployee(tx, user, input.employeeId, 'recruitment_onboarding', 'update', true);
    const [template] = await tx.select().from(templates).where(eq(templates.id, input.templateId));
    if (!template)
        fail(404, 'Template not found');
    if (input.startDate < e.joiningDate)
        fail(400, 'Workflow date must be on or after joining');
    if (template.kind === 'offboarding' && (!['admin', 'super_admin', 'hr', 'hr_director'].includes(user.role) || e.userId === user.userId))
        fail(403, 'An independent HR administrator must manage offboarding');
    const [active] = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.employeeId, e.id), eq(cases.kind, template.kind), eq(cases.status, 'in_progress')));
    if (active)
        fail(409, 'An active workflow of this type already exists');
    await requireOwner(tx, input.ownerId);
    const [row] = await tx.insert(cases).values({ employeeId: e.id, kind: template.kind, templateId: template.id, templateSnapshot: template, startDate: input.startDate, createdBy: user.userId, reason: input.reason }).returning();
    await tx.insert(tasks).values(template.tasks.map(t => ({ caseId: row.id, title: t.title, kind: t.kind, required: t.required, ownerId: input.ownerId, dueDate: new Date(Date.parse(input.startDate) + t.offsetDays * 86400000).toISOString().slice(0, 10) })));
    await audit(tx, user, 'lifecycle', row.id, 'Started ' + template.kind);
    return row;
}
async function requireOwner(tx: WorkforceTransaction, id: number) { const [owner] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.isActive, true), eq(users.approvalStatus, 'approved'))); if (!owner)
    fail(400, 'Choose an active, approved task owner'); }
router.get('/options', handle(async (req, res) => res.json({ canManage: canManage(req.user!), canTemplates: ['admin', 'super_admin', 'hr_director', 'hr'].includes(req.user!.role), employees: await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(employees).where(employeeScope(req.user!, 'recruitment_onboarding', 'update')).orderBy(employees.id).limit(1000), owners: canManage(req.user!) ? await db.select({ id: users.id, name: sql<string> `${users.firstName} || ' ' || ${users.lastName}` }).from(users).where(and(eq(users.isActive, true), eq(users.approvalStatus, 'approved'))).orderBy(users.id).limit(1000) : [] })));
router.get('/templates', handle(async (req, res) => { if (!canManage(req.user!))
    fail(403, 'Recruitment management access required'); res.json(await db.select().from(templates).orderBy(desc(templates.id))); }));
router.post('/templates', handle(async (req, res) => { if (!['admin', 'super_admin', 'hr_director', 'hr'].includes(req.user!.role))
    fail(403, 'HR administrator access required'); const input = templateInput.parse(req.body); res.status(201).json(await db.transaction(async (tx) => { const [row] = await tx.insert(templates).values({ ...input, createdBy: req.user!.userId }).returning(); await audit(tx, req.user!, 'lifecycle_template', row.id, 'Created reusable checklist'); return row; })); }));
router.get('/', handle(async (req, res) => { res.json(await db.select({ record: cases, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, required: sql<number> `(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.required}=true)`, completed: sql<number> `(select count(*)::int from ${tasks} where ${tasks.caseId}=${cases.id} and ${tasks.required}=true and ${tasks.status}='completed')` }).from(cases).innerJoin(employees, eq(cases.employeeId, employees.id)).where(caseScope(req.user!)).orderBy(desc(cases.id)).limit(500)); }));
router.post('/', handle(async (req, res) => { const input = z.object({ employeeId: positiveId, templateId: positiveId, startDate: civilDate, reason, ownerId: positiveId }).strict().parse(req.body); res.status(201).json(await db.transaction(tx => createLifecycle(tx, req.user!, input))); }));
router.get('/:id', handle(async (req, res) => { const id = positiveId.parse(req.params.id); const [row] = await db.select({ record: cases, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, owner: employees.userId }).from(cases).innerJoin(employees, eq(cases.employeeId, employees.id)).where(and(eq(cases.id, id), caseScope(req.user!))); if (!row)
    fail(404, 'Workflow not found'); const [manager] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, row.record.employeeId), employeeScope(req.user!, 'recruitment_onboarding', 'update'))); const all = !!manager || row.owner === req.user!.userId; const list = await db.select({ task: tasks, ownerName: sql<string> `${users.firstName} || ' ' || ${users.lastName}` }).from(tasks).innerJoin(users, eq(tasks.ownerId, users.id)).where(and(eq(tasks.caseId, id), all ? undefined : eq(tasks.ownerId, req.user!.userId))).orderBy(tasks.dueDate, tasks.id); res.json({ record: row.record, name: row.name, canManage: !!manager, tasks: list.map(({ task, ownerName }) => ({ ...task, ownerName, canComplete: !!manager || task.ownerId === req.user!.userId })) }); }));
router.patch('/:id/tasks/:taskId', handle(async (req, res) => {
    const id = positiveId.parse(req.params.id), taskId = positiveId.parse(req.params.taskId), input = z.object({ version: z.number().int().positive(), ownerId: positiveId.optional(), dueDate: civilDate.optional(), status: z.enum(['pending', 'completed']).optional(), evidence: reason.optional(), documentId: positiveId.nullable().optional(), assetTag: z.string().trim().min(1).max(150).optional() }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const [row] = await tx.select({ record: cases }).from(cases).innerJoin(employees, eq(cases.employeeId, employees.id)).where(and(eq(cases.id, id), caseScope(req.user!))).for('update', { of: cases });
        if (!row)
            fail(404, 'Workflow not found');
        if (row.record.version !== input.version || row.record.status !== 'in_progress')
            fail(409, 'Workflow changed or is closed; refresh');
        const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.caseId, id)));
        if (!task)
            fail(404, 'Task not found');
        const [manager] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, row.record.employeeId), employeeScope(req.user!, 'recruitment_onboarding', 'update')));
        if (!manager && (task.ownerId !== req.user!.userId || input.ownerId || input.dueDate))
            fail(403, 'Only the assigned owner can complete this task; managers assign owners and dates');
        if (input.ownerId)
            await requireOwner(tx, input.ownerId);
        if (input.status === 'completed') {
            if (!input.evidence)
                fail(400, 'Record completion evidence');
            if (task.kind === 'document') {
                const docId = input.documentId || task.documentId;
                const [document] = docId ? await tx.select().from(documents).where(and(eq(documents.id, docId), eq(documents.employeeId, row.record.employeeId))) : [];
                if (!document?.documentFile || (!document.documentFile.startsWith('documents/' + row.record.employeeId + '/') || !/^documents\/\d+\/[a-f0-9-]+\.(pdf|png|jpg)$/.test(document.documentFile)))
                    fail(400, 'Select a privately uploaded document for this employee');
            }
            if (task.kind === 'asset_return' && !input.assetTag && !task.assetTag)
                fail(400, 'Record the returned asset identifier');
        }
        const { version, ...patch } = input;
        await tx.update(tasks).set({ ...patch, ...(input.status ? { completedBy: input.status === 'completed' ? req.user!.userId : null, completedAt: input.status === 'completed' ? new Date() : null } : {}) }).where(eq(tasks.id, taskId));
        await tx.update(cases).set({ version: row.record.version + 1 }).where(eq(cases.id, id));
        await audit(tx, req.user!, 'lifecycle', id, `Task #${taskId} ${input.status || 'reassigned'}`);
        return { id };
    }));
}));
router.post('/:id/cancel', handle(async (req, res) => { const id = positiveId.parse(req.params.id), input = z.object({ version: positiveId, reason }).strict().parse(req.body); res.json(await db.transaction(async (tx) => { const [initial] = await tx.select().from(cases).where(eq(cases.id, id)); if (!initial)
    fail(404, 'Workflow not found'); const employee = await scopedEmployee(tx, req.user!, initial.employeeId, 'recruitment_onboarding', 'update', true); const [row] = await tx.select().from(cases).where(eq(cases.id, id)).for('update'); if (row.version !== input.version || row.status !== 'in_progress')
    fail(409, 'Workflow changed or is closed'); if (row.kind === 'offboarding' && (!['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role) || employee.userId === req.user!.userId))
    fail(403, 'An independent HR administrator must manage offboarding'); const [saved] = await tx.update(cases).set({ status: 'cancelled', version: row.version + 1 }).where(eq(cases.id, id)).returning(); await audit(tx, req.user!, 'lifecycle', id, 'Cancelled ' + row.kind + ': ' + input.reason); return saved; })); }));
router.post('/:id/complete', handle(async (req, res) => {
    const id = positiveId.parse(req.params.id), input = z.object({ version: z.number().int().positive(), reason, confirmed: z.literal(true) }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const [initial] = await tx.select().from(cases).where(eq(cases.id, id));
        if (!initial)
            fail(404, 'Workflow not found');
        const employee = await scopedEmployee(tx, req.user!, initial.employeeId, 'recruitment_onboarding', 'approve', true);
        const [row] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
        if (row.version !== input.version || row.status !== 'in_progress')
            fail(409, 'Workflow changed or is already closed');
        const [pending] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.caseId, id), eq(tasks.required, true), eq(tasks.status, 'pending')));
        if (pending)
            fail(409, 'Complete every required task first');
        if (row.kind === 'offboarding') {
            if (!['admin', 'super_admin', 'hr', 'hr_director'].includes(req.user!.role) || employee.userId === req.user!.userId)
                fail(403, 'An independent HR administrator must complete offboarding');
            if (row.startDate > businessToday())
                fail(409, 'Complete offboarding on or after the last employment date');
            const upcoming = await tx.select({ end: workforceShifts.endAt, timezone: workforceSites.timezone }).from(workforceAssignments).innerJoin(workforceShifts, eq(workforceAssignments.shiftId, workforceShifts.id)).innerJoin(workforceTeams, eq(workforceShifts.teamId, workforceTeams.id)).innerJoin(workforceSites, eq(workforceTeams.siteId, workforceSites.id)).where(and(eq(workforceAssignments.employeeId, employee.id), inArray(workforceAssignments.status, ['offered', 'accepted']), gte(workforceShifts.endAt, new Date(Date.parse(row.startDate) - 86400000))));
            if (upcoming.some(s => dayAt(new Date(+s.end - 1), s.timezone) > row.startDate))
                fail(409, 'Cancel or reassign work scheduled after the leaving date');
            if (employee.userId) {
                const [account] = await tx.select().from(users).where(eq(users.id, employee.userId)).for('update');
                if (account && ['admin', 'super_admin'].includes(account.role)) {
                    const admins = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ['admin', 'super_admin']), eq(users.isActive, true))).for('update');
                    if (admins.length < 2)
                        fail(409, 'Keep another active administrator before deactivating this account');
                }
                await tx.update(users).set({ isActive: false, refreshToken: null, passwordResetToken: null, passwordResetExpires: null, updatedAt: new Date() }).where(eq(users.id, employee.userId));
                await tx.update(authSessions).set({ isActive: false }).where(eq(authSessions.userId, employee.userId));
            }
            await tx.update(employees).set({ status: 'inactive', terminationDate: row.startDate, updatedAt: new Date() }).where(eq(employees.id, employee.id));
        }
        const [saved] = await tx.update(cases).set({ status: 'completed', version: row.version + 1, completedAt: new Date() }).where(eq(cases.id, id)).returning();
        await audit(tx, req.user!, 'lifecycle', id, 'Completed ' + row.kind + ': ' + input.reason);
        return saved;
    }));
}));
export default router;
