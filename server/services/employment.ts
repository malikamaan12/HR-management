import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { employees, users, authSessions, workforceAssignments, workforceShifts, workforceTeams, workforceSites, type Employee } from '@shared/schema';
import { defaultEmploymentPolicy, employmentReviewer, employmentWriter, type EmploymentPatch, type EmploymentPolicy, type ServicePeriod, type ServicePeriodInput } from '@shared/employment';
import { employeeScope } from './access';
import { WorkflowError, qatarToday, recordHistory } from './workflowRecords';
import { dayAt } from '@shared/hr-rules';
import type { TokenPayload } from './auth';

export const employmentFail = (status: number, message: string): never => { throw new WorkflowError(status, message); };
export function requireEmploymentWriter(req: any) {
  if (!employmentWriter(req.user.role)) employmentFail(403, 'HR administrator access is required');
}
export function employmentScope(req: any) {
  return and(employeeScope(req.user, 'employee_database'), employmentWriter(req.user.role) ? undefined : eq(employees.userId, req.user.userId));
}
export async function employmentEmployee(tx: any, req: any, id: number, lock = false): Promise<Employee> {
  let query = tx.select().from(employees).where(and(eq(employees.id, id), employmentScope(req)));
  if (lock) query = query.for('update');
  const [employee] = await query;
  if (!employee) employmentFail(404, 'Employee not found');
  return employee;
}
export const employmentEmployeeView = (e: Employee) => ({
  id: e.id, employeeId: e.employeeId, name: e.firstName + ' ' + e.lastName, recordVersion: e.recordVersion,
  department: e.department, position: e.position, location: e.location, type: e.type,
  workLocation: e.workLocation, costCenter: e.costCenter, jobGrade: e.jobGrade,
  reportingManagerId: e.reportingManagerId, secondaryManagerId: e.secondaryManagerId,
  workSchedule: e.workSchedule, eventStaffEligible: e.eventStaffEligible,
  contractEndDate: e.contractEndDate, joiningDate: e.joiningDate, terminationDate: e.terminationDate, status: e.status,
});
export async function employmentPolicy(tx: any): Promise<EmploymentPolicy & { version: number }> {
  const { rows } = await tx.execute(sql`SELECT version, definition FROM employment_policies ORDER BY version DESC LIMIT 1`);
  return rows.length ? { ...rows[0].definition, version: rows[0].version } : { ...defaultEmploymentPolicy, version: 0 };
}
export function independentEmploymentReviewer(req: any, employee: Employee, request: any) {
  if (!employmentReviewer(req.user.role, request.policy_snapshot)) employmentFail(403, 'This request requires an eligible HR reviewer under its saved approval rules');
  if ([employee.userId, request.requested_by].includes(req.user.userId)) employmentFail(403, 'The employee and request preparer cannot review this request');
}
export function employmentVersion(row: any, version: number) {
  if (Number(row.version) !== version) employmentFail(409, 'This record has changed. Reload before saving.');
}
export const daysBetween = (start: string, end: string) => Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000);
export const dateAfter = (value: string, days: number) => new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
export function validateChange(employee: Employee, changes: EmploymentPatch, effectiveDate: string) {
  if (employee.status === 'inactive') employmentFail(409, 'Reactivate employment through the employee lifecycle before making an employment change');
  if (effectiveDate < employee.joiningDate) employmentFail(400, 'The change cannot take effect before the joining date');
  if (changes.contractEndDate && changes.contractEndDate < effectiveDate) employmentFail(400, 'Contract end must be on or after the change effective date');
  if (changes.contractEndDate && changes.contractEndDate < employee.joiningDate) employmentFail(400, 'Contract end must be on or after the joining date');
}
// Call under the same employees table lock used by profile and import edits.
export async function validateEmploymentManagers(tx: any, employeeId: number, changes: EmploymentPatch) {
  if (changes.reportingManagerId === undefined && changes.secondaryManagerId === undefined) return;
  const rows = await tx.select({ id: employees.id, reportingManagerId: employees.reportingManagerId, secondaryManagerId: employees.secondaryManagerId, status: employees.status }).from(employees);
  const index = new Map<number, { id: number; reportingManagerId: number | null; secondaryManagerId: number | null; status: string }>(rows.map((row: any) => [row.id, row]));
  for (const managerId of [changes.reportingManagerId, changes.secondaryManagerId]) {
    if (managerId == null) continue;
    const manager = index.get(managerId);
    if (!manager || manager.status === 'inactive') employmentFail(400, 'Select an active reporting manager');
    const pending = [managerId], seen = new Set<number>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === employeeId) employmentFail(400, 'Reporting managers cannot create a cycle or report to themselves');
      if (seen.has(id)) continue;
      seen.add(id);
      const row = index.get(id);
      for (const next of [row?.reportingManagerId, row?.secondaryManagerId]) if (next != null) pending.push(next);
    }
  }
}
export async function validateServicePeriod(tx: any, employee: Employee, input: ServicePeriodInput, excludingId: number | null) {
  const today = qatarToday();
  if (input.startDate <= employee.dateOfBirth) employmentFail(400, 'Service start must be after date of birth');
  if (input.startDate > today) employmentFail(400, 'Service periods must have started; use an employment change for future arrangements');
  if (input.endDate && input.endDate > today) employmentFail(400, 'Use an open service period until employment ends');
  if (employee.status === 'inactive' && !input.endDate) employmentFail(400, 'Inactive employees need a completed service period with an end date');
  const overlap = await tx.execute(sql`SELECT id FROM employment_service_periods
    WHERE employee_id=${employee.id} AND status='active' AND (${excludingId}::integer IS NULL OR id<>${excludingId})
      AND start_date<=COALESCE(${input.endDate}::date,'infinity'::date)
      AND COALESCE(end_date,'infinity'::date)>=${input.startDate}::date LIMIT 1`);
  if (overlap.rows.length) employmentFail(409, 'This overlaps an existing service period. Correct that period first.');
}
export function serviceContinuity(periods: ServicePeriod[], employee: Employee, policy: EmploymentPolicy & { version: number }, today = qatarToday()) {
  const source = periods.length ? 'service_ledger' : 'employee_profile';
  const active = source === 'employee_profile' ? [{
    start_date: employee.joiningDate, end_date: employee.terminationDate, qualifies: true,
    status: 'active', id: 0,
  }] : periods.filter(p => p.status === 'active');
  const rows = active.filter(p => p.qualifies && p.start_date <= today).map(p => {
    const end = p.end_date || (employee.status === 'inactive' ? employee.terminationDate : null);
    return { id: p.id, start: p.start_date, end: end && end < today ? end : today };
  }).filter(p => p.end >= p.start).sort((a, b) => a.start.localeCompare(b.start));
  const groups: { start: string; end: string; workedDays: number; bridgedDays: number }[] = [];
  const gaps: { startDate: string; endDate: string; days: number; bridged: boolean }[] = [];
  for (const row of rows) {
    const length = daysBetween(row.start, row.end) + 1;
    const previous = groups.at(-1);
    if (!previous) { groups.push({ start: row.start, end: row.end, workedDays: length, bridgedDays: 0 }); continue; }
    const gap = Math.max(0, daysBetween(previous.end, row.start) - 1), bridged = gap <= policy.continuityGapDays;
    if (gap) gaps.push({ startDate: dateAfter(previous.end, 1), endDate: dateAfter(row.start, -1), days: gap, bridged });
    if (bridged) { previous.end = row.end; previous.workedDays += length; previous.bridgedDays += gap; }
    else groups.push({ start: row.start, end: row.end, workedDays: length, bridgedDays: 0 });
  }
  const latest = groups.at(-1);
  return {
    source, asOf: today, policyVersion: policy.version,
    needsClosure: employee.status === 'inactive' && active.some(p => !p.end_date),
    totalQualifyingDays: rows.reduce((n, row) => n + daysBetween(row.start, row.end) + 1, 0),
    continuityStartDate: latest?.start ?? null, latestServiceDate: latest?.end ?? null,
    continuousServiceDays: latest ? latest.workedDays + (policy.includeBridgedGaps ? latest.bridgedDays : 0) : 0,
    bridgedGapDays: latest?.bridgedDays ?? 0, qualifyingPeriods: rows.length, gaps,
  };
}

