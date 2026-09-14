import { z } from 'zod';
const days=z.array(z.number().int().min(0).max(6)).refine(value=>new Set(value).size===value.length,'Days must be unique');
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use HH:mm');
export const managementOfficeScheduleSchema=z.object({
  workingDays:days.refine(value=>value.length>0 && value.length<7,'Select one to six working days'),
  startTime:time,endTime:time,
  timezone:z.string().refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Choose a valid timezone'),
}).refine(value=>value.endTime>value.startTime,'Office end time must be after start time');
export const defaultManagementOfficeSchedule={workingDays:[0,1,2,3,4],startTime:'09:00',endTime:'17:00',timezone:'Asia/Qatar'};
export type ManagementOfficeSchedule=z.infer<typeof managementOfficeScheduleSchema>;
export function officeScheduleSummary(schedule:ManagementOfficeSchedule){
  return `${[...schedule.workingDays].sort().map(day=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ')} · ${schedule.startTime}–${schedule.endTime} (${schedule.timezone})`;
}
export const companySettingsSchema=z.object({companyName:z.string().trim().min(1).max(200),companyEmail:z.union([z.string().email(),z.literal('')]),
  companyPhone:z.string().max(80),companyAddress:z.string().max(500),documentExpiryDays:z.number().int().min(1).max(365),
  weekendDays:z.array(z.number().int().min(0).max(6)).max(6).refine(days=>new Set(days).size===days.length),
  managementOfficeSchedule:managementOfficeScheduleSchema.default(defaultManagementOfficeSchedule)});
export type CompanySettings=z.infer<typeof companySettingsSchema>;
export const defaultCompanySettings:CompanySettings={companyName:'E3 HR',companyEmail:'',companyPhone:'',companyAddress:'',documentExpiryDays:30,weekendDays:[0,6],managementOfficeSchedule:defaultManagementOfficeSchedule};
export function employeeWeekendDays(employee:{workSchedule?:string|null},policy:CompanySettings){
  return employee.workSchedule==='management_office'?[0,1,2,3,4,5,6].filter(day=>!policy.managementOfficeSchedule.workingDays.includes(day)):policy.weekendDays;
}
export function leaveDays(start:string,end:string,weekends:number[]):number{
  const from=Date.parse(start),to=Date.parse(end);if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(from)||!Number.isFinite(to)||new Date(from).toISOString().slice(0,10)!==start||new Date(to).toISOString().slice(0,10)!==end||to<from||to-from>366*86400000)throw new Error('Choose valid calendar dates within a period of at most one year');
  let days=0;for(let time=from;time<=to;time+=86400000)if(!weekends.includes(new Date(time).getUTCDay()))days++;return days;
}
