import { z } from 'zod';
import { civilDate, reason, positiveId, unpaidLeavePayrollRule, unpaidLeaveDeductionLabel } from './hr-rules';
import { moneyCents, moneyText } from './money';

export const compensationCategories = ['base', 'housing', 'transportation', 'food', 'travel', 'flight_tickets', 'vehicle', 'benefits', 'other'] as const;
export const compensationLabels: Record<typeof compensationCategories[number], string> = {
  base: 'Base salary', housing: 'Housing allowance', transportation: 'Transportation allowance', food: 'Food allowance',
  travel: 'Business travel / transport', flight_tickets: 'Flight tickets', vehicle: 'Vehicle', benefits: 'Benefits', other: 'Other',
};
export const compensationFrequencies = ['monthly', 'annual', 'one_time', 'hourly', 'daily', 'per_event', 'on_request'] as const;
export const compensationProvisions = ['cash', 'provided', 'reimbursement', 'not_applicable'] as const;
const amount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount with up to two decimals');
export const compensationItem = z.object({
  category: z.enum(compensationCategories), label: z.string().trim().min(1).max(100).refine(v => !['__proto__', 'constructor', 'prototype', 'Approved time', unpaidLeaveDeductionLabel].includes(v), 'Choose a different label'),
  provision: z.enum(compensationProvisions), frequency: z.enum(compensationFrequencies), amount,
  terms: z.string().trim().max(2000),
}).strict().superRefine((v, ctx) => {
  if (v.provision === 'not_applicable' && moneyCents(v.amount) !== 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Not applicable items must have a zero amount' });
  if (['provided', 'reimbursement'].includes(v.provision) && !v.terms) ctx.addIssue({ code: 'custom', path: ['terms'], message: 'Describe the benefit, entitlement or reimbursement conditions' });
  if (v.category === 'base' && v.provision !== 'not_applicable' && (v.provision !== 'cash' || !['monthly', 'hourly', 'daily', 'per_event'].includes(v.frequency))) ctx.addIssue({ code: 'custom', message: 'Base pay must be cash paid monthly, hourly, daily or per event' });
  if (v.category === 'base' && v.provision === 'not_applicable' && !v.terms) ctx.addIssue({ code: 'custom', path: ['terms'], message: 'Explain why base pay is not applicable' });
  if (v.provision === 'cash' && v.frequency === 'on_request') ctx.addIssue({ code: 'custom', path: ['frequency'], message: 'Use reimbursement for on-request amounts' });
});
export const compensationDefinition = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
  items: z.array(compensationItem).min(9).max(40), notes: z.string().trim().max(4000),
}).strict().superRefine((v, ctx) => {
  for (const category of compensationCategories) if (!v.items.some(i => i.category === category)) ctx.addIssue({ code: 'custom', path: ['items'], message: `Record ${compensationLabels[category]}, including when not applicable` });
  if (v.items.filter(i => i.category === 'base').length !== 1) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Record exactly one base pay item' });
  if (new Set(v.items.map(i => i.label.toLowerCase())).size !== v.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Each item needs a unique label' });
  if (v.items.reduce((sum, item) => sum + moneyCents(item.amount), 0) > 99999999999) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Package amounts exceed the supported limit' });
});
export const compensationRevisionInput = z.object({ expectedVersion: z.number().int().nonnegative(), effectiveFrom: civilDate, definition: compensationDefinition, reason }).strict();
export const compensationPayrollInput = z.object({
  expectedVersion: positiveId, expectedRuleId: positiveId.nullable(), reason, confirmed: z.literal(true),
  cycleStartDay: z.number().int().min(1).max(28), payDay: z.number().int().min(1).max(28),
  regularMinutesPerDay: z.number().int().min(1).max(1440), overtimeMultiplier: z.number().min(1).max(5).multipleOf(0.01), approverId: positiveId,
  hourlyRate: amount,
  dailyPayMethod: z.enum(['full_day', 'prorated']).optional(),
  overtimeEnabled: z.boolean().optional(),
  unpaidLeave: unpaidLeavePayrollRule.optional(),
}).strict();
export type CompensationItem = z.infer<typeof compensationItem>;
export type CompensationDefinition = z.infer<typeof compensationDefinition>;
export type CompensationRevision = { id: number; employeeId: number; version: number; effectiveFrom: string; definition: CompensationDefinition; reason: string; createdAt: string; createdBy: number };
export function emptyCompensation(): CompensationDefinition {
  return { currency: 'QAR', notes: '', items: compensationCategories.map(category => ({ category, label: compensationLabels[category], provision: category === 'base' ? 'cash' : 'not_applicable', frequency: ['flight_tickets'].includes(category) ? 'annual' : 'monthly', amount: '0.00', terms: '' })) };
}
export function compensationTotals(definition: CompensationDefinition) {
  const totals = Object.fromEntries(compensationFrequencies.map(frequency => [frequency, 0])) as Record<typeof compensationFrequencies[number], number>;
  for (const item of definition.items) if (item.provision === 'cash') totals[item.frequency] += moneyCents(item.amount);
  return Object.fromEntries(compensationFrequencies.map(frequency => [frequency, moneyText(totals[frequency])])) as Record<typeof compensationFrequencies[number], string>;
}
export const compensationManagers = (role: string) => ['admin', 'super_admin', 'hr_director', 'hr'].includes(role);
export const compensationDetailedReaders = (role: string) => compensationManagers(role) || ['hr_manager', 'payroll_specialist', 'finance', 'finance_audit'].includes(role);
