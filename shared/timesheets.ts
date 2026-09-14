import {z} from 'zod';
import type {UserRole} from './schema';
import {getAccessScope,hasPermission} from './permissions';
export const timesheetStatuses=['draft','submitted','returned','approved','payroll_locked'] as const;
export type TimesheetStatus=typeof timesheetStatuses[number];
export const timesheetLabels:Record<TimesheetStatus,string>={draft:'Draft',submitted:'Awaiting review',returned:'Needs correction',approved:'Approved',payroll_locked:'Linked to paid payroll'};
export const payrollTimeAccess=(role:UserRole,permission:'read'|'approve')=>getAccessScope(role,'payroll_management')==='all'&&hasPermission(role,'payroll_management',permission);
const minute=z.string().datetime({offset:true}).transform(v=>new Date(v)).refine(v=>+v%60000===0,'Report times to the minute');
export const actualFields={actualStartAt:minute,actualEndAt:minute,breakMinutes:z.number().int().min(0).max(1439),employeeNote:z.string().trim().max(2000)};
export const actualInput=z.object(actualFields).strict();
export const versionInput=z.object({version:z.number().int().positive()}).strict();
export const reviewInput=z.discriminatedUnion('decision',[
  z.object({version:z.number().int().positive(),decision:z.literal('approved'),payableMinutes:z.number().int().min(0).max(1440),policyReference:z.string().trim().min(3).max(120),reason:z.string().trim().min(5).max(2000)}).strict(),
  z.object({version:z.number().int().positive(),decision:z.literal('returned'),reason:z.string().trim().min(5).max(2000)}).strict(),
]);
export interface TimeAssignment {assignmentId:number;employeeId:number;employeeName:string;teamId:number;teamName:string;siteName:string;timezone:string;role:string;startAt:string;endAt:string;plannedBreakMinutes:number}
export interface TimesheetRow extends TimeAssignment {id:number;status:TimesheetStatus;version:number;actualStartAt:string;actualEndAt:string;breakMinutes:number;workedMinutes:number;employeeNote:string;payableMinutes:number|null;policyReference:string|null;reviewNote:string|null;reviewedAt:string|null;submittedAt:string|null;payrollId:number|null;lockedAt:string|null;updatedAt:string}
export interface TimesheetConfig {canReview:boolean;canPayrollRead:boolean;canPayrollLock:boolean}
export interface TimesheetList {items:TimesheetRow[];total:number;page:number;limit:number}
export interface TimeSnapshot {status:TimesheetStatus;actualStartAt:string;actualEndAt:string;breakMinutes:number;workedMinutes:number;payableMinutes:number|null;policyReference:string|null;employeeNote:string;reviewNote:string|null;payrollId:number|null}
export interface TimesheetDetail {sheet:TimesheetRow;capabilities:{edit:boolean;submit:boolean;review:boolean;reopen:boolean;payrollLock:boolean};history:{id:number;version:number;actorName:string;action:string;reason:string;createdAt:string;snapshot:TimeSnapshot}[]}
export interface PayrollTimeOption {id:number;month:number;year:number;reference:string|null}
