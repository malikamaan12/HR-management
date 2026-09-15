import {z} from 'zod';
import {shiftInput, siteTimeToIso} from './workforce';
import {qualificationIds} from './workforce-staffing';

const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === v;
}, 'Enter a valid calendar date');
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const recurrenceInput = z.object({
  role: z.string().trim().min(2).max(120), station: z.string().trim().max(120).default(''),
  headcount: z.coerce.number().int().min(1).max(500), breakMinutes: z.coerce.number().int().min(0).max(1439),
  qualificationIds: qualificationIds.default([]),
  startDate: civilDate, endDate: civilDate,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform(v => [...new Set(v)].sort()),
  startTime: clockTime, endTime: clockTime, endDayOffset: z.number().int().min(0).max(1),
}).strict().refine(v => v.endDate >= v.startDate && Date.parse(v.endDate) - Date.parse(v.startDate) < 90*86400000,
  'Choose a date range of up to 90 days');
export const seriesInput = z.object({requestKey: z.string().uuid(), recurrence: recurrenceInput}).strict();
export const shiftChangeInput = z.object({version: z.number().int().positive(), reason: z.string().trim().min(5).max(500)}).strict();
export const shiftRevisionInput = z.object({version: z.number().int().positive(), reason: z.string().trim().min(5).max(500), shift: shiftInput}).strict();
export type Recurrence = z.infer<typeof recurrenceInput>;

/** Expand each local day separately so weekly wall times survive clock changes. */
export function expandRecurrence(input: Recurrence, timezone: string) {
  const results: z.infer<typeof shiftInput>[] = [];
  for(let day = Date.parse(input.startDate); day <= Date.parse(input.endDate); day += 86400000) {
    if(!input.weekdays.includes(new Date(day).getUTCDay())) continue;
    const startDate = new Date(day).toISOString().slice(0,10);
    const endDate = new Date(day + input.endDayOffset*86400000).toISOString().slice(0,10);
    results.push(shiftInput.parse({role: input.role, station: input.station, headcount: input.headcount, breakMinutes: input.breakMinutes,
      startAt: siteTimeToIso(`${startDate}T${input.startTime}`, timezone), endAt: siteTimeToIso(`${endDate}T${input.endTime}`, timezone)}));
  }
  if(!results.length || results.length > 60) throw new Error('Choose between 1 and 60 occurrences');
  return results;
}

export function siteWallTime(value: string, timezone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(value)).map(p => [p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
