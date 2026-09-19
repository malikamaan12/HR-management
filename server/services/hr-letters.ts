import { and, eq, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { employees, appSettings } from '@shared/schema';
import { companySettingsSchema } from '@shared/settings';
import { compensationTotals } from '@shared/compensation';
import { letterDefinition, letterManagers, letterPublishers, payFields, templateFields, renderLetterText, type LetterField, type LetterSnapshot } from '@shared/hr-letters';
import { employeeScope } from './access';
import { effectiveCompensation, compensationEmployee } from './compensation';
import { WorkflowError, qatarToday } from './workflowRecords';
import type { TokenPayload } from './auth';

export const managerScope = (user: TokenPayload) => letterManagers(user.role) ? employeeScope(user, 'employee_database', 'update') : sql`false`;
export const letterScope = (user: TokenPayload) => or(eq(employees.userId, user.userId), managerScope(user))!;
export function requireLetterPublisher(user: TokenPayload) { if (!letterPublishers(user.role)) throw new WorkflowError(403, 'Only administrators can maintain letter templates'); }
export function letterVersion(actual: number, expected: number) { if (actual !== expected) throw new WorkflowError(409, 'This record changed. Reload before continuing.'); }
export function requireActiveLetterEmployee(employee: any) {
  if (employee.status === 'inactive' || employee.joiningDate > qatarToday() || employee.terminationDate && employee.terminationDate <= qatarToday()) throw new WorkflowError(409, 'A current active employee record is required');
}
export async function letterEmployee(tx: any, user: TokenPayload, id: number, write = false, lock = false) {
  const query = tx.select().from(employees).where(and(eq(employees.id, id), write ? managerScope(user) : letterScope(user)));
  const [employee] = lock ? await query.for('update') : await query;
  if (!employee) throw new WorkflowError(404, 'Employee not found within your access');
  return employee;
}
export async function publishedLetterTemplate(tx: any, id: number, employee?: any) {
  const row = (await tx.execute(sql`SELECT * FROM hr_letter_templates WHERE id=${id} AND status='published' FOR SHARE`)).rows[0];
  if (!row) throw new WorkflowError(409, 'Choose a published letter template');
  const definition = letterDefinition.parse(row.definition);
  if (employee && !definition.employeeTypes.includes(employee.type)) throw new WorkflowError(409, 'This template is not available for the employee type');
  return { ...row, definition };
}
export async function letterRecord(tx: any, user: TokenPayload, id: number, lock = false) {
  const row = (await tx.execute(sql`SELECT r.*,employees.first_name || ' ' || employees.last_name AS employee_name,t.definition->>'name' AS template_name,(${managerScope(user)}) AS can_manage FROM hr_letter_requests r JOIN employees ON employees.id=r.employee_id JOIN hr_letter_templates t ON t.id=r.template_id WHERE r.id=${id} AND ${letterScope(user)} ${lock ? sql`FOR UPDATE OF r` : sql``}`)).rows[0];
  if (!row) throw new WorkflowError(404, 'Letter request not found');
  const employee = await letterEmployee(tx, user, Number(row.employee_id), false, lock);
  return { row, employee };
}
export function letterActions(user: TokenPayload, row: any, employee: any) {
  const own = employee.userId === user.userId || row.created_by === user.userId;
  const manage = !!row.can_manage, independent = manage && employee.userId !== user.userId && row.created_by !== user.userId && row.prepared_by !== user.userId;
  return {
    prepare: manage && ['requested', 'returned', 'prepared'].includes(row.status),
    issue: independent && row.status === 'prepared',
    return: independent && ['requested', 'prepared'].includes(row.status),
    reject: independent && ['requested', 'prepared', 'returned'].includes(row.status),
    cancel: own && ['requested', 'returned', 'prepared'].includes(row.status),
    correct: own && row.status === 'returned',
    revoke: manage && employee.userId !== user.userId && row.status === 'issued',
  };
}
const frequency = { monthly: 'per month', annual: 'per year', one_time: 'one time', hourly: 'per hour', daily: 'per day', per_event: 'per assigned event shift', on_request: 'on request' } as const;
export async function prepareLetterSnapshot(tx: any, user: TokenPayload, row: any, employee: any): Promise<LetterSnapshot> {
  const template = await publishedLetterTemplate(tx, Number(row.template_id), employee), definition = template.definition;
  const [companyRow] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'company')).for('share');
  if (!companyRow) throw new WorkflowError(409, 'Save the actual company details in Settings before preparing letters');
  const company = companySettingsSchema.parse(companyRow.value), date = qatarToday();
  const fields = templateFields(definition.title + '\n' + definition.body);
  const values: Partial<Record<LetterField, string>> = {
    company_name: company.companyName, company_address: company.companyAddress, company_email: company.companyEmail, company_phone: company.companyPhone,
    employee_name: employee.firstName + ' ' + employee.lastName, employee_id: employee.employeeId, position: employee.position, department: employee.department,
    employment_type: employee.type, joining_date: employee.joiningDate, work_location: employee.workLocation || employee.location,
    letter_date: date, recipient: row.recipient, purpose: row.purpose, reference: row.reference,
  };
  let compensationVersion: number | null = null;
  if (fields.some(field => payFields.includes(field))) {
    await compensationEmployee(tx, user, employee.id);
    const compensation = await effectiveCompensation(tx, employee.id, date);
    if (!compensation) throw new WorkflowError(409, 'Record an effective compensation package before preparing this letter');
    const pkg = compensation.definition, base = pkg.items.find(item => item.category === 'base')!;
    const itemText = (item: typeof base) => item.provision === 'not_applicable' ? `${item.label}: not applicable${item.terms ? ' — ' + item.terms : ''}` :
      `${item.label}: ${item.provision === 'cash' ? item.amount + ' ' + pkg.currency : item.provision === 'provided' ? 'provided benefit' : 'reimbursement up to ' + item.amount + ' ' + pkg.currency} ${frequency[item.frequency]}${item.terms ? ' — ' + item.terms : ''}`;
    compensationVersion = compensation.version;
    values.pay_currency = pkg.currency; values.base_pay = itemText(base); values.monthly_cash_total = compensationTotals(pkg).monthly + ' ' + pkg.currency;
    values.compensation_breakdown = pkg.items.map(itemText).join('\n'); values.compensation_effective_date = compensation.effectiveFrom;
  }
  let title: string, body: string;
  try { title = renderLetterText(definition.title, values, 1000); body = renderLetterText(definition.body, values); }
  catch (error) { throw new WorkflowError(409, (error as Error).message); }
  const snapshot = { title, body, companyName: company.companyName, companyAddress: company.companyAddress, companyEmail: company.companyEmail,
    companyPhone: company.companyPhone, signatoryTitle: definition.signatoryTitle, date, compensationVersion };
  return { ...snapshot, sourceHash: createHash('sha256').update(JSON.stringify({ ...snapshot, employeeVersion: employee.recordVersion, templateId: template.id, templateVersion: template.version })).digest('hex') };
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function printableLetter(row: any) {
  const s = row.snapshot as LetterSnapshot;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(row.reference)}</title><style>body{font:15px/1.65 Arial,sans-serif;color:#172033;max-width:760px;margin:40px auto;padding:32px}header{border-bottom:1px solid #cad2df;padding-bottom:20px}h1{font-size:24px}h2{font-size:20px;margin-top:32px}.text{white-space:pre-wrap;overflow-wrap:anywhere}.meta,footer{font-size:12px;color:#526075}footer{margin-top:48px;border-top:1px solid #cad2df;padding-top:14px}@media print{body{margin:0;padding:0}.signature{break-inside:avoid}}@page{size:A4;margin:20mm}</style></head><body><header><h1>${escape(s.companyName)}</h1><div class="text">${escape(s.companyAddress)}</div><p class="meta">${escape([s.companyEmail, s.companyPhone].filter(Boolean).join(' · '))}</p></header><p class="meta">Reference: ${escape(row.reference)}<br>Date: ${escape(s.date)}</p><p class="text">To: ${escape(row.recipient)}</p><h2>${escape(s.title)}</h2><div class="text">${escape(s.body)}</div><section class="signature"><p>Approved in HR by ${escape(row.issued_by_name)}<br>${escape(s.signatoryTitle)}</p></section><footer>Issued from the internal HR record. This copy does not contain an electronic signature or external attestation.<br>Use browser Print to print or save as PDF.</footer></body></html>`;
}
