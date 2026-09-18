import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, gte, lte } from 'drizzle-orm';
import { employees, leaves, leaveSnapshots } from '@shared/schema';
import { civilDate, dateRange, unpaidLeavePayrollRule } from '@shared/hr-rules';
import {
  calculateUnpaidLeaveDeduction, unpaidLeaveActiveDates, unpaidLeaveSourceState,
  type PayrollLeaveCalendar, type PayrollLeavePolicy, type PayrollLeaveSource, type UnpaidLeaveSnapshot,
} from '@shared/payroll-leave';
import { attendancePolicy } from './hr-rules';
import { fail, type WorkforceTransaction } from './workforce';

const fingerprint = (sources: PayrollLeaveSource[], activeDates: string[]) => createHash('sha256').update(unpaidLeaveSourceState(sources, activeDates)).digest('hex');
const savedSource = z.object({
  id: z.number().int().positive(), employeeId: z.number().int().positive(), leaveType: z.string(), startDate: civilDate, endDate: civilDate,
  totalDays: z.number(), status: z.string(), reviewVersion: z.number().int(), approvalStage: z.number().int(),
  approvedBy: z.number().nullable(), approvedAt: z.string().nullable(), updatedAt: z.string(),
  snapshot: z.object({ dayPortion: z.string(), rules: z.unknown(), daysByYear: z.record(z.number()) }).nullable(),
});
const savedCalculation = z.object({
  version: z.literal(1), period: z.object({ start: civilDate, end: civilDate }),
  employee: z.object({ id: z.number().int().positive(), joiningDate: civilDate, contractEndDate: civilDate.nullable(), terminationDate: civilDate.nullable() }),
  activeDates: z.array(civilDate),
  policies: z.record(z.object({ id: z.number().int().positive(), config: z.object({
    basis: z.enum(['salary', 'hourly', 'daily', 'per_event']), basicSalary: z.string(), allowances: z.record(z.string()), unpaidLeave: unpaidLeavePayrollRule.optional(),
  }) })),
  sources: z.array(savedSource), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Caller holds the employee lock, also used by leave approval/cancellation writes. */
async function sourceRows(tx: WorkforceTransaction, employeeId: number, period: { start: string; end: string }): Promise<PayrollLeaveSource[]> {
  const rows = await tx.select({ leave: leaves, snapshot: leaveSnapshots }).from(leaves)
    .leftJoin(leaveSnapshots, eq(leaveSnapshots.leaveId, leaves.id))
    .where(and(eq(leaves.employeeId, employeeId), lte(leaves.startDate, period.end), gte(leaves.endDate, period.start))).orderBy(leaves.id);
  return rows.map(({ leave, snapshot }) => ({
    id: leave.id, employeeId: leave.employeeId, leaveType: leave.leaveType, startDate: leave.startDate, endDate: leave.endDate,
    totalDays: leave.totalDays, status: leave.status, reviewVersion: leave.reviewVersion, approvalStage: leave.approvalStage,
    approvedBy: leave.approvedBy, approvedAt: leave.approvedAt?.toISOString() ?? null, updatedAt: leave.updatedAt.toISOString(),
    snapshot: snapshot ? { dayPortion: snapshot.dayPortion, rules: snapshot.rules, daysByYear: snapshot.daysByYear } : null,
  }));
}

export async function buildUnpaidLeaveDeduction(
  tx: WorkforceTransaction, employee: typeof employees.$inferSelect, period: { start: string; end: string },
  policies: ReadonlyMap<string, PayrollLeavePolicy>,
): Promise<UnpaidLeaveSnapshot> {
  const scope = { id: employee.id, joiningDate: employee.joiningDate, contractEndDate: employee.contractEndDate, terminationDate: employee.terminationDate };
  const activeDates = unpaidLeaveActiveDates(scope, period, policies), calendars = new Map<string, PayrollLeaveCalendar>();
  if (activeDates.some(day => policies.get(day)!.config.unpaidLeave?.divisor === 'working_days')) {
    for (const day of dateRange(period.start, period.end)) calendars.set(day, await attendancePolicy(tx, employee, day));
  }
  const sources = activeDates.length ? await sourceRows(tx, employee.id, period) : [];
  try {
    const result = calculateUnpaidLeaveDeduction({ employee: scope, period, policies, calendars, sources });
    return { ...result, fingerprint: fingerprint(result.sources, result.activeDates) };
  } catch (error) {
    fail(409, error instanceof Error ? error.message : 'Cannot calculate unpaid leave deductions');
  }
}

/** Uses saved policy flags: a later admin rule revision never rewrites a saved pay run. */
export async function assertUnpaidLeaveUnchanged(
  tx: WorkforceTransaction, employeeId: number, period: { start: string; end: string }, value: unknown,
) {
  const parsed = savedCalculation.safeParse(value);
  if (!parsed.success) fail(409, 'The saved unpaid leave calculation is incomplete; cancel and regenerate the draft');
  const snapshot = parsed.data;
  if (snapshot.version !== 1 || snapshot.employee.id !== employeeId || snapshot.period.start !== period.start || snapshot.period.end !== period.end)
    fail(409, 'The saved unpaid leave calculation does not match this payroll; cancel and regenerate the draft');
  let activeDates: string[];
  try { activeDates = unpaidLeaveActiveDates(snapshot.employee, snapshot.period, new Map(Object.entries(snapshot.policies))); }
  catch { fail(409, 'The saved unpaid leave pay policies are incomplete; cancel and regenerate the draft'); }
  if (JSON.stringify(activeDates) !== JSON.stringify(snapshot.activeDates))
    fail(409, 'The saved unpaid leave date coverage is incomplete; cancel and regenerate the draft');
  const savedSources: PayrollLeaveSource[] = snapshot.sources.map(source => ({ ...source,
    snapshot: source.snapshot ? { ...source.snapshot, rules: source.snapshot.rules } : null,
  }));
  if (fingerprint(savedSources, activeDates) !== snapshot.fingerprint)
    fail(409, 'The saved unpaid leave sources are incomplete; cancel and regenerate the draft');
  if (!activeDates.length) return;
  const current = await sourceRows(tx, employeeId, period);
  if (fingerprint(current, activeDates) !== snapshot.fingerprint)
    fail(409, 'Leave requests changed since payroll generation. Cancel and regenerate this payroll, then submit it for fresh review');
}
