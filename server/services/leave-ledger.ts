import { and, eq, lte, gte, or, isNull, sql, desc } from 'drizzle-orm';
import { employees, hrRules, leaveLedger, leaves, leaveSnapshots, workforceAssignments, workforceShifts, workforceTeams, workforceSites } from '@shared/schema';
import { leaveRule, dateRange, dayAt } from '@shared/hr-rules';
import { attendancePolicy, ruleFor, businessToday } from './hr-rules';
import { fail, type WorkforceTransaction } from './workforce';
export async function balance(tx: WorkforceTransaction, employeeId: number, type: string, year: number) { const [row] = await tx.select({ units: sql<number> `coalesce(sum(${leaveLedger.units}),0)::int` }).from(leaveLedger).where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveType, type), eq(leaveLedger.year, year))); return row.units; }
export async function reserved(tx: WorkforceTransaction, employeeId: number, type: string, year: number, excludeId?: number) { const rows = await tx.select({ id: leaves.id, days: leaveSnapshots.daysByYear }).from(leaves).innerJoin(leaveSnapshots, eq(leaves.id, leaveSnapshots.leaveId)).where(and(eq(leaves.employeeId, employeeId), eq(leaves.leaveType, type), eq(leaves.status, 'pending'), eq(leaveSnapshots.balanceRequired, true))); return rows.filter(r => r.id !== excludeId).reduce((sum, r) => sum + (r.days[String(year)] || 0) * 100, 0); }
export async function accrue(tx: WorkforceTransaction, employee: typeof employees.$inferSelect, type: string, year: number) {
    const today = businessToday();
    if (year > Number(today.slice(0, 4)))
        return;
    const rules = await tx.select().from(hrRules).where(and(eq(hrRules.kind, 'leave'), eq(hrRules.name, type), lte(hrRules.effectiveFrom, `${year}-12-31`), or(eq(hrRules.employeeId, employee.id), isNull(hrRules.employeeId)))).orderBy(sql `${hrRules.employeeId} IS NOT NULL DESC`, desc(hrRules.effectiveFrom), desc(hrRules.id));
    const first = Math.max(Number(employee.joiningDate.slice(0, 4)), Math.min(...rules.map(r => Number(r.effectiveFrom.slice(0, 4)))));
    if (!rules.length || year < first)
        return;
    const key = `${employee.id}:${type}:${year}`;
    const jan = rules.find(r => r.effectiveFrom <= `${year}-01-01`);
    if (year > first && jan) {
        const [carried] = await tx.select({ id: leaveLedger.id }).from(leaveLedger).where(eq(leaveLedger.sourceKey, key + ':carry'));
        if (!carried) {
            await accrue(tx, employee, type, year - 1);
            if (await reserved(tx, employee.id, type, year - 1) > 0)
                fail(409, 'Decide previous-year leave before carrying balances forward');
            await tx.insert(leaveLedger).values({ employeeId: employee.id, leaveType: type, year, units: Math.min(Math.round(leaveRule.parse(jan.config).carryoverLimit * 100), Math.max(0, await balance(tx, employee.id, type, year - 1))), sourceKey: key + ':carry', reason: `Carryover under rule #${jan.id}` }).onConflictDoNothing();
        }
    }
    let annualDone = false;
    for (const day of dateRange(`${year}-01-01`, `${year}-12-31`)) {
        if (day > today || day < employee.joiningDate || (employee.contractEndDate && day > employee.contractEndDate) || (employee.terminationDate && day > employee.terminationDate))
            continue;
        const rule = rules.find(r => r.effectiveFrom <= day);
        if (!rule)
            continue;
        const policy = leaveRule.parse(rule.config);
        if (Date.parse(day) - Date.parse(employee.joiningDate) < policy.minServiceDays * 86400000)
            continue;
        const next = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
        let credit: number | undefined, source = '';
        if (policy.accrualMode === 'annual' && !annualDone) {
            annualDone = true;
            credit = Math.round(policy.annualDays * 100);
            source = 'annual';
        }
        if (policy.accrualMode === 'monthly' && next.slice(5, 7) !== day.slice(5, 7) && day < today && Date.parse(employee.joiningDate) + policy.minServiceDays * 86400000 <= Date.parse(day.slice(0, 8) + '01') && rule.effectiveFrom <= day.slice(0, 8) + '01') {
            credit = Math.round(policy.monthlyDays * 100);
            source = 'month:' + day.slice(5, 7);
        }
        if (credit !== undefined)
            await tx.insert(leaveLedger).values({ employeeId: employee.id, leaveType: type, year, units: credit, sourceKey: key + ':' + source, reason: `${source} entitlement under rule #${rule.id}` }).onConflictDoNothing();
    }
}
export async function leavePlan(tx: WorkforceTransaction, employee: typeof employees.$inferSelect, type: string, start: string, end: string) {
    if (employee.status !== 'active')
        fail(409, 'Leave requires active employment');
    const dates = dateRange(start, end), rules: unknown[] = [], daysByYear: Record<string, number> = {};
    let balanceRequired: boolean | undefined, approverId: number | null | undefined;
    const assigned = employee.workSchedule === 'shift_based' ? await tx.select({ start: workforceShifts.startAt, timezone: workforceSites.timezone }).from(workforceAssignments).innerJoin(workforceShifts, eq(workforceAssignments.shiftId, workforceShifts.id)).innerJoin(workforceTeams, eq(workforceShifts.teamId, workforceTeams.id)).innerJoin(workforceSites, eq(workforceTeams.siteId, workforceSites.id)).where(and(eq(workforceAssignments.employeeId, employee.id), eq(workforceAssignments.status, 'accepted'), gte(workforceShifts.startAt, new Date(Date.parse(start) - 86400000)), lte(workforceShifts.startAt, new Date(Date.parse(end) + 2 * 86400000)))) : [];
    for (const day of dates) {
        const rule = await ruleFor(tx, employee.id, 'leave', type, day);
        if (!rule)
            fail(409, `An administrator must configure ${type} rules for this employee and date`);
        const policy = leaveRule.parse(rule.config);
        if (balanceRequired !== undefined && (balanceRequired !== policy.balanceRequired || approverId !== policy.approverId))
            fail(400, 'Split the request where the balance or approver rule changes');
        balanceRequired = policy.balanceRequired;
        approverId = policy.approverId;
        if (dates.length > policy.maxConsecutiveDays)
            fail(400, 'Leave exceeds the consecutive-day limit');
        if (day < employee.joiningDate || (employee.contractEndDate && day > employee.contractEndDate) || (employee.terminationDate && day > employee.terminationDate))
            fail(400, 'Leave must fall within employment dates');
        if (Date.parse(day) - Date.parse(employee.joiningDate) < policy.minServiceDays * 86400000)
            fail(400, 'Minimum service requirement has not been met');
        const calendar = await attendancePolicy(tx, employee, day);
        const working = employee.workSchedule === 'shift_based' ? assigned.some(s => dayAt(s.start, s.timezone) === day) : calendar.workingDays.includes(new Date(day).getUTCDay());
        const counted = working && !calendar.holidays.some(h => h.date === day);
        if (counted)
            daysByYear[day.slice(0, 4)] = (daysByYear[day.slice(0, 4)] || 0) + 1;
        rules.push({ day, counted, leaveRuleId: rule.id, leavePolicy: policy, calendar });
    }
    const totalDays = Object.values(daysByYear).reduce((a, b) => a + b, 0);
    if (totalDays < 1)
        fail(400, 'No scheduled working days in this range');
    return { totalDays, daysByYear, rules, balanceRequired: balanceRequired!, approverId: approverId ?? null };
}
export async function assertFunds(tx: WorkforceTransaction, employee: typeof employees.$inferSelect, type: string, plan: {
    daysByYear: Record<string, number>;
    balanceRequired: boolean;
}, excludeId?: number) { if (!plan.balanceRequired)
    return; for (const [year, days] of Object.entries(plan.daysByYear)) {
    await accrue(tx, employee, type, Number(year));
    if (await balance(tx, employee.id, type, Number(year)) - await reserved(tx, employee.id, type, Number(year), excludeId) < days * 100)
        fail(409, `Insufficient available ${type} balance for ${year}`);
} }
export async function employeeBalances(tx: WorkforceTransaction, employee: typeof employees.$inferSelect, year: number) {
    const names = await tx.selectDistinct({ name: hrRules.name }).from(hrRules).where(and(eq(hrRules.kind, 'leave'), or(eq(hrRules.employeeId, employee.id), isNull(hrRules.employeeId))));
    const result = [];
    const marker = year === Number(businessToday().slice(0, 4)) ? businessToday() : year + '-12-31';
    for (const { name } of names) {
        const effective = await ruleFor(tx, employee.id, 'leave', name, marker);
        if (!effective)
            continue;
        const policy = leaveRule.parse(effective.config);
        await accrue(tx, employee, name, year);
        const total = await balance(tx, employee.id, name, year), pending = await reserved(tx, employee.id, name, year);
        result.push({ type: name, balance: total / 100, reserved: pending / 100, available: (total - pending) / 100, balanceRequired: policy.balanceRequired });
    }
    return result;
}
