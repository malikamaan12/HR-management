import {z} from 'zod';
import {positiveId,siteInput,siteTimeToIso} from './workforce';
export const calendarDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v;},'Use a valid calendar date');
const clockTime=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const availabilityPattern=z.object({timezone:siteInput.shape.timezone,startDate:calendarDate,endDate:calendarDate,
  weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(v=>[...new Set(v)].sort()),startTime:clockTime,endTime:clockTime,endDayOffset:z.number().int().min(0).max(1),note:z.string().trim().max(500).default('')}).strict()
  .refine(v=>v.endDate>=v.startDate&&Date.parse(v.endDate)-Date.parse(v.startDate)<366*86400000,'Choose a date range of up to 366 days')
  .refine(v=>{const m=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));const duration=m(v.endTime)-m(v.startTime)+v.endDayOffset*1440;return duration>0&&duration<=1440;},'Each period must last up to 24 local hours');
export type AvailabilityPattern=z.infer<typeof availabilityPattern>;
export const availabilitySeriesInput=z.object({requestKey:z.string().uuid(),pattern:availabilityPattern}).strict();
export function expandAvailability(pattern:AvailabilityPattern){
  const result:{startAt:Date;endAt:Date}[]=[];
  for(let day=Date.parse(pattern.startDate);day<=Date.parse(pattern.endDate);day+=86400000){
    if(!pattern.weekdays.includes(new Date(day).getUTCDay()))continue;
    const date=new Date(day).toISOString().slice(0,10),endDate=new Date(day+pattern.endDayOffset*86400000).toISOString().slice(0,10);
    result.push({startAt:new Date(siteTimeToIso(`${date}T${pattern.startTime}`,pattern.timezone)),endAt:new Date(siteTimeToIso(`${endDate}T${pattern.endTime}`,pattern.timezone))});
  }
  if(!result.length)throw new Error('Choose at least one occurrence');
  return result;
}
export const renewalPolicy=z.object({reminderDays:z.number().int().min(0).max(365),timezone:siteInput.shape.timezone}).strict();
export type RenewalPolicy=z.infer<typeof renewalPolicy>;
export const defaultRenewalPolicy:RenewalPolicy={reminderDays:30,timezone:'UTC'};
export const renewalPolicyInput=z.object({qualificationId:positiveId,employeeId:positiveId.nullable(),effectiveAt:z.string().datetime({offset:true}).transform(v=>new Date(v)).nullable(),config:renewalPolicy,reason:z.string().trim().min(5).max(500)}).strict();
export const renewalSubmission=z.object({reference:z.string().trim().min(5).max(500),note:z.string().trim().max(1000).default('')}).strict();
export const renewalCreate=renewalSubmission.extend({requestKey:z.string().uuid()}).strict();
export const renewalResubmit=renewalSubmission.extend({version:positiveId}).strict();
export const renewalDecision=z.discriminatedUnion('decision',[
  z.object({version:positiveId,decision:z.literal('return'),reason:z.string().trim().min(5).max(1000)}).strict(),
  z.object({version:positiveId,decision:z.literal('verify'),reason:z.string().trim().min(5).max(1000),validFrom:calendarDate,validThrough:calendarDate.nullable(),verificationReference:z.string().trim().min(5).max(500)}).strict(),
]);
export interface AvailabilitySeries {id:number;pattern:AvailabilityPattern;createdAt:string;stoppedAt:string|null;stopReason:string|null;futureCount:number}
export interface RenewalDue {credentialId:number;employeeId:number;employeeName:string;qualificationId:number;qualificationName:string;validThrough:string;daysLeft:number;reminderDays:number;timezone:string;requestId:number|null;requestStatus:string|null;renewedFrom:string|null}
export interface RenewalView {id:number;employeeId:number;employeeName:string;qualificationName:string;previousCredentialId:number;previousValidFrom:string;previousValidThrough:string|null;status:'submitted'|'returned'|'verified'|'cancelled';version:number;reference:string;note:string;reviewNote:string|null;newCredentialId:number|null;createdAt:string;canReview:boolean}
