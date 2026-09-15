import { and, eq, gte, lte, isNull, sql } from 'drizzle-orm';
import { employees, payroll, payrollReviews, payrollTimeLines, workforceTimesheets as sheets, workforceAssignments as assignments, workforceShifts as shifts, workforceTeams as teams, workforceSites as sites } from '@shared/schema';
import { payrollRule, payPeriod, dayAt, dateRange, type PayrollRule } from '@shared/hr-rules';
import { calculatePayroll, moneyCents, moneyText } from '@shared/money';
import { ruleFor, scopedEmployee, audit, businessToday } from './hr-rules';
import { fail, type WorkforceTransaction } from './workforce';
import { employeeScope } from './access';
import type { TokenPayload } from './auth';
import { calculationSnapshot } from './calculation-rules';
import { calculatePolicyPayroll, defaultCalculationRules, type CalculationRules } from '@shared/calculation-rules';
export async function payrollRecord(tx: WorkforceTransaction, user: TokenPayload, id: number, permission: 'read' | 'update' | 'approve' = 'read') {
    // Employee first, then payroll and time records, matching timesheet writes.
    const [initial] = await tx.select({ employeeId: payroll.employeeId }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).where(and(eq(payroll.id, id), employeeScope(user, 'payroll_management', permission)));
    if (!initial)
        fail(404, 'Payroll not found within your access');
    await scopedEmployee(tx, user, initial.employeeId, 'payroll_management', permission, true);
    const [row] = await tx.select({ record: payroll, review: payrollReviews, employeeName: sql<string> `${employees.firstName} || ' ' || ${employees.lastName}`, owner: employees.userId }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).leftJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(eq(payroll.id, id), employeeScope(user, 'payroll_management', permission))).for('update', { of: payroll });
    if (!row)
        fail(404, 'Payroll not found within your access');
    return row;
}
export function versionMatch(review: {
    version: number;
} | null, version: number) { if (!review)
    fail(409, 'Legacy payroll must be reconciled before using the reviewed workflow'); if (review.version !== version)
    fail(409, 'Payroll changed. Refresh before continuing'); }
