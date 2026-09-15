import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { employees, payroll, payrollReviews, payrollTimeLines, workforceTimesheets as sheets, timesheetRevisions } from '@shared/schema';
import { employeeScope } from '../services/access';
import { authenticate } from '../middleware/auth';
import { calculatePayroll } from '@shared/money';
import { positiveId, reason } from '@shared/hr-rules';
import { handle } from './hr-rules';
import { generatePayroll, payrollRecord, versionMatch, addHistory, payrollAmounts } from '../services/payroll-review';
import { fail } from '../services/workforce';
import { hasPermission } from '@shared/permissions';
const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/options', handle(async (req, res) => res.json({ employees: await db.select({ id: employees.id, name: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(employees).where(employeeScope(req.user!, 'payroll_management', 'create')).orderBy(employees.id).limit(1000), canCreate: hasPermission(req.user!.role, 'payroll_management', 'create') })));
router.get('/month/:month/year/:year', handle(async (req, res) => {
    const month = z.coerce.number().int().min(1).max(12).parse(req.params.month), year = z.coerce.number().int().min(2000).max(2200).parse(req.params.year);
    const rows = await db.select({ record: payroll, review: payrollReviews, employeeName: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}` }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).leftJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(eq(payroll.month, month), eq(payroll.year, year), employeeScope(req.user!, 'payroll_management'))).orderBy(desc(payroll.id));
    res.json(rows.map(({ record, ...rest }) => ({ ...record, ...rest })));
}));
router.post('/', handle(async (req, res) => { const input = z.object({ employeeId: positiveId, month: z.number().int().min(1).max(12), year: z.number().int().min(2000).max(2200) }).strict().parse(req.body); res.status(201).json(await db.transaction(tx => generatePayroll(tx, req.user!, input))); }));
router.post('/:id/regenerate', handle(async (req, res) => { const input = z.object({ version: z.number().int().min(0), reason }).strict().parse(req.body); const id = positiveId.parse(req.params.id); res.status(201).json(await db.transaction(async (tx) => { const [record] = await tx.select({ employeeId: payroll.employeeId, year: payroll.year, month: payroll.month }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).where(and(eq(payroll.id, id), employeeScope(req.user!, 'payroll_management', 'create'))); if (!record)
    fail(404, 'Payroll not found within your access'); return generatePayroll(tx, req.user!, record, { id, ...input }); })); }));
router.get('/:id', handle(async (req, res) => res.json(await db.transaction(async (tx) => { const row = await payrollRecord(tx, req.user!, positiveId.parse(req.params.id)); const lines = await tx.select().from(payrollTimeLines).where(eq(payrollTimeLines.payrollId, row.record.id)); const { owner, ...data } = row; return { ...data, lines, canEdit: hasPermission(req.user!.role, 'payroll_management', 'update') && row.review?.approverId !== req.user!.userId, canApprove: hasPermission(req.user!.role, 'payroll_management', 'approve') && row.review?.approverId === req.user!.userId && row.review?.createdBy !== req.user!.userId && owner !== req.user!.userId }; }))));
router.patch('/:id', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), adjustments: z.array(z.object({ label: z.string().trim().min(1).max(100), kind: z.enum(['allowance', 'deduction']), amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/), reason })).max(50), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => { const row = await payrollRecord(tx, req.user!, positiveId.parse(req.params.id), 'update'); versionMatch(row.review, input.version); if (row.record.status !== 'draft')
        fail(409, 'Return payroll to draft before editing'); if(row.review!.approverId===req.user!.userId)fail(403,'An independent preparer must edit payroll amounts');const base = (row.review!.policy as any).baseAmounts; const allowances = { ...base.allowances }, deductions = { ...base.deductions }; input.adjustments.forEach((a, i) => (a.kind === 'allowance' ? allowances : deductions)[`Adjustment ${i + 1}: ${a.label}`] = a.amount); const amounts = payrollAmounts(base.basicSalary, allowances, deductions, row.record.calculationSnapshot?.rules.payroll); await tx.update(payroll).set({ ...amounts, updatedAt: new Date() }).where(eq(payroll.id, row.record.id)); await addHistory(tx, req.user!, row.review!, 'Adjustments saved', input.reason, { adjustments: input.adjustments }); return { id: row.record.id }; }));
}));
router.post('/:id/action', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), action: z.enum(['submit', 'approve', 'return', 'cancel']), reason }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const row = await payrollRecord(tx, req.user!, positiveId.parse(req.params.id), input.action === 'approve' || input.action === 'return' ? 'approve' : 'update');
        versionMatch(row.review, input.version);
        const review = row.review!;
        if (input.action === 'submit' && row.record.status !== 'draft' || input.action === 'approve' && row.record.status !== 'submitted' || input.action === 'return' && !['submitted', 'approved'].includes(row.record.status) || input.action === 'cancel' && row.record.status !== 'draft')
            fail(409, 'This action is unavailable for the current payroll status');
        if (['approve', 'return'].includes(input.action) && (review.approverId !== req.user!.userId || review.createdBy === req.user!.userId || row.owner === req.user!.userId))
            fail(403, 'The independent designated pay approver must review this payroll');
        const status = { submit: 'submitted', approve: 'approved', return: 'draft', cancel: 'cancelled' }[input.action];
        if (input.action === 'cancel')
            await tx.delete(payrollTimeLines).where(eq(payrollTimeLines.payrollId, row.record.id));
        await tx.update(payroll).set({ status, updatedAt: new Date() }).where(eq(payroll.id, row.record.id));
        await addHistory(tx, req.user!, review, input.action, input.reason, input.action === 'approve' ? { approvedBy: req.user!.userId, approvedAt: new Date() } : { approvedBy: null, approvedAt: null });
        return { id: row.record.id, status };
    }));
}));
router.post('/:id/mark-paid', handle(async (req, res) => {
    const input = z.object({ version: z.number().int().positive(), reference: z.string().trim().min(1).max(150), confirmed: z.literal(true) }).strict().parse(req.body);
    res.json(await db.transaction(async (tx) => {
        const row = await payrollRecord(tx, req.user!, positiveId.parse(req.params.id), 'approve');
        versionMatch(row.review, input.version);
        if (row.record.status !== 'approved')
            fail(409, 'Only independently approved payroll can be marked paid');
        if (row.review!.approverId !== req.user!.userId || row.owner === req.user!.userId)
            fail(403, 'The designated pay approver must record payment');
        const lines = await tx.select().from(payrollTimeLines).where(eq(payrollTimeLines.payrollId, row.record.id));
        for (const line of lines) {
            const [sheet] = await tx.select().from(sheets).where(eq(sheets.id, line.timesheetId)).for('update');
            if (sheet.status !== 'approved' || sheet.version !== line.timesheetVersion)
                fail(409, 'Included time changed; return payroll for reconciliation');
            const [locked] = await tx.update(sheets).set({ status: 'payroll_locked', payrollId: row.record.id, lockedBy: req.user!.userId, lockedAt: new Date(), version: sheet.version + 1, updatedAt: new Date() }).where(eq(sheets.id, sheet.id)).returning();
            await tx.insert(timesheetRevisions).values({ timesheetId: sheet.id, version: locked.version, actorId: req.user!.userId, action: 'Payroll paid', reason: `Paid through payroll #${row.record.id}`, snapshot: locked });
        }
        const [saved] = await tx.update(payroll).set({ status: 'processed', wpsReference: input.reference, processedBy: req.user!.userId, processedAt: new Date(), updatedAt: new Date() }).where(eq(payroll.id, row.record.id)).returning();
        await addHistory(tx, req.user!, row.review!, 'Payment recorded', 'External reference: ' + input.reference);
        return saved;
    }));
}));
export default router;