type RejectEmployment = (status: number, message: string) => never;
/** Employee must already be locked by the caller, before locking a lifecycle case. */
export async function syncEmploymentService(tx: any, user: TokenPayload, employee: Employee, action: 'onboarding' | 'termination' | 'reactivation', effectiveDate: string, note: string, reference: Record<string, unknown>, reject: RejectEmployment = employmentFail) {
  const pending = await tx.execute(sql`SELECT id FROM employment_period_requests WHERE employee_id=${employee.id} AND status='requested' LIMIT 1`);
  if (pending.rows.length) reject(409, 'Resolve pending service record requests before completing this employment lifecycle change');
  const today = qatarToday();
  if (effectiveDate > today) reject(409, 'Record this employment lifecycle change on or after its effective date');
  let periods = (await tx.execute(sql`SELECT * FROM employment_service_periods WHERE employee_id=${employee.id} ORDER BY start_date,id FOR UPDATE`)).rows as ServicePeriod[];
  const history = async (row: any, reason: string) => recordHistory(tx, { user }, 'employment_service_period', row, reason);
  if (!periods.length) {
    if (employee.joiningDate > today) reject(409, 'Employment service cannot start before the employee joining date');
    const end = employee.status === 'inactive' ? employee.terminationDate : null;
    if (employee.status === 'inactive' && !end) reject(409, 'Record and approve the previous completed service period before reactivation; this profile has no leaving date');
    if (end && end < employee.joiningDate) reject(409, 'Correct the profile employment dates before recording its service baseline');
    const saved = await tx.execute(sql`INSERT INTO employment_service_periods(employee_id,start_date,end_date,qualifies,service_type,note,source,source_reference,created_by,approved_by)
      VALUES (${employee.id},${employee.joiningDate}::date,${end}::date,true,${employee.type},'Existing employee profile dates retained as the initial service baseline','profile_baseline',${JSON.stringify({ ...reference, joiningDate: employee.joiningDate, terminationDate: end })}::jsonb,${user.userId},${user.userId}) RETURNING *`);
    await history(saved.rows[0], 'Preserved original profile service dates before ' + action);
    periods = saved.rows as ServicePeriod[];
  }
  let active = periods.filter(p => p.status === 'active'), open = active.filter(p => !p.end_date);
  if (open.length > 1) reject(409, 'Correct overlapping open service periods before continuing');
  if (action === 'onboarding') {
    if (employee.status === 'inactive') reject(409, 'Use the employee reactivation workflow before completing onboarding for an inactive employee');
    if (!open.length) reject(409, 'Record the current service period before completing onboarding');
    return;
  }
  if (action === 'termination') {
    if (active.some(p => p.start_date > effectiveDate || p.end_date && p.end_date > effectiveDate)) reject(409, 'The leaving date conflicts with recorded service. Correct the service record before terminating employment.');
    if (!open.length) {
      if (!active.some(p => p.end_date === effectiveDate)) reject(409, 'Record the current service period through the leaving date before terminating employment');
      return;
    }
    const period = open[0];
    if (effectiveDate < period.start_date) reject(409, 'The leaving date is before the current service period');
    const saved = await tx.execute(sql`UPDATE employment_service_periods SET end_date=${effectiveDate}::date,source='lifecycle',source_reference=${JSON.stringify(reference)}::jsonb,approved_by=${user.userId},version=version+1,updated_at=now() WHERE id=${period.id} RETURNING *`);
    await history(saved.rows[0], note); return;
  }
  // Capture a known historical termination before opening a rehire period. Never guess a missing leaving date.
  if (open.length) {
    const end = employee.terminationDate;
    if (!end || end < open[0].start_date) reject(409, 'Close the previous service period with reviewed evidence before reactivation');
    const saved = await tx.execute(sql`UPDATE employment_service_periods SET end_date=${end}::date,source='lifecycle',source_reference=${JSON.stringify({ ...reference, originalTerminationDate: end })}::jsonb,approved_by=${user.userId},version=version+1,updated_at=now() WHERE id=${open[0].id} RETURNING *`);
    await history(saved.rows[0], 'Preserved the profile leaving date before reactivation: ' + note);
    active = active.map(p => p.id === open[0].id ? saved.rows[0] as ServicePeriod : p);
  }
  if (!active.length) reject(409, 'Record the previous service period before reactivation; all previous records have been voided');
  if (active.some(p => !p.end_date || p.end_date >= effectiveDate)) reject(409, 'The reactivation date must be after the previous service period ends; service dates are inclusive');
  const saved = await tx.execute(sql`INSERT INTO employment_service_periods(employee_id,start_date,end_date,qualifies,service_type,note,source,source_reference,created_by,approved_by)
    VALUES (${employee.id},${effectiveDate}::date,NULL,true,${employee.type},${note},'lifecycle',${JSON.stringify(reference)}::jsonb,${user.userId},${user.userId}) RETURNING *`);
  await history(saved.rows[0], note);
}