export async function generatePayroll(tx: WorkforceTransaction, user: TokenPayload, input: {
    employeeId: number;
    year: number;
    month: number;
}, replace?: {
    id: number;
    version: number;
    reason: string;
}) {
    const employee = await scopedEmployee(tx, user, input.employeeId, 'payroll_management', 'create', true);
    const marker = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
    const initial = await ruleFor(tx, employee.id, 'payroll', 'Pay policy', marker);
    if (!initial)
        fail(409, 'Configure a pay policy for this employee first');
    const basePolicy = payrollRule.parse(initial.config);
    const period = payPeriod(input.year, input.month, basePolicy.cycleStartDay);
    if (period.end >= businessToday())
        fail(409, 'Generate payroll after the pay period has ended');
    const [duplicate] = await tx.select({ record: payroll, review: payrollReviews }).from(payroll).leftJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(eq(payroll.employeeId, employee.id), eq(payroll.year, input.year), eq(payroll.month, input.month))).for('update', { of: payroll });
    if (duplicate && !replace)
        fail(409, 'Payroll already exists for this employee and period');
    if (replace) {
        if (!duplicate || duplicate.record.id !== replace.id)
            fail(409, 'Payroll changed; refresh');
        if ((duplicate.review?.version || 0) !== replace.version)
            fail(409, 'Payroll changed; refresh');
        if (duplicate.record.status !== 'cancelled' && !(duplicate.record.status === 'pending' && !duplicate.review))
            fail(409, 'Cancel the draft before regenerating');
        const [locked] = await tx.select({ id: sheets.id }).from(sheets).where(eq(sheets.payrollId, replace.id));
        if (locked)
            fail(409, 'Reconcile linked legacy timesheets before regeneration');
    }
    const [overlap] = await tx.select({ id: payroll.id }).from(payroll).innerJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(eq(payroll.employeeId, employee.id), sql `${payroll.status} <> 'cancelled'`, lte(payrollReviews.periodStart, period.end), gte(payrollReviews.periodEnd, period.start), replace ? sql `${payroll.id} <> ${replace.id}` : undefined));
    if (overlap)
        fail(409, 'The configured cycle overlaps another pay run; cancel the conflicting draft or correct the cycle');
    if (basePolicy.approverId === user.userId || basePolicy.approverId === employee.userId)
        fail(409, 'Configure an independent pay approver before generating this employee payroll');
    const dates = dateRange(period.start, period.end), policies = new Map<string, {
        id: number;
        config: PayrollRule;
    }>();
    for (const day of dates) {
        const rule = await ruleFor(tx, employee.id, 'payroll', 'Pay policy', day);
        if (!rule)
            fail(409, `Missing pay policy on ${day}`);
        const config = payrollRule.parse(rule.config);
        if (config.cycleStartDay !== basePolicy.cycleStartDay || config.currency !== basePolicy.currency || config.approverId !== basePolicy.approverId)
            fail(409, 'Currency, cycle and approver must stay consistent within a pay period');
        policies.set(day, { id: rule.id, config });
    }
    const candidates = await tx.select({ sheet: sheets, timezone: sites.timezone }).from(sheets).innerJoin(assignments, eq(sheets.assignmentId, assignments.id)).innerJoin(shifts, eq(assignments.shiftId, shifts.id)).innerJoin(teams, eq(shifts.teamId, teams.id)).innerJoin(sites, eq(teams.siteId, sites.id)).where(and(eq(assignments.employeeId, employee.id), eq(sheets.status, 'approved'), isNull(sheets.payrollId), gte(sheets.actualStartAt, new Date(Date.parse(period.start) - 86400000)), lte(sheets.actualStartAt, new Date(Date.parse(period.end) + 2 * 86400000)))).orderBy(sheets.actualStartAt, sheets.id).for('update', { of: sheets });
    const selected = candidates.filter(r => { const d = dayAt(r.sheet.actualStartAt, r.timezone); return d >= period.start && d <= period.end; });
    const timeLines: {
        timesheetId: number;
        timesheetVersion: number;
        workDate: string;
        regularMinutes: number;
        overtimeMinutes: number;
        amount: string;
        snapshot: unknown;
    }[] = [];
    const used = new Map<string, number>();
    let timeCents = 0;
    for (const { sheet, timezone } of selected) {
        const [reserved] = await tx.select({ id: payrollTimeLines.payrollId }).from(payrollTimeLines).where(eq(payrollTimeLines.timesheetId, sheet.id));
        if (reserved)
            fail(409, 'Approved time is already included in another pay run');
        const date = dayAt(sheet.actualStartAt, timezone), rule = policies.get(date)!;
        if (date < employee.joiningDate || (employee.contractEndDate && date > employee.contractEndDate) || (employee.terminationDate && date > employee.terminationDate))
            fail(409, 'Reconcile approved time outside employment dates');
        const regular = Math.min(sheet.payableMinutes!, Math.max(0, rule.config.regularMinutesPerDay - (used.get(date) || 0))), overtime = sheet.payableMinutes! - regular;
        used.set(date, (used.get(date) || 0) + sheet.payableMinutes!);
        if ((rule.config.basis === 'hourly' || overtime > 0) && moneyCents(rule.config.hourlyRate) === 0)
            fail(409, 'Configure a positive hourly rate for paid regular or overtime work');
        const rate = moneyCents(rule.config.hourlyRate), multiplier = Math.round(rule.config.overtimeMultiplier * 100);
        const cents = Number((BigInt(rate) * BigInt((rule.config.basis === 'hourly' ? regular : 0) * 100 + overtime * multiplier) + 3000n) / 6000n);
        timeCents += cents;
        timeLines.push({ timesheetId: sheet.id, timesheetVersion: sheet.version, workDate: date, regularMinutes: regular, overtimeMinutes: overtime, amount: moneyText(cents), snapshot: { sheet, rule, timezone } });
    }
    let basicNumerator = 0;
    const allowances: Record<string, number> = {}, deductions: Record<string, number> = {};
    for (const [day, { config }] of policies) {
        if (day < employee.joiningDate || (employee.contractEndDate && day > employee.contractEndDate) || (employee.terminationDate && day > employee.terminationDate))
            continue;
        if (config.basis === 'salary')
            basicNumerator += moneyCents(config.basicSalary);
        for (const [k, v] of Object.entries(config.allowances))
            allowances[k] = (allowances[k] || 0) + moneyCents(v);
        for (const [k, v] of Object.entries(config.deductions))
            deductions[k] = (deductions[k] || 0) + moneyCents(v);
    }
    const calculation = await calculationSnapshot(employee, period.start, tx);
    const amounts = { ...payrollAmounts(moneyText(Math.round(basicNumerator / dates.length)), { ...Object.fromEntries(Object.entries(allowances).map(([k, v]) => [k, moneyText(Math.round(v / dates.length))])), 'Approved time': moneyText(timeCents) }, Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, moneyText(Math.round(v / dates.length))])), calculation.rules.payroll), calculationSnapshot: calculation };
    const previousLines = duplicate ? await tx.select().from(payrollTimeLines).where(eq(payrollTimeLines.payrollId, duplicate.record.id)) : [];
    const [record] = replace ? await tx.update(payroll).set({ ...amounts, status: 'draft', wpsReference: null, processedBy: null, processedAt: null, updatedAt: new Date() }).where(eq(payroll.id, replace.id)).returning() : await tx.insert(payroll).values({ ...input, ...amounts, status: 'draft' }).returning();
    const nextVersion = (duplicate?.review?.version || 0) + 1;
    const review = { payrollId: record.id, version: nextVersion, currency: basePolicy.currency, periodStart: period.start, periodEnd: period.end, payDate: `${input.year}-${String(input.month).padStart(2, '0')}-${String(basePolicy.payDay).padStart(2, '0')}`, policy: { rules: Object.fromEntries(policies), baseAmounts: amounts, employee: { name: employee.firstName + ' ' + employee.lastName, employeeId: employee.employeeId, department: employee.department, position: employee.position } }, createdBy: user.userId, approverId: basePolicy.approverId, adjustments: [], approvedBy: null, approvedAt: null, history: [...(duplicate?.review?.history || []), { action: replace ? 'Regenerated' : 'Generated', actorId: user.userId, reason: replace?.reason || 'Generated from effective employee rules and approved time', at: new Date().toISOString(), version: nextVersion, snapshot: { previous: duplicate ? { record: duplicate.record, policy: duplicate.review?.policy, adjustments: duplicate.review?.adjustments, lines: previousLines } : null, amounts, lines: timeLines } }] };
    if (replace)
        await tx.delete(payrollTimeLines).where(eq(payrollTimeLines.payrollId, replace.id));
    await tx.insert(payrollReviews).values(review).onConflictDoUpdate({ target: payrollReviews.payrollId, set: review });
    if (timeLines.length)
        await tx.insert(payrollTimeLines).values(timeLines.map(l => ({ ...l, payrollId: record.id })));
    await audit(tx, user, 'payroll', record.id, 'Generated payroll with policy and time snapshots');
    return { ...record, review };
}
export async function addHistory(tx: WorkforceTransaction, user: TokenPayload, review: typeof payrollReviews.$inferSelect, action: string, reason: string, patch: Partial<typeof payrollReviews.$inferInsert> = {}) { const version = review.version + 1; const [record] = await tx.select().from(payroll).where(eq(payroll.id, review.payrollId)); const lines = await tx.select().from(payrollTimeLines).where(eq(payrollTimeLines.payrollId, review.payrollId)); await tx.update(payrollReviews).set({ ...patch, version, history: [...review.history, { action, actorId: user.userId, reason, at: new Date().toISOString(), version, snapshot: { record, lines, adjustments: patch.adjustments || review.adjustments } }] }).where(eq(payrollReviews.payrollId, review.payrollId)); await audit(tx, user, 'payroll', review.payrollId, action); }
export function payrollAmounts(basic: Parameters<typeof calculatePayroll>[0], allowances: Parameters<typeof calculatePayroll>[1], deductions: Parameters<typeof calculatePayroll>[2], rounding: CalculationRules['payroll'] = defaultCalculationRules.payroll) { try {
    return calculatePolicyPayroll(basic, allowances, deductions, rounding);
}
catch (error) {
    fail(400, error instanceof Error ? error.message : 'Invalid payroll amounts');
} }
