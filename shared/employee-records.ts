import { z } from 'zod';
import { insertEmployeeSchema, type Employee } from './schema';

const text = z.string().trim().min(1, 'Required').max(250);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid date');
const email = z.string().trim().email().max(254).nullable().optional();
export const employeeWriteFields = insertEmployeeSchema.omit({ userId: true, roleId: true, photo: true }).extend({
  employeeId: text, firstName: text, lastName: text, nationality: text, qidNumber: text,
  primaryMobile: text, residentialAddress: z.string().trim().min(1).max(2000),
  emergencyContactName: text, emergencyContactNumber: text,
  department: text, position: text, location: text,
  dateOfBirth: date, joiningDate: date, contractEndDate: date.nullable().optional(), terminationDate: date.nullable().optional(),
  personalEmail: email, workEmail: email,
  reportingManagerId: z.number().int().positive().nullable().optional(),
  secondaryManagerId: z.number().int().positive().nullable().optional(),
  probationPeriod: z.number().int().min(0).max(120).nullable().optional(),
  noticePeriod: z.number().int().min(0).max(3650).nullable().optional(),
  status: z.enum(['active', 'inactive', 'on_leave']).default('active'),
}).strict();

export function checkEmploymentDates(value: Pick<Employee, 'dateOfBirth' | 'joiningDate'> & Partial<Pick<Employee, 'contractEndDate' | 'terminationDate'>>) {
  if (value.dateOfBirth >= value.joiningDate) return 'Date of birth must be before the joining date';
  if (value.contractEndDate && value.contractEndDate < value.joiningDate) return 'Contract end must be on or after joining';
  if (value.terminationDate && value.terminationDate < value.joiningDate) return 'Termination must be on or after joining';
}

// Directory fields are deliberately separate from personal and payroll records.
export const directoryFields = ['id', 'employeeId', 'firstName', 'lastName', 'fullNameArabic', 'type',
  'eventStaffEligible', 'department', 'position', 'location', 'workLocation', 'workEmail', 'workPhone',
  'reportingManagerId', 'secondaryManagerId', 'joiningDate', 'status'] as const;
export type EmployeeDirectoryEntry = Pick<Employee, typeof directoryFields[number]>;
export type EmployeeRecord = EmployeeDirectoryEntry & Partial<Employee> & {
  access: { canEdit: boolean; personal: boolean; banking: boolean; documents: boolean; uploadDocuments: boolean; history: boolean };
};
export type EmployeeDirectory = { employees: EmployeeDirectoryEntry[]; total: number; page: number; limit: number; canCreate: boolean };
export type EmployeeHistory = { id: number; action: string; details: string | null; createdAt: Date; actor: string | null };
