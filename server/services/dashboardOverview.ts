import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { employees, attendance, leaves, documents, learningEnrollments as enrollments, payroll, payrollReviews, workforceTeams as teams, workforceSites as sites, workforceShifts as shifts, workforceAssignments as assignments, workforceGrants as grants } from '@shared/schema';
import { hasPermission, type HRModule } from '@shared/permissions';
import { localDate, workforceAdmin } from '@shared/workforce';
import type { DashboardOverview } from '@shared/dashboard';
import type { TokenPayload } from './auth';
import { db } from '../db';
import { employeeScope } from './access';
import { getCompanySettings } from './settings';
import { currentGrants } from './workforce';
import { documentIsArchived } from './retention';

const count = sql<number>`count(*)::int`;
const name = sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`;
const shiftDate = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);

export async function dashboardOverview(user: TokenPayload, days: number): Promise<DashboardOverview> {
  const policy = await getCompanySettings(), now = new Date(), timezone = policy.managementOfficeSchedule.timezone;
  const today = localDate(now, timezone), from = shiftDate(today, 1 - days), previous = shiftDate(from, -days), until = shiftDate(today, policy.documentExpiryDays);
  const unavailable: string[] = [];
  async function section<T>(key: string, module: HRModule | null, read: () => Promise<T>): Promise<T | null> {
    if (module && !hasPermission(user.role, module, 'read')) return null;
    try { return await read(); } catch { unavailable.push(key); console.error('Dashboard section unavailable:', key); return null; }
  }
  const [people, time, leave, files, learning, pay, workforce] = await Promise.all([
    section('people', 'employee_database', async () => {
      const scope = employeeScope(user, 'employee_database');
      const active = sql`${employees.status}='active' AND ${employees.joiningDate}<=${today} AND (${employees.terminationDate} IS NULL OR ${employees.terminationDate}>${today}) AND (${employees.contractEndDate} IS NULL OR ${employees.contractEndDate}>=${today})`;
      const [summary] = await db.select({ total: count, active: sql<number>`count(*) FILTER(WHERE ${active})::int`, joined: sql<number>`count(*) FILTER(WHERE ${employees.joiningDate} BETWEEN ${from} AND ${today})::int` }).from(employees).where(scope);
      const departments = await db.select({ name: sql<string>`coalesce(nullif(${employees.department},''),'Unassigned')`, count }).from(employees).where(and(scope, active)).groupBy(employees.department).orderBy(desc(count), employees.department);
      const types = await db.select({ name: employees.type, count }).from(employees).where(and(scope, active)).groupBy(employees.type);
      const recent = await db.select({ id: employees.id, name, department: employees.department, position: employees.position, date: employees.joiningDate }).from(employees).where(and(scope, gte(employees.joiningDate, from), lte(employees.joiningDate, today))).orderBy(desc(employees.joiningDate), employees.id).limit(6);
      return { ...summary, departments, types, recent };
    }),
    section('attendance', 'attendance_time_tracking', async () => {
      const scope = employeeScope(user, 'attendance_time_tracking');
      const [summary] = await db.select({ today: sql<number>`count(*) FILTER(WHERE ${attendance.date}=${today} AND ${attendance.checkIn} IS NOT NULL)::int`, working: sql<number>`count(*) FILTER(WHERE ${attendance.date}=${today} AND ${attendance.checkIn} IS NOT NULL AND ${attendance.checkOut} IS NULL)::int`, pending: sql<number>`count(*) FILTER(WHERE ${attendance.approvalStatus}='pending')::int`, minutes: sql<number>`coalesce(sum(${attendance.totalWorkHours}) FILTER(WHERE ${attendance.date}>=${from}),0)::float8`, overtime: sql<number>`coalesce(sum(${attendance.overtimeHours}) FILTER(WHERE ${attendance.date}>=${from}),0)::float8`, previousMinutes: sql<number>`coalesce(sum(${attendance.totalWorkHours}) FILTER(WHERE ${attendance.date}<${from}),0)::float8` }).from(attendance).innerJoin(employees, eq(attendance.employeeId, employees.id)).where(and(scope, gte(attendance.date, previous), lte(attendance.date, today)));
      const rows = await db.select({ date: attendance.date, present: sql<number>`count(*) FILTER(WHERE ${attendance.status}='present')::int`, late: sql<number>`count(*) FILTER(WHERE ${attendance.status}='late')::int`, absent: sql<number>`count(*) FILTER(WHERE ${attendance.status}='absent')::int`, onLeave: sql<number>`count(*) FILTER(WHERE ${attendance.status}='on_leave')::int` }).from(attendance).innerJoin(employees, eq(attendance.employeeId, employees.id)).where(and(scope, gte(attendance.date, from), lte(attendance.date, today))).groupBy(attendance.date).orderBy(attendance.date);
      const trend = Array.from({ length: days }, (_, i) => { const date = shiftDate(from, i); return rows.find(row => row.date === date) || { date, present: 0, late: 0, absent: 0, onLeave: 0 }; });
      return { ...summary, trend };
    }),
    section('leave', 'leave_absence_management', async () => {
      const scope = employeeScope(user, 'leave_absence_management');
      const [summary] = await db.select({ away: sql<number>`count(DISTINCT ${leaves.employeeId}) FILTER(WHERE ${leaves.status}='approved' AND ${leaves.startDate}<=${today} AND ${leaves.endDate}>=${today})::int`, pending: sql<number>`count(*) FILTER(WHERE ${leaves.status}='pending')::int` }).from(leaves).innerJoin(employees, eq(leaves.employeeId, employees.id)).where(scope);
      const statuses = await db.select({ name: leaves.status, count }).from(leaves).innerJoin(employees, eq(leaves.employeeId, employees.id)).where(and(scope, lte(leaves.startDate, today), gte(leaves.endDate, from))).groupBy(leaves.status);
      const upcoming = await db.select({ id: leaves.id, name, start: leaves.startDate, end: leaves.endDate, days: leaves.totalDays, type: leaves.leaveType }).from(leaves).innerJoin(employees, eq(leaves.employeeId, employees.id)).where(and(scope, eq(leaves.status, 'approved'), gte(leaves.endDate, today))).orderBy(asc(leaves.startDate), leaves.id).limit(6);
      return { ...summary, statuses, upcoming };
    }),
    section('documents', 'compliance_documents', async () => {
      const scope = and(employeeScope(user, 'compliance_documents'), sql`NOT (${documentIsArchived})`);
      const [summary] = await db.select({ total: count, expired: sql<number>`count(*) FILTER(WHERE ${documents.expiryDate}<${today})::int`, expiring: sql<number>`count(*) FILTER(WHERE ${documents.expiryDate} BETWEEN ${today} AND ${until})::int`, healthy: sql<number>`count(*) FILTER(WHERE ${documents.expiryDate}>${until})::int` }).from(documents).innerJoin(employees, eq(documents.employeeId, employees.id)).where(scope);
      const upcoming = await db.select({ id: documents.id, name, type: documents.documentType, date: documents.expiryDate }).from(documents).innerJoin(employees, eq(documents.employeeId, employees.id)).where(and(scope, lte(documents.expiryDate, until))).orderBy(documents.expiryDate, documents.id).limit(6);
      return { ...summary, upcoming };
    }),
    section('learning', 'training_development', async () => {
      const scope = employeeScope(user, 'training_development'), active = inArray(enrollments.status, ['requested', 'approved', 'in_progress', 'completion_submitted']);
      const [summary] = await db.select({ active: sql<number>`count(*) FILTER(WHERE ${active})::int`, overdue: sql<number>`count(*) FILTER(WHERE ${active} AND ${enrollments.dueDate}<${today})::int`, completed: sql<number>`count(*) FILTER(WHERE ${enrollments.status}='completed' AND (${enrollments.completedAt} AT TIME ZONE ${timezone})::date BETWEEN ${from} AND ${today})::int`, awaiting: sql<number>`count(*) FILTER(WHERE ${enrollments.status} IN ('requested','completion_submitted'))::int` }).from(enrollments).innerJoin(employees, eq(enrollments.employeeId, employees.id)).where(scope);
      const statuses = await db.select({ name: enrollments.status, count }).from(enrollments).innerJoin(employees, eq(enrollments.employeeId, employees.id)).where(scope).groupBy(enrollments.status);
      const upcoming = await db.select({ id: enrollments.id, name, title: sql<string>`${enrollments.courseSnapshot}->>'title'`, date: enrollments.dueDate, progress: enrollments.progress }).from(enrollments).innerJoin(employees, eq(enrollments.employeeId, employees.id)).where(and(scope, active)).orderBy(asc(enrollments.dueDate), enrollments.id).limit(6);
      return { ...summary, statuses, upcoming };
    }),
    section('payroll', 'payroll_management', async () => {
      const scope = employeeScope(user, 'payroll_management');
      const month = sql<string>`to_char(make_date(${payroll.year},${payroll.month},1),'YYYY-MM')`, currentMonth = today.slice(0, 7);
      const sixMonths = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 6, 1)).toISOString().slice(0, 7);
      const statuses = await db.select({ name: payroll.status, count }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).where(and(scope, sql`${month}=${currentMonth}`)).groupBy(payroll.status);
      const currency = sql<string>`coalesce(${payrollReviews.currency},'Unspecified')`;
      const totals = await db.select({ currency, processed: sql<string>`coalesce(sum(${payroll.netSalary}) FILTER(WHERE ${payroll.status}='processed'),0)::text`, awaiting: sql<string>`coalesce(sum(${payroll.netSalary}) FILTER(WHERE ${payroll.status} IN ('draft','submitted','approved','pending')),0)::text` }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).leftJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(scope, sql`${month}=${currentMonth}`)).groupBy(currency);
      const trend = await db.select({ month, currency, total: sql<string>`sum(${payroll.netSalary})::text` }).from(payroll).innerJoin(employees, eq(payroll.employeeId, employees.id)).leftJoin(payrollReviews, eq(payroll.id, payrollReviews.payrollId)).where(and(scope, eq(payroll.status, 'processed'), sql`${month} BETWEEN ${sixMonths} AND ${currentMonth}`)).groupBy(month, currency).orderBy(month, currency);
      return { statuses, totals, trend };
    }),
    section('workforce', null, async () => {
      const teamScope = workforceAdmin(user.role) ? sql`true` : inArray(teams.id, db.select({ id: grants.teamId }).from(grants).where(currentGrants(user, now)));
      const [teamCount] = await db.select({ count }).from(teams).where(teamScope);
      const breakdown = await db.select({ name: teams.kind, count }).from(teams).where(teamScope).groupBy(teams.kind);
      const window = and(teamScope, eq(shifts.status, 'scheduled'), gte(shifts.startAt, now), lt(shifts.startAt, new Date(+now + 7 * 86400000)));
      const accepted = sql<number>`(SELECT count(*)::int FROM workforce_assignments a WHERE a.shift_id=${shifts.id} AND a.status='accepted')`;
      const [summary] = await db.select({ shifts: count, required: sql<number>`coalesce(sum(${shifts.headcount}),0)::int`, accepted: sql<number>`coalesce(sum(${accepted}),0)::int`, gaps: sql<number>`coalesce(sum(greatest(0,${shifts.headcount}-${accepted})),0)::int` }).from(shifts).innerJoin(teams, eq(shifts.teamId, teams.id)).where(window);
      const upcomingRows = await db.select({ id: shifts.id, team: teams.name, role: shifts.role, site: sites.name, start: shifts.startAt, end: shifts.endAt, timezone: sites.timezone, required: shifts.headcount, accepted }).from(shifts).innerJoin(teams, eq(shifts.teamId, teams.id)).innerJoin(sites, eq(teams.siteId, sites.id)).where(window).orderBy(shifts.startAt, shifts.id).limit(6);
      const ownRows = await db.select({ id: assignments.id, team: teams.name, role: shifts.role, site: sites.name, start: shifts.startAt, end: shifts.endAt, timezone: sites.timezone, status: assignments.status }).from(assignments).innerJoin(employees, eq(assignments.employeeId, employees.id)).innerJoin(shifts, eq(assignments.shiftId, shifts.id)).innerJoin(teams, eq(shifts.teamId, teams.id)).innerJoin(sites, eq(teams.siteId, sites.id)).where(and(eq(employees.userId, user.userId), eq(shifts.status, 'scheduled'), inArray(assignments.status, ['offered', 'accepted']), gte(shifts.endAt, now), lt(shifts.startAt, new Date(+now + 30 * 86400000)))).orderBy(shifts.startAt, assignments.id).limit(6);
      return { teams: teamCount.count, ...summary, breakdown, upcoming: upcomingRows.map(r => ({ ...r, start: r.start.toISOString(), end: r.end.toISOString() })), own: ownRows.map(r => ({ ...r, start: r.start.toISOString(), end: r.end.toISOString() })) };
    }),
  ]);
  return { generatedAt: now.toISOString(), today, from, days, timezone, company: policy.companyName, expiryDays: policy.documentExpiryDays, unavailable, people, attendance: time, leave, documents: files, learning, payroll: pay, workforce };
}
