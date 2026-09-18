import { and, eq, or, sql } from 'drizzle-orm';
import { employees } from '@shared/schema';
import { compensationDefinition, compensationDetailedReaders, compensationManagers, type CompensationRevision } from '@shared/compensation';
import { employeeScope } from './access';
import type { TokenPayload } from './auth';
import { fail, type WorkforceTransaction } from './workforce';
import { businessToday } from './hr-rules';

export async function compensationEmployee(tx: WorkforceTransaction, user: TokenPayload, id: number, write = false) {
  if (write && !compensationManagers(user.role)) fail(403, 'Only HR administrators can change compensation packages');
  const scope = write ? employeeScope(user, 'employee_database', 'update') : or(eq(employees.userId, user.userId), compensationDetailedReaders(user.role) ? employeeScope(user, 'payroll_management') : sql`false`);
  const query = tx.select().from(employees).where(and(eq(employees.id, id), scope));
  const [employee] = write ? await query.for('update') : await query;
  if (!employee) fail(404, 'Compensation is not available within your access');
  return employee;
}
export function packageRow(row: any): CompensationRevision {
  return { id: Number(row.id), employeeId: Number(row.employee_id), version: Number(row.version), effectiveFrom: typeof row.effective_from === 'string' ? row.effective_from.slice(0, 10) : row.effective_from.toISOString().slice(0, 10), definition: compensationDefinition.parse(row.definition), reason: row.reason, createdAt: new Date(row.created_at).toISOString(), createdBy: Number(row.created_by) };
}
export async function effectiveCompensation(tx: WorkforceTransaction, employeeId: number, date = businessToday()) {
  const result = await tx.execute(sql`SELECT * FROM employee_compensation_packages WHERE employee_id=${employeeId} AND effective_from<=${date}::date ORDER BY effective_from DESC,version DESC LIMIT 1`);
  return result.rows[0] ? packageRow(result.rows[0]) : null;
}
export async function compensationOnboardingStatus(tx: WorkforceTransaction, employeeId: number, startDate: string) {
  const row = await effectiveCompensation(tx, employeeId, startDate);
  return { recorded: !!row, effectiveFrom: row?.effectiveFrom || null, version: row?.version || null };
}
export async function requireOnboardingCompensation(tx: WorkforceTransaction, employeeId: number, startDate: string) {
  if (!await effectiveCompensation(tx, employeeId, startDate)) fail(409, 'Record the complete salary and benefit breakdown effective on the onboarding start date before completing onboarding');
}
