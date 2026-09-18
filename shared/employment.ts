import { z } from 'zod';
import { civilDate, positiveId, reason } from './hr-rules';

const text = z.string().trim().min(1).max(250);
export const employmentFields = z.object({
  department: text.optional(), position: text.optional(), location: text.optional(),
  workLocation: text.nullable().optional(), costCenter: text.nullable().optional(), jobGrade: text.nullable().optional(),
  reportingManagerId: positiveId.nullable().optional(), secondaryManagerId: positiveId.nullable().optional(),
  type: z.enum(['permanent', 'temporary', 'contract']).optional(),
  workSchedule: z.enum(['unassigned', 'management_office', 'shift_based']).optional(),
  eventStaffEligible: z.boolean().optional(), contractEndDate: civilDate.nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'Include at least one employment change');
export const employmentChangeInput = z.object({
  employeeId: positiveId, expectedEmployeeVersion: positiveId,
  kind: z.enum(['transfer', 'promotion', 'contract_renewal', 'assignment_change']),
  effectiveDate: civilDate, changes: employmentFields, reason,
}).strict();
export const employmentPolicyInput = z.object({
  requireDirectorApproval: z.boolean(), maxBackdatedDays: z.number().int().min(0).max(3650),
  maxFutureDays: z.number().int().min(1).max(3650), continuityGapDays: z.number().int().min(0).max(3650),
  includeBridgedGaps: z.boolean(),
}).strict();
export type EmploymentPolicy = z.infer<typeof employmentPolicyInput>;
export const defaultEmploymentPolicy: EmploymentPolicy = {
  requireDirectorApproval: false, maxBackdatedDays: 0, maxFutureDays: 365,
  continuityGapDays: 0, includeBridgedGaps: false,
};
export const servicePeriodFields = z.object({
  startDate: civilDate, endDate: civilDate.nullable(), qualifies: z.boolean(),
  serviceType: z.enum(['permanent', 'temporary', 'contract']), note: z.string().trim().max(2000),
}).strict().refine(v => !v.endDate || v.endDate >= v.startDate, 'Service end must be on or after the start');
export const servicePeriodRequestInput = z.object({
  action: z.enum(['record', 'correct', 'void']), targetPeriodId: positiveId.nullable(),
  expectedPeriodVersion: positiveId.nullable(), period: servicePeriodFields.nullable(), reason,
}).strict().superRefine((v, ctx) => {
  if (v.action !== 'record' && (!v.targetPeriodId || !v.expectedPeriodVersion)) ctx.addIssue({ code: 'custom', message: 'Select the service period and current version' });
  if (v.action === 'record' && (v.targetPeriodId || v.expectedPeriodVersion)) ctx.addIssue({ code: 'custom', message: 'A new period cannot replace an existing period' });
  if (v.action !== 'void' && !v.period) ctx.addIssue({ code: 'custom', message: 'Complete the service period details' });
});
export type EmploymentPatch = z.infer<typeof employmentFields>;
export type ServicePeriodInput = z.infer<typeof servicePeriodFields>;
export type EmploymentChange = {
  id: number; employee_id: number; employee_version: number; kind: string; effective_date: string;
  before_values: EmploymentPatch; after_values: EmploymentPatch; policy_snapshot: EmploymentPolicy & { version: number };
  reason: string; status: 'requested' | 'approved' | 'rejected' | 'cancelled' | 'applied'; version: number;
  requested_by: number; reviewed_by: number | null; reviewed_at: string | null; decision_reason: string | null;
  applied_by: number | null; applied_at: string | null; created_at: string; updated_at: string;
  employee_name?: string; employee_code?: string;
};
export type ServicePeriod = {
  id: number; employee_id: number; start_date: string; end_date: string | null; qualifies: boolean;
  service_type: 'permanent' | 'temporary' | 'contract'; note: string; status: 'active' | 'void';
  source: 'reviewed' | 'profile_baseline' | 'lifecycle'; source_reference: Record<string, unknown> | null;
  version: number; created_by: number; approved_by: number; created_at: string; updated_at: string;
};
export type ServicePeriodRequest = {
  id: number; employee_id: number; action: 'record' | 'correct' | 'void'; target_period_id: number | null;
  expected_period_version: number | null; period_data: ServicePeriodInput | null;
  policy_snapshot: EmploymentPolicy & { version: number }; reason: string; status: 'requested' | 'approved' | 'rejected' | 'cancelled';
  version: number; requested_by: number; reviewed_by: number | null; decision_reason: string | null;
  created_at: string; updated_at: string;
};
export const employmentWriter = (role: string) => ['admin', 'super_admin', 'hr_director', 'hr'].includes(role);
export const employmentAdministrator = (role: string) => ['admin', 'super_admin'].includes(role);
export const employmentReviewer = (role: string, policy: EmploymentPolicy) =>
  policy.requireDirectorApproval ? ['admin', 'super_admin', 'hr_director'].includes(role) : employmentWriter(role);
