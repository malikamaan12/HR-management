import { categoryIdInput, type WorkspaceRecord } from './helpdesk-workspace';
import {z} from 'zod';
import type {UserRole} from './schema';
export const caseStatuses=['open','in_progress','waiting_employee','resolved','closed'] as const;
export const statusLabels={open:'Open',in_progress:'In progress',waiting_employee:'Waiting for employee',resolved:'Resolved',closed:'Closed'};
export type CaseStatus=typeof caseStatuses[number];
export const helpdeskResponder=(role:UserRole)=>['super_admin','admin','hr_director','hr','hr_manager'].includes(role);
export const helpdeskTriage=(role:UserRole,confidential:boolean)=>confidential?['super_admin','hr_director'].includes(role):['super_admin','admin','hr_director','hr'].includes(role);
export const idInput=z.coerce.number().int().positive();
const booleanInput=z.preprocess(value=>value==='true'?true:value==='false'?false:value,z.boolean());
export const newCaseInput=z.object({title:z.string().trim().min(4).max(160),category:categoryIdInput,confidential:booleanInput.default(false),body:z.string().trim().min(10).max(10000)}).strict();
export const replyInput=z.object({version:idInput,body:z.string().trim().min(1).max(10000),internal:booleanInput.default(false)}).strict();
export const caseActionInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('assign'),version:idInput,assigneeId:idInput.nullable()}).strict(),
  z.object({action:z.literal('status'),version:idInput,status:z.enum(caseStatuses),reason:z.string().trim().min(5).max(1000)}).strict(),
  z.object({action:z.literal('restrict'),version:idInput}).strict(),
]);
export interface CaseSummary {firstResponseDueAt:string|null;resolutionDueAt:string|null;firstRespondedAt:string|null;resolvedAt:string|null;escalatedAt:string|null;id:number;title:string;category:string;confidential:boolean;status:CaseStatus;requesterId:number;assigneeId:number|null;version:number;createdAt:string;updatedAt:string;requesterName:string;assigneeName:string|null}
export interface CaseCapabilities {staff:boolean;assign:boolean;restrict:boolean;reply:boolean;internal:boolean;statuses:CaseStatus[]}
export interface CaseDetail {canEscalate:boolean;case:CaseSummary;capabilities:CaseCapabilities;messages:{id:number;body:string;internal:boolean;authorName:string;createdAt:string;attachments:{id:number;filename:string;size:number}[]}[];events:{id:number;actorName:string;details:string;internal:boolean;createdAt:string}[]}
export interface CaseList {items:CaseSummary[];total:number;page:number;limit:number}
export interface HelpdeskConfig extends WorkspaceRecord {canManagePolicies:boolean;canWorkQueue:boolean;confidentialTriage:boolean;attachmentsAvailable:boolean}
