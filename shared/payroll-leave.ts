import { dateRange } from './hr-rules';
import { moneyCents, moneyText } from './money';

export type UnpaidLeaveRule = {
  enabled: boolean;
  deductionBase: 'basic' | 'basic_and_allowances';
  divisor: 'calendar_days' | 'working_days' | 'fixed';
  fixedDays: number;
};
export const defaultUnpaidLeaveRule: UnpaidLeaveRule = {
  enabled: false, deductionBase: 'basic', divisor: 'calendar_days', fixedDays: 30,
};
export type PayrollLeaveEmployee = {
  id: number; joiningDate: string; contractEndDate: string | null; terminationDate: string | null;
};
export type PayrollLeavePolicy = {
  id: number;
  config: { basis: string; basicSalary: string; allowances: Record<string, string>; unpaidLeave?: UnpaidLeaveRule };
};
export type PayrollLeaveCalendar = {
  id: number | null; hasSchedule: boolean; workingDays: number[]; holidays: { date: string; name: string }[];
};
export type PayrollLeaveSource = {
  id: number; employeeId: number; leaveType: string; startDate: string; endDate: string;
  totalDays: number; status: string; reviewVersion: number; approvalStage: number;
  approvedBy: number | null; approvedAt: string | null; updatedAt: string;
  snapshot: { dayPortion: string; rules: unknown; daysByYear: Record<string, number> } | null;
};
export type UnpaidLeaveLine = {
  leaveId: number; leaveType: string; leaveVersion: number; payPolicyId: number;
  dates: string[]; units: number; deductionBase: UnpaidLeaveRule['deductionBase'];
  divisor: UnpaidLeaveRule['divisor']; divisorDays: number;
  monthlyBasic: string; monthlyAllowances: string;
  basicAmount: string; allowanceAmount: string; amount: string; uncappedAmount: string;
};
export type UnpaidLeaveCalculation = {
  version: 1; period: { start: string; end: string }; employee: PayrollLeaveEmployee;
  activeDates: string[]; policies: Record<string, PayrollLeavePolicy>; calendars: Record<string, PayrollLeaveCalendar>;
  sources: PayrollLeaveSource[]; lines: UnpaidLeaveLine[];
  amount: string; uncappedAmount: string; cappedAmount: string; eligibleEarningsCap: string;
  rounding: 'aggregate_component_half_up_largest_remainder';
  capMethod: 'earned_salary_and_eligible_allowances_excluding_approved_time';
};
export type UnpaidLeaveSnapshot = UnpaidLeaveCalculation & { fingerprint: string };

export function employedOn(employee: PayrollLeaveEmployee, day: string) {
  return day >= employee.joiningDate && (!employee.contractEndDate || day <= employee.contractEndDate)
    && (!employee.terminationDate || day <= employee.terminationDate);
}
export function unpaidLeaveActiveDates(employee: PayrollLeaveEmployee, period: { start: string; end: string }, policies: ReadonlyMap<string, PayrollLeavePolicy>) {
  return dateRange(period.start, period.end).filter(day => {
    const policy = policies.get(day);
    if (!policy) throw new Error(`Missing saved pay policy on ${day}`);
    return employedOn(employee, day) && policy.config.basis === 'salary' && policy.config.unpaidLeave?.enabled === true;
  });
}
export function relevantUnpaidLeaveSources(sources: PayrollLeaveSource[], activeDates: string[]) {
  return sources.filter(source => activeDates.some(day => day >= source.startDate && day <= source.endDate))
    .slice().sort((a, b) => a.id - b.id);
}
/** Canonical JSON keeps database jsonb key ordering and query row order out of the comparison. */
export function unpaidLeaveSourceState(sources: PayrollLeaveSource[], activeDates: string[]) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
    return value;
  };
  return JSON.stringify(canonical(relevantUnpaidLeaveSources(sources, activeDates)));
}

type Fraction = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => b ? gcd(b, a % b) : a;
const fraction = (n: bigint, d: bigint): Fraction => { const g = gcd(n, d); return { n: n / g, d: d / g }; };
const add = (a: Fraction, b: Fraction) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const round = (value: Fraction) => Number((value.n * 2n + value.d) / (value.d * 2n));
const sum = (values: Fraction[]) => values.reduce(add, { n: 0n, d: 1n });

