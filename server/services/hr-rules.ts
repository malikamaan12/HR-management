import { and, eq, lte, or, desc, sql, isNull } from 'drizzle-orm';
import { hrRules, employees, users, activityLogs } from '@shared/schema';
import { attendanceRule, dayAt, ruleInput } from '@shared/hr-rules';
import { employeeWeekendDays } from '@shared/settings';
import { getCompanySettings } from './settings';
import { db } from '../db';
import { fail, type WorkforceTransaction } from './workforce';
import { employeeScope } from './access';
import { hasPermission, type HRModule, type Permission } from '@shared/permissions';
import type { TokenPayload } from './auth';
export const isRuleAdmin = (user: TokenPayload) => ['admin', 'super_admin'].includes(user.role);
export const businessToday = () => dayAt(new Date(), process.env.APP_TIMEZONE || 'Asia/Qatar');
export async function ruleFor(tx: WorkforceTransaction, employeeId: number, kind: string, name: string, day: string) {
    const [rule] = await tx.select().from(hrRules).where(and(eq(hrRules.kind, kind), eq(hrRules.name, name), lte(hrRules.effectiveFrom, day), or(eq(hrRules.employeeId, employeeId), isNull(hrRules.employeeId)))).orderBy(sql `${hrRules.employeeId} IS NOT NULL DESC`, desc(hrRules.effectiveFrom), desc(hrRules.id)).limit(1);
    return rule;
}
export async function attendancePolicy(tx: WorkforceTransaction, employee: typeof employees.$inferSelect, day: string) {
    const rule = await ruleFor(tx, employee.id, 'attendance', 'Work calendar', day);
    if (rule)
        return { id: rule.id, hasSchedule: true, ...attendanceRule.parse(rule.config) };
    const company = await getCompanySettings(tx), office = company.managementOfficeSchedule;
    return { id: null, hasSchedule: employee.workSchedule === 'management_office', timezone: employee.workSchedule === 'management_office' ? office.timezone : process.env.APP_TIMEZONE || 'Asia/Qatar', workingDays: [0, 1, 2, 3, 4, 5, 6].filter(d => !employeeWeekendDays(employee, company).includes(d)), startTime: office.startTime, endTime: office.endTime, breakMinutes: 0, graceMinutes: 0, holidays: [] };
}
export async function scopedEmployee(tx: WorkforceTransaction, user: TokenPayload, id: number, module: HRModule, permission: Permission = 'read', lock = false) {
    const query = tx.select().from(employees).where(and(eq(employees.id, id), employeeScope(user, module, permission)));
    const [row] = lock ? await query.for('update') : await query;
    return row || fail(404, 'Employee not found within your access');
}
export async function audit(tx: WorkforceTransaction, user: TokenPayload, entityType: string, entityId: number, details: string) { await tx.insert(activityLogs).values({ userId: user.userId, action: 'update', entityType, entityId, details }); }
export async function saveRule(user: TokenPayload, body: unknown) {
    if (!isRuleAdmin(user))
        fail(403, 'Only administrators can configure company or employee rules');
    const input = ruleInput.parse(body);
    if (input.kind !== 'leave' && input.name !== (input.kind === 'attendance' ? 'Work calendar' : 'Pay policy'))
        fail(400, 'Use the standard rule name');
    return db.transaction(async (tx) => {
        if (input.employeeId)
            await scopedEmployee(tx, user, input.employeeId, 'employee_database', 'read', true);
        const approverId = 'approverId' in input.config ? input.config.approverId : null;
        if (approverId) {
            const [approver] = await tx.select().from(users).where(eq(users.id, approverId));
            const module = input.kind === 'payroll' ? 'payroll_management' : 'leave_absence_management';
            if (!approver || !approver.isActive || approver.approvalStatus !== 'approved' || !hasPermission(approver.role, module, 'approve'))
                fail(400, 'Select an active approver with the required permission');
            if (input.employeeId) {
                const [employee] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), employeeScope({ userId: approver.id, role: approver.role, department: approver.department || undefined } as TokenPayload, module, 'approve')));
                if (!employee)
                    fail(400, 'Approver cannot access this employee');
            }
        }
        const [rule] = await tx.insert(hrRules).values({ ...input, createdBy: user.userId }).returning();
        await audit(tx, user, 'hr_rule', rule.id, 'Created effective rule revision');
        return rule;
    });
}
