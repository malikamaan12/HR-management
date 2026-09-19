import {z} from 'zod';
import type {UserRole} from './schema';

export const workforceAdmin = (role: UserRole) => ['admin', 'super_admin', 'hr', 'hr_director'].includes(role);
export const workforceKinds = ['event', 'fec', 'mall_activation', 'head_office'] as const;
export const kindLabels = {event: 'Event', fec: 'FEC', mall_activation: 'Mall activation', head_office:'Head office'};
export const positiveId = z.coerce.number().int().positive();
const instant = z.string().datetime({offset: true}).transform(value => new Date(value));
export const period = z.object({startAt: instant, endAt: instant}).strict().refine(v => v.endAt > v.startAt, 'End must be after start');
export const siteInput = z.object({name: z.string().trim().min(2).max(120), timezone: z.string().max(80).refine(value => {
  try {new Intl.DateTimeFormat('en', {timeZone: value}); return true;} catch {return false;}
}, 'Use a valid IANA time zone, such as Asia/Qatar')}).strict();
export const teamInput = z.object({name: z.string().trim().min(2).max(120), siteId: positiveId, kind: z.enum(workforceKinds)}).strict();
export const memberInput = z.object({employeeId: positiveId, startAt: instant, endAt: instant}).strict().refine(v => v.endAt > v.startAt, 'End must be after start');
export const grantInput = z.object({userId: positiveId, permission: z.enum(['view', 'schedule', 'review_time', 'review_performance']), startAt: instant, endAt: instant}).strict().refine(v => v.endAt > v.startAt, 'End must be after start');
export const shiftInput = z.object({role: z.string().trim().min(2).max(120), station: z.string().trim().max(120).optional(),
  headcount: z.coerce.number().int().min(1).max(500), breakMinutes: z.coerce.number().int().min(0).max(1439).default(0), startAt: instant, endAt: instant,
  qualificationIds: z.array(positiveId).max(20).transform(ids=>[...new Set(ids)].sort((a,b)=>a-b)).optional(),
  requiredSkills: z.array(positiveId).max(30).default([]).refine(values => new Set(values).size === values.length, 'Required skills must be unique'),
}).strict().refine(v => v.endAt > v.startAt && +v.endAt - +v.startAt <= 86400000 && v.breakMinutes * 60000 < +v.endAt - +v.startAt,
  'Shifts must last up to 24 hours, with a break shorter than the shift');

export interface TeamSummary {id: number; name: string; kind: typeof workforceKinds[number]; siteId: number; siteName: string; timezone: string}
export interface WorkforceHome {isAdmin: boolean; teams: TeamSummary[]; sites: {id:number;name:string;timezone:string}[]}
export interface WorkforcePerson {id:number; name:string; label:string}
export interface AssignmentView {id:number; employeeId:number; name:string; status:'offered'|'accepted'|'declined'|'cancelled'; cancellationReason:string|null;replacesAssignmentId:number|null;replacementReason:string|null;replacementPending:boolean;missingQualifications:string[]}
export interface ShiftView {requiredSkills:number[];id:number; version:number; status:'scheduled'|'cancelled'|'replaced'; seriesId:number|null; replacesId:number|null; replacementId:number|null; changeReason:string|null; requiredQualifications:{id:number;name:string}[]; role:string; station:string|null; headcount:number; startAt:string; endAt:string; breakMinutes:number; canSchedule:boolean; assignments:AssignmentView[]}
export interface WorkforceDashboard {
  team: TeamSummary; canSchedule: boolean; from:string; to:string;
  shifts: ShiftView[];
  skills: WorkforceSkill[];
  members: {id:number;version:number;employeeId:number;name:string;type:string;startAt:string;endAt:string}[];
  grants: {id:number;name:string;permission:string;startAt:string;endAt:string;revokedAt:string|null}[];
}
export interface MyAssignment {requiredSkills:WorkforceSkill[];id:number;shiftId:number; status:AssignmentView['status']; replacesId:number|null;changeReason:string|null; cancellationReason:string|null;replacesAssignmentId:number|null;replacementReason:string|null;replacementPending:boolean;requiredQualifications:{id:number;name:string}[];missingQualifications:string[]; role:string;station:string|null;startAt:string;endAt:string;breakMinutes:number;teamName:string;siteName:string;timezone:string;kind:TeamSummary['kind']}
export interface WorkforceSkill {id:number; name:string; category:string|null}
export interface WorkforceQualification {id:number;skillId:number;name:string;proficiencyLevel:number;certificationExpiry:string|null;updatedAt:string}
export const workforceSkillInput=z.object({name:z.string().trim().min(2).max(120),category:z.string().trim().max(80).default('')}).strict();
export const workforceQualificationInput=z.object({skillId:positiveId,proficiencyLevel:z.number().int().min(1).max(5),
  certificationExpiry:z.string().datetime({offset:true}).nullable(),expectedUpdatedAt:z.string().datetime({offset:true}).nullable()}).strict();

// Calendar-day checks use the site's time zone, including overnight shifts.
export function localDate(instant: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(instant);
}

/** Resolve a wall-clock input in the site zone; never silently shift a DST gap/fold. */
export function siteTimeToIso(value:string, timezone:string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Enter a complete date and time');
  const wall=Date.parse(value+':00Z');
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0,16)!==value) throw new Error('Enter a valid date and time');
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const asWall=(time:number)=>{
    const parts=Object.fromEntries(format.formatToParts(new Date(time)).map(p=>[p.type,p.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const offsets=[...new Set([-86400000,0,86400000].map(delta=>asWall(wall+delta)-(wall+delta)))];
  const matches=offsets.map(offset=>wall-offset).filter(candidate=>asWall(candidate)===wall);
  if(matches.length!==1) throw new Error('This time is skipped or repeated by a clock change. Choose an unambiguous time.');
  return new Date(matches[0]).toISOString();
}