/** Allocate integer cents deterministically; capped components are reduced proportionately. */
function allocate(values: Fraction[], target: number) {
  const total = sum(values);
  if (!total.n) return values.map(() => 0);
  const ratios = target < round(total)
    ? values.map(value => fraction(value.n * BigInt(target) * total.d, value.d * total.n)) : values;
  const output = ratios.map(value => Number(value.n / value.d));
  const order = ratios.map((value, index) => ({ index, remainder: value.n % value.d, denominator: value.d }))
    .sort((a, b) => {
      const difference = a.remainder * b.denominator - b.remainder * a.denominator;
      return difference > 0n ? -1 : difference < 0n ? 1 : a.index - b.index;
    });
  const missing = target - output.reduce((a, b) => a + b, 0);
  for (let i = 0; i < missing; i++) output[order[i].index]++;
  return output;
}

/** Only the immutable approved request snapshot decides whether a leave day is unpaid. */
export function calculateUnpaidLeaveDeduction(input: {
  employee: PayrollLeaveEmployee; period: { start: string; end: string };
  policies: ReadonlyMap<string, PayrollLeavePolicy>; calendars?: ReadonlyMap<string, PayrollLeaveCalendar>;
  sources: PayrollLeaveSource[];
}): UnpaidLeaveCalculation {
  const { employee, period, policies } = input, dates = dateRange(period.start, period.end);
  const activeDates = unpaidLeaveActiveDates(employee, period, policies), active = new Set(activeDates);
  const sources = relevantUnpaidLeaveSources(input.sources, activeDates), calendars = input.calendars || new Map<string, PayrollLeaveCalendar>();
  const workingDivisorNeeded = activeDates.some(day => policies.get(day)!.config.unpaidLeave!.divisor === 'working_days');
  let workingDays = 0;
  if (workingDivisorNeeded) for (const day of dates) {
    const calendar = calendars.get(day);
    if (!calendar?.hasSchedule) throw new Error(`Configure a work calendar on ${day} before using the working-days unpaid leave divisor`);
    if (calendar.workingDays.includes(new Date(day).getUTCDay()) && !calendar.holidays.some(holiday => holiday.date === day)) workingDays++;
  }
  if (workingDivisorNeeded && workingDays === 0) throw new Error('The pay period has no working days; choose another unpaid leave divisor or correct the work calendar');
  const groups = new Map<string, { line: UnpaidLeaveLine; basic: Fraction; allowances: Fraction }>();
  const occupied = new Set<string>();
  for (const source of sources) {
    if (source.employeeId !== employee.id) throw new Error('Leave belongs to another employee');
    if (source.status !== 'approved') continue;
    const rules = source.snapshot?.rules;
    if (!source.snapshot || !Array.isArray(rules)) throw new Error(`Approved leave #${source.id} has no saved day rules. Reconcile or recreate the request before generating payroll with unpaid leave deductions`);
    for (const day of activeDates.filter(date => date >= source.startDate && date <= source.endDate)) {
      const matches = rules.filter(rule => rule && typeof rule === 'object' && rule.day === day);
      if (matches.length !== 1 || typeof matches[0].counted !== 'boolean' || typeof matches[0].leavePolicy?.paid !== 'boolean')
        throw new Error(`Approved leave #${source.id} has incomplete saved rules on ${day}. Reconcile the leave request before generating payroll`);
      const saved = matches[0];
      if (!saved.counted || saved.leavePolicy.paid) continue;
      const portion = saved.dayPortion ?? source.snapshot.dayPortion;
      if (!['full', 'first_half', 'second_half'].includes(portion)) throw new Error(`Approved leave #${source.id} has an invalid saved day portion on ${day}`);
      const slots = portion === 'full' ? ['first_half', 'second_half'] : [portion];
      for (const slot of slots) {
        const key = `${day}:${slot}`;
        if (occupied.has(key)) throw new Error(`Approved unpaid leave overlaps on ${day}; reconcile the duplicate requests before generating payroll`);
        occupied.add(key);
      }
      const policy = policies.get(day)!, rule = policy.config.unpaidLeave!;
      const divisor = rule.divisor === 'calendar_days' ? dates.length : rule.divisor === 'working_days' ? workingDays : rule.fixedDays;
      if (!Number.isInteger(divisor) || divisor < 1 || divisor > 366) throw new Error('Unpaid leave divisor must be between 1 and 366 days');
      const basic = moneyCents(policy.config.basicSalary), allowances = rule.deductionBase === 'basic_and_allowances'
        ? Object.values(policy.config.allowances).reduce((total, amount) => total + moneyCents(amount), 0) : 0;
      const key = [source.id, policy.id, rule.deductionBase, rule.divisor, divisor, basic, allowances].join(':');
      let group = groups.get(key);
      if (!group) {
        group = { line: { leaveId: source.id, leaveType: source.leaveType, leaveVersion: source.reviewVersion, payPolicyId: policy.id,
          dates: [], units: 0, deductionBase: rule.deductionBase, divisor: rule.divisor, divisorDays: divisor,
          monthlyBasic: moneyText(basic), monthlyAllowances: moneyText(allowances), basicAmount: '0.00', allowanceAmount: '0.00', amount: '0.00', uncappedAmount: '0.00' },
          basic: { n: 0n, d: 1n }, allowances: { n: 0n, d: 1n } };
        groups.set(key, group);
      }
      const units = portion === 'full' ? 2 : 1;
      group.line.dates.push(day); group.line.units += units / 2;
      group.basic = add(group.basic, fraction(BigInt(basic) * BigInt(units), BigInt(divisor * 2)));
      group.allowances = add(group.allowances, fraction(BigInt(allowances) * BigInt(units), BigInt(divisor * 2)));
    }
  }
  // Salary proration matches payroll generation. Approved time/overtime is never an eligible cap pool.
  let basicNumerator = 0;
  const allowanceNumerators: Record<string, number> = {};
  for (const day of dates) {
    const policy = policies.get(day)!;
    if (!employedOn(employee, day) || policy.config.basis !== 'salary') continue;
    basicNumerator += moneyCents(policy.config.basicSalary);
    for (const [name, amount] of Object.entries(policy.config.allowances)) allowanceNumerators[name] = (allowanceNumerators[name] || 0) + moneyCents(amount);
  }
  const capBasic = Math.round(basicNumerator / dates.length), capAllowances = Object.values(allowanceNumerators).reduce((total, amount) => total + Math.round(amount / dates.length), 0);
  const rows = [...groups.values()], basicValues = rows.map(row => row.basic), allowanceValues = rows.map(row => row.allowances);
  const rawBasic = round(sum(basicValues)), rawAllowances = round(sum(allowanceValues));
  const actualBasic = Math.min(rawBasic, capBasic), actualAllowances = Math.min(rawAllowances, capAllowances);
  const basicAllocated = allocate(basicValues, actualBasic), allowanceAllocated = allocate(allowanceValues, actualAllowances);
  const rawBasicAllocated = allocate(basicValues, rawBasic), rawAllowanceAllocated = allocate(allowanceValues, rawAllowances);
  rows.forEach((row, index) => Object.assign(row.line, {
    basicAmount: moneyText(basicAllocated[index]), allowanceAmount: moneyText(allowanceAllocated[index]),
    amount: moneyText(basicAllocated[index] + allowanceAllocated[index]), uncappedAmount: moneyText(rawBasicAllocated[index] + rawAllowanceAllocated[index]),
  }));
  const usesAllowances = activeDates.some(day => policies.get(day)!.config.unpaidLeave!.deductionBase === 'basic_and_allowances');
  return {
    version: 1, period: { ...period }, employee: { ...employee }, activeDates,
    policies: Object.fromEntries(policies), calendars: Object.fromEntries(calendars), sources, lines: rows.map(row => row.line),
    amount: moneyText(actualBasic + actualAllowances), uncappedAmount: moneyText(rawBasic + rawAllowances),
    cappedAmount: moneyText(rawBasic + rawAllowances - actualBasic - actualAllowances),
    eligibleEarningsCap: moneyText(active.size ? capBasic + (usesAllowances ? capAllowances : 0) : 0),
    rounding: 'aggregate_component_half_up_largest_remainder', capMethod: 'earned_salary_and_eligible_allowances_excluding_approved_time',
  };
}
