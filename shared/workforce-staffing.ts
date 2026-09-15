import {z} from 'zod';
import {positiveId} from './workforce';
export const qualificationIds = z.array(positiveId).max(20).transform(ids => [...new Set(ids)].sort((a,b)=>a-b));
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date=new Date(v+'T00:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===v;
}, 'Use a valid calendar date');
export const staffingReason = z.object({reason:z.string().trim().min(5).max(500)}).strict();
export const unavailableInput = z.object({startAt:z.string().datetime({offset:true}).transform(v=>new Date(v)),endAt:z.string().datetime({offset:true}).transform(v=>new Date(v)),note:z.string().trim().max(500).default('')}).strict()
  .refine(v=>v.endAt>v.startAt,'End must be after start')
  .refine(v=>+v.endAt-+v.startAt<=366*86400000,'Choose a period of up to 366 days');
export const credentialInput = z.object({qualificationId:positiveId,validFrom:civilDate,validThrough:civilDate.nullable(),verificationReference:z.string().trim().min(5).max(500)}).strict()
  .refine(v=>!v.validThrough||v.validThrough>=v.validFrom,'Expiry must be on or after the valid-from date');
export interface Qualification {id:number;name:string}
export interface Credential {id:number;renewsCredentialId:number|null;renewedById:number|null;qualificationId:number;name:string;validFrom:string;validThrough:string|null;verificationReference:string;revokedAt:string|null;revocationReason:string|null}
export interface Unavailable {id:number;startAt:string;endAt:string;note:string;cancelledAt:string|null;cancellationReason:string|null}
export interface StaffingProfile {employee:{id:number;name:string};isAdmin:boolean;unavailable:Unavailable[];qualifications:Credential[]}
export interface Candidate {id:number;name:string;eligible:boolean;issue:string|null}