/** Use the same employment end safeguards for checklist completion and direct HR lifecycle changes. */
export async function endEmploymentAccess(tx: any, employee: Employee, leavingDate: string, reject: RejectEmployment = employmentFail) {
  const upcoming = await tx.select({ end: workforceShifts.endAt, timezone: workforceSites.timezone }).from(workforceAssignments)
    .innerJoin(workforceShifts, eq(workforceAssignments.shiftId, workforceShifts.id)).innerJoin(workforceTeams, eq(workforceShifts.teamId, workforceTeams.id)).innerJoin(workforceSites, eq(workforceTeams.siteId, workforceSites.id))
    .where(and(eq(workforceAssignments.employeeId, employee.id), inArray(workforceAssignments.status, ['offered', 'accepted']), gte(workforceShifts.endAt, new Date(Date.parse(leavingDate) - 86400000))));
  if (upcoming.some((shift: { end: Date; timezone: string }) => dayAt(new Date(+shift.end - 1), shift.timezone) > leavingDate)) reject(409, 'Cancel or reassign work scheduled after the leaving date');
  if (!employee.userId) return;
  // Serialize account-deactivation decisions so concurrent terminations cannot remove the last administrator.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6132041)`);
  const [account] = await tx.select().from(users).where(eq(users.id, employee.userId)).for('update');
  if (account?.isActive && ['admin', 'super_admin'].includes(account.role)) {
    const admins = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ['admin', 'super_admin']), eq(users.isActive, true), eq(users.approvalStatus, 'approved'))).orderBy(users.id).for('update');
    if (!admins.some((admin: { id: number }) => admin.id !== employee.userId)) reject(409, 'Keep another active approved administrator before deactivating this account');
  }
  await tx.update(users).set({ isActive: false, accountState: sql`case when ${users.accountState} = 'deleted' then 'deleted' else 'revoked' end`, accountVersion: sql`${users.accountVersion} + 1`, refreshToken: null, passwordResetToken: null, passwordResetExpires: null, updatedAt: new Date() }).where(eq(users.id, employee.userId));
  await tx.update(authSessions).set({ isActive: false, updatedAt: new Date() }).where(eq(authSessions.userId, employee.userId));
}
