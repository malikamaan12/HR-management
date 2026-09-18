import { describe, expect, test } from 'vitest';
import { payrollRule, type PayrollRule } from '../shared/hr-rules';
import { calculateApprovedTime, type ApprovedTimeInput } from '../shared/payroll-time';
import { moneyCents } from '../shared/money';

const policy = (patch: Partial<PayrollRule> = {}): PayrollRule => payrollRule.parse({
  currency: 'QAR', cycleStartDay: 1, payDay: 5, basis: 'daily',
  basicSalary: '3000.00', hourlyRate: '10.00', dailyRate: '100.00', eventRate: '150.00',
  regularMinutesPerDay: 480, overtimeMultiplier: 1.5, allowances: {}, deductions: {}, approverId: 9,
  ...patch,
});
const sheet = (id: number, minutes: number, config = policy(), patch: Partial<ApprovedTimeInput> = {}): ApprovedTimeInput => ({
  timesheetId: id, assignmentId: id, workDate: '2026-09-01', payableMinutes: minutes,
  rule: { id: 1, config }, ...patch,
});

describe('approved time pay units', () => {
  test('one daily payment spans several shifts and only the excess daily minutes earn overtime', () => {
    const result = calculateApprovedTime([sheet(1, 300), sheet(2, 240), sheet(3, 480, policy(), { workDate: '2026-09-02' })]);
    expect(result.totalAmount).toBe('215.00');
    expect(result.lines.map(line => [line.regularMinutes, line.overtimeMinutes, line.amount])).toEqual([[300, 0, '100.00'], [180, 60, '15.00'], [480, 0, '100.00']]);
    expect(result.lines[1].snapshot).toMatchObject({ basis: 'daily', unit: 'day', baseAmount: '0.00', overtimeAmount: '15.00', baseUnits: { numerator: 0, denominator: 1 } });
  });

  test('a short approved shift earns a full day only when the policy chooses full-day pay', () => {
    expect(calculateApprovedTime([sheet(1, 1)]).totalAmount).toBe('100.00');
    expect(calculateApprovedTime([sheet(1, 240, policy({ dailyPayMethod: 'prorated' }))]).totalAmount).toBe('50.00');
  });

  test('daily prorating pays rounded cumulative differences and caps the base at one day', () => {
    const config = policy({ dailyPayMethod: 'prorated', dailyRate: '100.01', regularMinutesPerDay: 3, overtimeEnabled: false });
    const result = calculateApprovedTime([sheet(1, 1, config), sheet(2, 1, config), sheet(3, 1, config), sheet(4, 1, config)]);
    expect(result.lines.map(line => line.amount)).toEqual(['33.34', '33.33', '33.34', '0.00']);
    expect(result.totalAmount).toBe('100.01');
    expect(result.lines[3]).toMatchObject({ regularMinutes: 0, overtimeMinutes: 1 });
    expect(calculateApprovedTime([sheet(10, 3, config)]).totalAmount).toBe(result.totalAmount);
  });

  test('per-event pay means one assigned shift, with a shared daily overtime threshold', () => {
    const config = policy({ basis: 'per_event' });
    const result = calculateApprovedTime([sheet(1, 300, config), sheet(2, 300, config)]);
    expect(result.totalAmount).toBe('330.00');
    expect(result.lines.map(line => line.snapshot.baseAmount)).toEqual(['150.00', '150.00']);
    expect(result.lines[1].snapshot).toMatchObject({ unit: 'assignment', overtimeAmount: '30.00' });
  });

  test('multiple records for one assignment never produce duplicate shift base pay', () => {
    const config = policy({ basis: 'per_event', overtimeEnabled: false });
    const result = calculateApprovedTime([sheet(1, 100, config, { assignmentId: 7 }), sheet(2, 100, config, { assignmentId: 7, workDate: '2026-09-02' })]);
    expect(result.totalAmount).toBe('150.00');
    expect(result.lines[1].snapshot.baseUnits).toEqual({ numerator: 0, denominator: 1 });
  });

  test('zero-minute sheets neither earn base pay nor consume a daily or shift pay unit', () => {
    for (const basis of ['salary', 'hourly', 'daily', 'per_event'] as const) {
      const config = policy({ basis });
      const result = calculateApprovedTime([sheet(1, 0, config), sheet(2, 30, config, { assignmentId: 1 })]);
      expect(result.lines[0].amount).toBe('0.00');
      expect(result.lines[1].amount).toBe(basis === 'salary' ? '0.00' : basis === 'hourly' ? '5.00' : basis === 'daily' ? '100.00' : '150.00');
    }
  });

  test('salary time contributes overtime only and disabling overtime permits a zero hourly rate', () => {
    expect(calculateApprovedTime([sheet(1, 540, policy({ basis: 'salary' }))]).totalAmount).toBe('15.00');
    const result = calculateApprovedTime([sheet(1, 540, policy({ basis: 'daily', hourlyRate: '0.00', overtimeEnabled: false }))]);
    expect(result.totalAmount).toBe('100.00');
    expect(result.lines[0].overtimeMinutes).toBe(60);
    expect(result.lines[0].snapshot.overtimeAmount).toBe('0.00');
  });

  test('hourly results preserve combined per-timesheet regular and overtime rounding', () => {
    const config = policy({ basis: 'hourly', hourlyRate: '0.01', regularMinutesPerDay: 30 });
    const result = calculateApprovedTime([sheet(1, 45, config), sheet(2, 45, config)]);
    expect(result.lines.map(line => line.amount)).toEqual(['0.01', '0.01']);
    for (const line of result.lines) {
      const legacyCents = Number((BigInt(moneyCents(config.hourlyRate)) * BigInt(line.regularMinutes * 100 + line.overtimeMinutes * 150) + 3000n) / 6000n);
      expect(moneyCents(line.amount)).toBe(legacyCents);
      expect(moneyCents(line.snapshot.baseAmount) + moneyCents(line.snapshot.overtimeAmount)).toBe(legacyCents);
    }
  });

  test('policy changes on different work dates use their own rates and daily allowance', () => {
    const first = policy({ dailyRate: '100.00' }), second = policy({ dailyRate: '120.00' });
    const result = calculateApprovedTime([sheet(1, 480, first), sheet(2, 480, second, { workDate: '2026-09-02', rule: { id: 2, config: second } })]);
    expect(result.totalAmount).toBe('220.00');
  });

  test('invalid minutes, duplicate timesheets and conflicting daily policies cannot produce payroll', () => {
    for (const minutes of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => calculateApprovedTime([sheet(1, minutes)])).toThrow(/minutes/);
    }
    expect(() => calculateApprovedTime([sheet(1, 1), sheet(1, 1)])).toThrow(/twice/);
    expect(() => calculateApprovedTime([sheet(1, 1), sheet(2, 1, policy(), { rule: { id: 2, config: policy() } })])).toThrow(/consistent/);
    expect(() => calculateApprovedTime([sheet(1, 1), sheet(2, 1, policy({ dailyRate: '120.00' }))])).toThrow(/consistent/);
  });

  test('positive work requires the chosen base rate and enabled paid overtime requires an hourly rate', () => {
    for (const [basis, field] of [['hourly', 'hourlyRate'], ['daily', 'dailyRate'], ['per_event', 'eventRate']] as const) {
      const config = { ...policy({ basis }), [field]: '0.00' };
      expect(() => calculateApprovedTime([sheet(1, 1, config)])).toThrow(/positive/);
      if (basis === 'hourly') expect(calculateApprovedTime([sheet(1, 0, config)]).totalAmount).toBe('0.00');
    }
    expect(() => calculateApprovedTime([sheet(1, 481, policy({ hourlyRate: '0.00' }))])).toThrow(/positive hourly rate/);
  });

  test('unsafe totals are rejected instead of silently losing integer precision', () => {
    const config = policy({ basis: 'hourly', hourlyRate: '999999999.99' });
    expect(() => calculateApprovedTime([sheet(1, Number.MAX_SAFE_INTEGER, config)])).toThrow(/supported payroll total/);
    expect(calculateApprovedTime([])).toEqual({ lines: [], totalCents: 0, totalAmount: '0.00' });
  });
});
