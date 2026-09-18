import { z } from 'zod';
import { civilDate, reason, timezone } from './hr-rules';

const clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const windowInput=z.object({start:clock,end:clock}).strict().refine(value=>value.end>value.start,'Closing time must follow opening time');
const dayInput=z.object({day:z.number().int().min(0).max(6),windows:z.array(windowInput).max(4)}).strict().refine(value=>value.windows.every((window,index)=>!index||value.windows[index-1].end<=window.start),'Daily windows must be ordered and must not overlap');
export const businessCalendarInput=z.object({timezone,week:z.array(dayInput).length(7).refine(days=>new Set(days.map(day=>day.day)).size===7,'Include each weekday once').refine(days=>days.some(day=>day.windows.length),'At least one weekly opening window is required'),holidays:z.array(z.object({date:civilDate,name:z.string().trim().min(1).max(120)}).strict()).max(500).refine(days=>new Set(days.map(day=>day.date)).size===days.length,'Use each holiday date once')}).strict();
export const helpdeskAutomationConfig=z.object({enabled:z.boolean(),clockMode:z.enum(['business','elapsed']),calendar:businessCalendarInput,remindersEnabled:z.boolean(),reminderLeadMinutes:z.number().int().min(0).max(10080),reminderRepeatMinutes:z.number().int().min(15).max(43200),maxOverdueReminders:z.number().int().min(1).max(20),autoEscalate:z.boolean(),escalationDelayMinutes:z.number().int().min(0).max(43200),notifyRequesterOnEscalation:z.boolean()}).strict();
export const helpdeskAutomationInput=z.object({version:z.number().int().min(0),config:helpdeskAutomationConfig,reason}).strict();
export type BusinessCalendar=z.infer<typeof businessCalendarInput>;
export type HelpdeskAutomationConfig=z.infer<typeof helpdeskAutomationConfig>;
export interface HelpdeskAutomationPolicy {version:number;createdBy:number|null;config:HelpdeskAutomationConfig;}
export const defaultHelpdeskAutomation:HelpdeskAutomationConfig={enabled:false,clockMode:'business',calendar:{timezone:'Asia/Qatar',week:[0,1,2,3,4,5,6].map(day=>({day,windows:day<=4?[{start:'09:00',end:'17:00'}]:[]})),holidays:[]},remindersEnabled:true,reminderLeadMinutes:60,reminderRepeatMinutes:240,maxOverdueReminders:3,autoEscalate:false,escalationDelayMinutes:60,notifyRequesterOnEscalation:true};
