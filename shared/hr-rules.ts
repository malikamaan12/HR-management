import { z } from 'zod';
export const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Choose a valid date');
export const positiveId = z.coerce.number().int().positive();
export const reason = z.string().trim().min(5).max(2000);
export const timezone = z.string().refine(v => { try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
}
catch {
    return false;
} }, 'Invalid timezone');
const days = z.number().min(0).max(366).multipleOf(0.01);
const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Use a positive amount with at most two decimals');
export const attendanceRule = z.object({ timezone, workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), breakMinutes: z.number().int().min(0).max(720), graceMinutes: z.number().int().min(0).max(120), holidays: z.array(z.object({ date: civilDate, name: z.string().trim().min(1).max(100) })).max(400) }).strict().refine(v => v.endTime > v.startTime && ((Number(v.endTime.slice(0, 2)) * 60 + Number(v.endTime.slice(3))) - (Number(v.startTime.slice(0, 2)) * 60 + Number(v.startTime.slice(3)))) > v.breakMinutes, 'End time must follow start time and allow for the break');
export const leaveRule = z.object({ paid: z.boolean(), balanceRequired: z.boolean(), accrualMode: z.enum(['none', 'annual', 'monthly']), annualDays: days, monthlyDays: days, carryoverLimit: days, minServiceDays: z.number().int().min(0).max(3650), maxConsecutiveDays: z.number().int().min(1).max(366), approverId: positiveId.nullable(), allowHalfDays:z.boolean().default(false),additionalApproverIds:z.array(positiveId).max(3).default([]) }).strict().refine(v=>new Set(v.additionalApproverIds).size===v.additionalApproverIds.length&&!v.additionalApproverIds.includes(v.approverId||0),'Each approval stage must have a different approver');
export const unpaidLeaveDeductionLabel = 'Approved unpaid leave';
export const unpaidLeavePayrollRule = z.object({
    enabled: z.boolean().default(false),
    deductionBase: z.enum(['basic', 'basic_and_allowances']).default('basic'),
    divisor: z.enum(['calendar_days', 'working_days', 'fixed']).default('calendar_days'),
    fixedDays: z.number().int().min(1).max(366).default(30),
}).strict();
const payItems = z.record(amount).refine(v => Object.keys(v).length <= 50 && Object.keys(v).every(k => k.trim().length > 0 && k.length <= 100 && !['__proto__', 'constructor', 'prototype', 'Approved time', unpaidLeaveDeductionLabel].includes(k)), 'Use up to 50 named items; Approved time and Approved unpaid leave are reserved');
export const payrollRule = z.object({
    currency: z.string().regex(/^[A-Z]{3}$/), cycleStartDay: z.number().int().min(1).max(28), payDay: z.number().int().min(1).max(28),
    basis: z.enum(['salary', 'hourly', 'daily', 'per_event']), basicSalary: amount, hourlyRate: amount,
    dailyRate: amount.default('0.00'), eventRate: amount.default('0.00'), dailyPayMethod: z.enum(['full_day', 'prorated']).default('full_day'),
    eventPayUnit: z.literal('assignment').default('assignment'), overtimeEnabled: z.boolean().default(true),
    regularMinutesPerDay: z.number().int().min(1).max(1440), overtimeMultiplier: z.number().min(1).max(5).multipleOf(0.01),
    unpaidLeave: unpaidLeavePayrollRule.default({}), allowances: payItems, deductions: payItems, approverId: positiveId,
}).strict().superRefine((v, ctx) => {
    if (v.payDay < v.cycleStartDay - 1) ctx.addIssue({ code: 'custom', path: ['payDay'], message: 'Payday must be on or after the period end in the payment month' });
    if (v.basis === 'daily' && Number(v.dailyRate) <= 0) ctx.addIssue({ code: 'custom', path: ['dailyRate'], message: 'Daily pay requires a positive day rate' });
    if (v.basis === 'per_event' && Number(v.eventRate) <= 0) ctx.addIssue({ code: 'custom', path: ['eventRate'], message: 'Per-event pay requires a positive assigned-shift rate' });
});
const common = { employeeId: positiveId.nullable(), effectiveFrom: civilDate, name: z.string().trim().min(1).max(100), reason };
export const ruleInput = z.discriminatedUnion('kind', [
    z.object({ ...common, kind: z.literal('attendance'), config: attendanceRule }).strict(),
    z.object({ ...common, kind: z.literal('leave'), config: leaveRule }).strict(),
    z.object({ ...common, kind: z.literal('payroll'), config: payrollRule }).strict(),
]);
export type AttendanceRule = z.infer<typeof attendanceRule>;
export type LeaveRule = z.infer<typeof leaveRule>;
export type PayrollRule = z.infer<typeof payrollRule>;
export const dayAt = (now: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function dateRange(start: string, end: string) { civilDate.parse(start); civilDate.parse(end); if (end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000)
    throw new z.ZodError([{ code: 'custom', path: ['endDate'], message: 'Choose an end date on or after the start, within one year' }]); const out: string[] = []; for (let d = Date.parse(start); d <= Date.parse(end); d += 86400000)
    out.push(new Date(d).toISOString().slice(0, 10)); return out; }
export function payPeriod(year: number, month: number, startDay: number) { const end = new Date(Date.UTC(year, month - 1, startDay)); const start = new Date(Date.UTC(year, month - 2, startDay)); return { start: start.toISOString().slice(0, 10), end: new Date(+end - 86400000).toISOString().slice(0, 10) }; }
