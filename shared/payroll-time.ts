import { civilDate, payrollRule, type PayrollRule } from './hr-rules';
import { moneyCents, moneyText } from './money';

export interface ApprovedTimeInput {
  timesheetId: number;
  assignmentId: number;
  workDate: string;
  payableMinutes: number;
  rule: { id: number; config: PayrollRule };
}

export interface ApprovedTimeSnapshot {
  basis: PayrollRule['basis'];
  unit: 'hour' | 'day' | 'assignment' | 'salary';
  rate: string;
  baseAmount: string;
  overtimeAmount: string;
  baseUnits: { numerator: number; denominator: number };
  overtimeHourlyRate: string;
  overtimeMultiplier: number;
  overtimeEnabled: boolean;
  dailyPayMethod: PayrollRule['dailyPayMethod'] | null;
  regularMinutesPerDay: number;
  cumulativeRegularMinutes: number;
}

export interface ApprovedTimeLine {
  timesheetId: number;
  assignmentId: number;
  workDate: string;
  regularMinutes: number;
  overtimeMinutes: number;
  amount: string;
  snapshot: ApprovedTimeSnapshot;
}

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function safeCents(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Approved time amount exceeds the supported payroll total');
  }
  return Number(value);
}

function positiveId(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
}

/**
 * Calculate one employee's approved time in its existing chronological order.
 * The caller resolves local work dates, effective policies, approvals and payroll
 * reservations. This function does not infer approval or employment eligibility.
 */
export function calculateApprovedTime(inputs: readonly ApprovedTimeInput[]): {
  lines: ApprovedTimeLine[];
  totalCents: number;
  totalAmount: string;
} {
  const daily = new Map<string, { ruleId: number; signature: string; regularMinutes: number; baseCents: bigint; hasWork: boolean }>();
  const paidAssignments = new Set<number>();
  const seenSheets = new Set<number>();
  const lines: ApprovedTimeLine[] = [];
  let totalCents = 0n;

  for (const input of inputs) {
    positiveId(input.timesheetId, 'timesheet ID');
    positiveId(input.assignmentId, 'assignment ID');
    positiveId(input.rule.id, 'pay policy ID');
    civilDate.parse(input.workDate);
    if (!Number.isSafeInteger(input.payableMinutes) || input.payableMinutes < 0) {
      throw new Error('Approved payable minutes must be a non-negative safe integer');
    }
    if (seenSheets.has(input.timesheetId)) throw new Error('An approved timesheet cannot be included twice');
    seenSheets.add(input.timesheetId);

    const config = payrollRule.parse(input.rule.config);
    const signature = JSON.stringify(config);
    const day = daily.get(input.workDate) ?? { ruleId: input.rule.id, signature, regularMinutes: 0, baseCents: 0n, hasWork: false };
    if (day.ruleId !== input.rule.id || day.signature !== signature) {
      throw new Error('A work date must use one consistent pay policy');
    }

    const regularMinutes = Math.min(input.payableMinutes, Math.max(0, config.regularMinutesPerDay - day.regularMinutes));
    const overtimeMinutes = input.payableMinutes - regularMinutes;
    const cumulativeRegularMinutes = day.regularMinutes + regularMinutes;
    const hasWork = input.payableMinutes > 0;
    const hourlyRate = BigInt(moneyCents(config.hourlyRate));
    const baseRate = BigInt(moneyCents(config.basis === 'daily' ? config.dailyRate : config.basis === 'per_event' ? config.eventRate : config.basis === 'hourly' ? config.hourlyRate : config.basicSalary));
    if (hasWork && config.basis !== 'salary' && baseRate === 0n) {
      throw new Error(`Configure a positive ${config.basis === 'daily' ? 'daily' : config.basis === 'per_event' ? 'per-event' : 'hourly'} rate for approved work`);
    }
    if (config.overtimeEnabled && overtimeMinutes > 0 && hourlyRate === 0n) {
      throw new Error('Configure a positive hourly rate for paid overtime work');
    }

    const multiplier = BigInt(Math.round(config.overtimeMultiplier * 100));
    const overtimeNumerator = config.overtimeEnabled ? hourlyRate * BigInt(overtimeMinutes) * multiplier : 0n;
    let baseCents = 0n;
    let overtimeCents = roundedRatio(overtimeNumerator, 6000n);
    let baseUnits = { numerator: 0, denominator: 1 };
    let unit: ApprovedTimeSnapshot['unit'] = 'salary';

    if (config.basis === 'hourly') {
      unit = 'hour';
      baseUnits = { numerator: regularMinutes, denominator: 60 };
      const regularNumerator = hourlyRate * BigInt(regularMinutes) * 100n;
      baseCents = roundedRatio(regularNumerator, 6000n);
      // Preserve the existing hourly result, which rounds the combined regular
      // and overtime amount once per timesheet, including half-cent boundaries.
      overtimeCents = roundedRatio(regularNumerator + overtimeNumerator, 6000n) - baseCents;
    } else if (config.basis === 'daily') {
      unit = 'day';
      if (config.dailyPayMethod === 'prorated') {
        baseUnits = { numerator: regularMinutes, denominator: config.regularMinutesPerDay };
        const cumulativeBase = roundedRatio(baseRate * BigInt(cumulativeRegularMinutes), BigInt(config.regularMinutesPerDay));
        // Assign only the difference from the cumulative rounded daily amount.
        // Splitting one day into several shifts cannot create rounding pennies.
        baseCents = cumulativeBase - day.baseCents;
      } else if (hasWork && !day.hasWork) {
        baseUnits = { numerator: 1, denominator: 1 };
        baseCents = baseRate;
      }
    } else if (config.basis === 'per_event') {
      unit = 'assignment';
      if (hasWork && !paidAssignments.has(input.assignmentId)) {
        baseUnits = { numerator: 1, denominator: 1 };
        baseCents = baseRate;
        paidAssignments.add(input.assignmentId);
      }
    }

    const amountCents = baseCents + overtimeCents;
    totalCents += amountCents;
    lines.push({
      timesheetId: input.timesheetId,
      assignmentId: input.assignmentId,
      workDate: input.workDate,
      regularMinutes,
      overtimeMinutes,
      amount: moneyText(safeCents(amountCents)),
      snapshot: {
        basis: config.basis, unit, rate: moneyText(safeCents(baseRate)),
        baseAmount: moneyText(safeCents(baseCents)), overtimeAmount: moneyText(safeCents(overtimeCents)),
        baseUnits, overtimeHourlyRate: moneyText(safeCents(hourlyRate)),
        overtimeMultiplier: config.overtimeMultiplier, overtimeEnabled: config.overtimeEnabled,
        dailyPayMethod: config.basis === 'daily' ? config.dailyPayMethod : null,
        regularMinutesPerDay: config.regularMinutesPerDay, cumulativeRegularMinutes,
      },
    });
    day.regularMinutes = cumulativeRegularMinutes;
    day.baseCents += baseCents;
    day.hasWork ||= hasWork;
    daily.set(input.workDate, day);
  }

  const cents = safeCents(totalCents);
  return { lines, totalCents: cents, totalAmount: moneyText(cents) };
}
