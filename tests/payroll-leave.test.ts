import { describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { dateRange } from '../shared/hr-rules';
import {
  calculateUnpaidLeaveDeduction, defaultUnpaidLeaveRule, unpaidLeaveSourceState,
  type PayrollLeaveCalendar, type PayrollLeaveEmployee, type PayrollLeavePolicy, type PayrollLeaveSource,
} from '../shared/payroll-leave';

vi.mock('../server/services/hr-rules', () => ({ attendancePolicy: vi.fn() }));
vi.mock('../server/services/workforce', () => ({ fail: (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); } }));
import { assertUnpaidLeaveUnchanged } from '../server/services/payroll-leave';

const period = { start: '2026-08-01', end: '2026-08-31' };
const employee: PayrollLeaveEmployee = { id: 7, joiningDate: '2026-01-01', contractEndDate: null, terminationDate: null };
const policy: PayrollLeavePolicy = { id: 2, config: { basis: 'salary', basicSalary: '3100.00', allowances: { housing: '620.00' },
  unpaidLeave: { ...defaultUnpaidLeaveRule, enabled: true } } };
function policies(config: Partial<PayrollLeavePolicy['config']> = {}, payPeriod = period) {
  return new Map(dateRange(payPeriod.start, payPeriod.end).map(day => [day, { ...policy, config: { ...policy.config, ...config } }]));
}
function source(id = 1, startDate = '2026-08-10', endDate = startDate, portion = 'full'): PayrollLeaveSource {
  return { id, employeeId: employee.id, leaveType: 'Unpaid personal leave', startDate, endDate, totalDays: dateRange(startDate, endDate).length,
    status: 'approved', reviewVersion: 2, approvalStage: 0, approvedBy: 9, approvedAt: '2026-08-01T08:00:00.000Z', updatedAt: '2026-08-01T08:00:00.000Z',
    snapshot: { dayPortion: portion, daysByYear: { '2026': 1 }, rules: dateRange(startDate, endDate).map(day => ({ day, counted: true, dayPortion: portion, leaveRuleId: 3, leavePolicy: { paid: false } })) } };
}
function calculate(sources = [source()], config: Partial<PayrollLeavePolicy['config']> = {}, person = employee) {
  return calculateUnpaidLeaveDeduction({ period, employee: person, policies: policies(config), sources });
}
function saved(sources: PayrollLeaveSource[], config: Partial<PayrollLeavePolicy['config']> = {}) {
  const result = calculate(sources, config);
  return { ...result, fingerprint: createHash('sha256').update(unpaidLeaveSourceState(result.sources, result.activeDates)).digest('hex') };
}
function transaction(sources: PayrollLeaveSource[]) {
  const rows = sources.map(row => ({ leave: { ...row, approvedAt: row.approvedAt ? new Date(row.approvedAt) : null, updatedAt: new Date(row.updatedAt) },
    snapshot: row.snapshot ? { ...row.snapshot, leaveId: row.id } : null }));
  const query: any = {};
  for (const name of ['from', 'leftJoin', 'where']) query[name] = vi.fn(() => query);
  query.orderBy = vi.fn(async () => rows);
  return { select: vi.fn(() => query) } as any;
}

