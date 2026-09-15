import {z} from 'zod';
import {positiveId} from './workforce';

const instant=z.string().datetime({offset:true}).transform(v=>new Date(v));
export const operationReason=z.string().trim().min(5).max(1000);
export const membershipChangeInput=z.object({version:positiveId,endAt:instant,reason:operationReason}).strict();
export const arrivalRules=z.object({enabled:z.boolean(),earlyMinutes:z.number().int().min(0).max(1440),lateMinutes:z.number().int().min(0).max(1440),departureGraceMinutes:z.number().int().min(0).max(1440)}).strict();
export type ArrivalRules=z.infer<typeof arrivalRules>;
export const defaultArrivalRules:ArrivalRules={enabled:true,earlyMinutes:60,lateMinutes:240,departureGraceMinutes:120};
export const arrivalRuleInput=z.object({employeeId:positiveId.nullable(),effectiveAt:instant.nullable(),rules:arrivalRules,reason:operationReason}).strict();
export const incidentInput=z.object({requestKey:z.string().uuid(),occurredAt:instant,title:z.string().trim().min(5).max(160),details:z.string().trim().min(10).max(4000),severity:z.enum(['low','medium','high'])}).strict();
export const incidentUpdate=z.object({version:positiveId,status:z.enum(['open','in_progress','resolved']),note:operationReason}).strict();
export interface PresenceView {id:number;assignmentId:number;version:number;arrivedAt:string;departedAt:string|null;departureReason:string|null;reviewedAt:string|null;reviewNote:string|null;flags:string[]}
export interface IncidentView {id:number;title:string;details:string;severity:string;occurredAt:string;createdAt:string;status:'open'|'in_progress'|'resolved';version:number;reporterName:string;ownerName:string|null;history:{id:number;status:string;note:string;actorName:string;createdAt:string}[]}
export interface ShiftOperations {canManage:boolean;incidents:IncidentView[];presence:(PresenceView&{name:string;canReview:boolean})[]}
export interface MyPresence {presence:PresenceView|null;rules:ArrivalRules;opensAt:string;closesAt:string}
