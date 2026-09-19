import { z } from 'zod';
import { positiveId, reason } from './hr-rules';

export const letterFields = {
  company_name: 'Company name', company_address: 'Company address', company_email: 'Company email', company_phone: 'Company phone',
  employee_name: 'Employee full name', employee_id: 'Employee reference', position: 'Job title', department: 'Department',
  employment_type: 'Employment type', joining_date: 'Joining date', work_location: 'Work location',
  letter_date: 'Preparation date', recipient: 'Recipient', purpose: 'Request purpose', reference: 'Letter reference',
  pay_currency: 'Compensation currency', base_pay: 'Base pay with frequency', monthly_cash_total: 'Monthly cash components only',
  compensation_breakdown: 'Full compensation breakdown', compensation_effective_date: 'Compensation effective date',
} as const;
export type LetterField = keyof typeof letterFields;
export const payFields: LetterField[] = ['pay_currency', 'base_pay', 'monthly_cash_total', 'compensation_breakdown', 'compensation_effective_date'];
export function templateFields(text: string): LetterField[] {
  const fields = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(match => match[1]);
  const remainder = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, '');
  if (remainder.includes('{{') || remainder.includes('}}') || fields.some(field => !Object.hasOwn(letterFields, field))) throw new Error('Use only the supported {{field_name}} placeholders');
  return [...new Set(fields)] as LetterField[];
}
const templateText = (max: number) => z.string().trim().min(3).max(max).superRefine((value, ctx) => {
  try { templateFields(value); } catch (error) { ctx.addIssue({ code: 'custom', message: (error as Error).message }); }
});
export const letterDefinition = z.object({
  name: z.string().trim().min(3).max(150), description: z.string().trim().max(1000),
  title: templateText(200), body: templateText(16000), signatoryTitle: z.string().trim().min(2).max(150),
  employeeTypes: z.array(z.enum(['permanent', 'temporary', 'contract'])).min(1).max(3),
}).strict();
export type LetterDefinition = z.infer<typeof letterDefinition>;
export const letterTemplateCreate = z.object({ code: z.string().regex(/^[a-z][a-z0-9_-]{2,59}$/), definition: letterDefinition, reason }).strict();
export const letterRequestInput = z.object({ employeeId: positiveId, templateId: positiveId, recipient: z.string().trim().min(2).max(250), purpose: reason, submissionKey: z.string().uuid() }).strict();
export const letterCorrection = letterRequestInput.omit({ employeeId: true, submissionKey: true }).extend({ version: positiveId }).strict();
export const letterAction = z.object({ version: positiveId, reason, confirmed: z.literal(true).optional() }).strict();
export const letterStatuses = ['requested', 'prepared', 'returned', 'issued', 'rejected', 'cancelled', 'revoked'] as const;
export type LetterStatus = typeof letterStatuses[number];
export const letterManagers = (role: string) => ['admin', 'super_admin', 'hr_director', 'hr_manager', 'hr'].includes(role);
export const letterPublishers = (role: string) => ['admin', 'super_admin'].includes(role);
export type LetterTemplate = { id: number; code: string; revision: number; version: number; status: 'draft' | 'published' | 'archived'; definition: LetterDefinition; created_at: string };
export type LetterSnapshot = { title: string; body: string; companyName: string; companyAddress: string; companyEmail: string; companyPhone: string; signatoryTitle: string; date: string; sourceHash: string; compensationVersion: number | null };
export type LetterRequest = { id: number; reference: string; employee_id: number; template_id: number; employee_name: string; template_name: string; status: LetterStatus; version: number; recipient: string; purpose: string; created_by: number; prepared_by: number | null; issued_by: number | null; issued_by_name: string | null; issued_at: string | null; snapshot: LetterSnapshot | null; created_at: string };
export type LetterDetail = { row: LetterRequest; actions: { prepare: boolean; issue: boolean; return: boolean; reject: boolean; cancel: boolean; correct: boolean; revoke: boolean }; history: { version: number; reason: string; created_at: string; status: string }[] };

export function renderLetterText(text: string, values: Partial<Record<LetterField, string>>, maxLength = 120000) {
  templateFields(text);
  let size = text.length;
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, field: LetterField) => {
    if (values[field] === undefined || values[field] === '') throw new Error(`Complete ${letterFields[field]} before preparing this letter`);
    size += values[field]!.length - match.length;
    if (size > maxLength) throw new Error('The generated letter is too long. Shorten the template or compensation terms.');
    return values[field]!;
  });
}