describe('unpaid leave salary calculation', () => {
  test('uses the saved half-day portion and approved unpaid day rule', () => {
    const result = calculate([source(1, '2026-08-10', '2026-08-10', 'first_half')]);
    expect(result.amount).toBe('50.00');
    expect(result.lines[0]).toMatchObject({ units: 0.5, divisorDays: 31, amount: '50.00', monthlyBasic: '3100.00' });
  });

  test('counts only period and employment dates in a crossing request', () => {
    const result = calculate([source(1, '2026-07-30', '2026-08-05')], {}, { ...employee, joiningDate: '2026-08-03', terminationDate: '2026-08-04' });
    expect(result.amount).toBe('200.00');
    expect(result.lines[0].dates).toEqual(['2026-08-03', '2026-08-04']);
    expect(result.eligibleEarningsCap).toBe('200.00');
  });

  test('ignores saved paid, non-counted and unapproved days in one period', () => {
    const request = source(1, '2026-08-10', '2026-08-12');
    (request.snapshot!.rules as any[])[0].leavePolicy.paid = true;
    (request.snapshot!.rules as any[])[1].counted = false;
    const pending = { ...source(2, '2026-08-15'), status: 'pending', snapshot: null };
    const result = calculate([request, pending]);
    expect(result.amount).toBe('100.00');
    expect(result.lines[0].dates).toEqual(['2026-08-12']);
  });

  test.each(['hourly', 'daily', 'per_event'])('does not deduct from %s basis, including legacy leave', basis => {
    expect(calculate([{ ...source(), snapshot: null }], { basis }).amount).toBe('0.00');
  });

  test('disabled deductions preserve existing salary behavior without demanding snapshots', () => {
    expect(calculate([{ ...source(), snapshot: null }], { unpaidLeave: defaultUnpaidLeaveRule }).amount).toBe('0.00');
  });

  test('fails explicitly for missing or incomplete approved legacy snapshots only when enabled', () => {
    expect(() => calculate([{ ...source(), snapshot: null }])).toThrow(/has no saved day rules/);
    const request = source(); request.snapshot!.rules = [];
    expect(() => calculate([request])).toThrow(/incomplete saved rules/);
  });

  test('uses per-day effective policy and excludes hourly days in a mixed period', () => {
    const dailyPolicies = policies();
    dailyPolicies.set('2026-08-11', { id: 4, config: { ...policy.config, basicSalary: '6200.00' } });
    dailyPolicies.set('2026-08-12', { id: 5, config: { ...policy.config, basis: 'hourly' } });
    const result = calculateUnpaidLeaveDeduction({ period, employee, policies: dailyPolicies, sources: [source(1, '2026-08-10', '2026-08-12')] });
    expect(result.amount).toBe('300.00');
    expect(result.lines.map(line => line.payPolicyId)).toEqual([2, 4]);
  });

  test('working-days divisor uses all effective calendars and holidays across the full cycle', () => {
    const calendar: PayrollLeaveCalendar = { id: 11, hasSchedule: true, workingDays: [0, 1, 2, 3, 4], holidays: [{ date: '2026-08-02', name: 'Company holiday' }] };
    const calendars = new Map(dateRange(period.start, period.end).map(day => [day, calendar]));
    calendars.set('2026-08-31', { ...calendar, id: 12, workingDays: [] });
    const eligible = [...calendars].filter(([day, rule]) => rule.workingDays.includes(new Date(day).getUTCDay()) && !rule.holidays.some(h => h.date === day)).length;
    const result = calculateUnpaidLeaveDeduction({ period, employee: { ...employee, joiningDate: '2026-08-10' }, calendars,
      policies: policies({ unpaidLeave: { ...policy.config.unpaidLeave!, divisor: 'working_days' } }), sources: [source()] });
    expect(result.lines[0].divisorDays).toBe(eligible);
    expect(result.amount).toBe((Math.round(310000 / eligible) / 100).toFixed(2));
    expect(() => calculateUnpaidLeaveDeduction({ period, employee, calendars: new Map(), policies: policies({ unpaidLeave: { ...policy.config.unpaidLeave!, divisor: 'working_days' } }), sources: [source()] })).toThrow(/Configure a work calendar/);
  });

  test('caps basic and allowance deductions at each earned component and keeps line sums exact', () => {
    const result = calculate([source(1, '2026-08-10'), source(2, '2026-08-11')], { unpaidLeave: { ...policy.config.unpaidLeave!, deductionBase: 'basic_and_allowances', divisor: 'fixed', fixedDays: 1 } },
      { ...employee, joiningDate: '2026-08-10', terminationDate: '2026-08-11' });
    expect(result).toMatchObject({ amount: '240.00', eligibleEarningsCap: '240.00', uncappedAmount: '7440.00', cappedAmount: '7200.00' });
    expect(result.lines.map(line => [line.basicAmount, line.allowanceAmount, line.amount])).toEqual([['100.00', '20.00', '120.00'], ['100.00', '20.00', '120.00']]);
  });

  test('aggregates fractions before rounding and allocates odd cents deterministically', () => {
    const requests = [source(3, '2026-08-12'), source(1, '2026-08-10'), source(2, '2026-08-11')];
    const result = calculate(requests, { basicSalary: '1.00', unpaidLeave: { ...policy.config.unpaidLeave!, divisor: 'fixed', fixedDays: 3 } });
    expect(result.amount).toBe('1.00');
    expect(result.lines.map(line => [line.leaveId, line.amount])).toEqual([[1, '0.34'], [2, '0.33'], [3, '0.33']]);
    expect(calculate([...requests].reverse(), { basicSalary: '1.00', unpaidLeave: { ...policy.config.unpaidLeave!, divisor: 'fixed', fixedDays: 3 } }).lines).toEqual(result.lines);
  });

  test('rejects duplicate unpaid half-day coverage but allows complementary halves', () => {
    expect(() => calculate([source(1), source(2, '2026-08-10', '2026-08-10', 'first_half')])).toThrow(/overlaps/);
    expect(calculate([source(1, '2026-08-10', '2026-08-10', 'first_half'), source(2, '2026-08-10', '2026-08-10', 'second_half')]).amount).toBe('100.00');
  });
});

describe('saved unpaid leave source revalidation', () => {
  test('accepts unchanged sources with different jsonb object key order', async () => {
    const request = source(), snapshot = saved([request]);
    const rearranged = structuredClone(request);
    rearranged.snapshot!.rules = (request.snapshot!.rules as any[]).map(day => ({ leavePolicy: { paid: false }, leaveRuleId: 3, dayPortion: 'full', counted: true, day: day.day }));
    await expect(assertUnpaidLeaveUnchanged(transaction([rearranged]), employee.id, period, snapshot)).resolves.toBeUndefined();
  });

  test.each(['approved_pending', 'added', 'cancelled', 'revised', 'removed'])('requires fresh review after %s source mutation', async mutation => {
    const original = mutation === 'approved_pending' ? { ...source(), status: 'pending' } : source();
    const snapshot = saved([original]);
    let current = [structuredClone(original)];
    if (mutation === 'approved_pending') { current[0].status = 'approved'; current[0].reviewVersion++; }
    if (mutation === 'added') current.push(source(2, '2026-08-11'));
    if (mutation === 'cancelled') current[0].status = 'cancelled';
    if (mutation === 'revised') (current[0].snapshot!.rules as any[])[0].leavePolicy.paid = true;
    if (mutation === 'removed') current = [];
    await expect(assertUnpaidLeaveUnchanged(transaction(current), employee.id, period, snapshot)).rejects.toThrow(/Leave requests changed/);
  });

  test('uses saved disabled flags and avoids querying current rules or leave', async () => {
    const tx = transaction([source()]);
    await expect(assertUnpaidLeaveUnchanged(tx, employee.id, period, saved([], { unpaidLeave: defaultUnpaidLeaveRule }))).resolves.toBeUndefined();
    expect(tx.select).not.toHaveBeenCalled();
  });

  test('rejects mismatched scope and incomplete saved snapshot', async () => {
    await expect(assertUnpaidLeaveUnchanged(transaction([]), 99, period, saved([]))).rejects.toThrow(/does not match/);
    await expect(assertUnpaidLeaveUnchanged(transaction([]), employee.id, period, {})).rejects.toThrow(/incomplete/);
  });
});
