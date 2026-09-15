import {z} from 'zod';
import {employeeWeekendDays,leaveDays,type CompanySettings} from './settings';
import {calculatePayroll,moneyCents,moneyText} from './money';

export const ruleScopes=['default','management_office','shift_based'] as const;
export type RuleScope=typeof ruleScopes[number];
export const ruleScopeLabels:Record<RuleScope,string>={default:'Default / unassigned',management_office:'Management office',shift_based:'Assigned shifts (event / FEC)'};
export const civilDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Choose a valid calendar date');
const rounding=z.enum(['nearest','down','up']);
const minutes=z.union([z.literal(1),z.literal(5),z.literal(10),z.literal(15),z.literal(30)]);
const timeRule=z.object({breakTreatment:z.enum(['unpaid','paid']),roundingMinutes:minutes,roundingMode:rounding}).strict();
export const calculationRulesSchema=z.object({
 attendance:timeRule.extend({lateGraceMinutes:z.number().int().min(0).max(120).nullable()}).strict(),
 leave:z.object({countMethod:z.enum(['working_days','calendar_days']),maxCalendarDays:z.number().int().min(1).max(367),
  excludeHolidays:z.boolean(),holidays:z.array(z.object({date:civilDate,name:z.string().trim().min(1).max(120)}).strict()).max(366)
   .refine(rows=>new Set(rows.map(r=>r.date)).size===rows.length,'Holiday dates must be unique')}).strict(),
 payroll:z.object({roundingCents:z.union([z.literal(1),z.literal(5),z.literal(10),z.literal(100)]),roundingMode:rounding}).strict(),
 timesheets:timeRule.extend({payableMethod:z.enum(['reviewer','calculated'])}).strict(),
}).strict();
export type CalculationRules=z.infer<typeof calculationRulesSchema>;
export const defaultCalculationRules:CalculationRules={
 attendance:{breakTreatment:'unpaid',roundingMinutes:1,roundingMode:'nearest',lateGraceMinutes:null},
 leave:{countMethod:'working_days',maxCalendarDays:367,excludeHolidays:false,holidays:[]},
 payroll:{roundingCents:1,roundingMode:'nearest'},
 timesheets:{breakTreatment:'unpaid',roundingMinutes:1,roundingMode:'nearest',payableMethod:'reviewer'},
};
export type CalculationSnapshot={version:number;scope:RuleScope;effectiveFrom:string|null;rules:CalculationRules;
 calendar:{weekendDays:number[];managementOfficeSchedule:CompanySettings['managementOfficeSchedule']}};
export const ruleScope=(employee:{workSchedule?:string|null}):RuleScope=>employee.workSchedule==='management_office'?'management_office':employee.workSchedule==='shift_based'?'shift_based':'default';
export function ruleDate(now=new Date(),timezone='Asia/Qatar'){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function roundUnits(value:number,increment:number,mode:'nearest'|'down'|'up'){
 if(!Number.isFinite(value)||value<0)throw new Error('Calculation requires a non-negative number');
 return Math[mode==='nearest'?'round':mode==='up'?'ceil':'floor'](value/increment)*increment;
}
export function calculateTime(elapsedMinutes:number,breakMinutes:number,rule:CalculationRules['timesheets']|CalculationRules['attendance']){
 if(!Number.isFinite(breakMinutes)||breakMinutes<0||breakMinutes>elapsedMinutes)throw new Error('Breaks must fit within the recorded time');
 const rawMinutes=elapsedMinutes-(rule.breakTreatment==='unpaid'?breakMinutes:0);
 return {rawMinutes,calculatedMinutes:roundUnits(rawMinutes,rule.roundingMinutes,rule.roundingMode)};
}
export function calculateLeave(start:string,end:string,snapshot:CalculationSnapshot){
 civilDate.parse(start);civilDate.parse(end);
 const span=(Date.parse(end)-Date.parse(start))/86400000+1,rule=snapshot.rules.leave;
 if(span<1||span>rule.maxCalendarDays)throw new Error(`Choose a leave period of 1 to ${rule.maxCalendarDays} calendar days`);
 const weekends=rule.countMethod==='calendar_days'?[]:employeeWeekendDays({workSchedule:snapshot.scope},snapshot.calendar as CompanySettings);
 let totalDays=leaveDays(start,end,weekends);
 if(rule.excludeHolidays)for(const holiday of rule.holidays)if(holiday.date>=start&&holiday.date<=end&&!weekends.includes(new Date(holiday.date).getUTCDay()))totalDays--;
 return {totalDays,calendarDays:span,excludedDays:span-totalDays};
}
export function calculatePolicyPayroll(basic:string|number,allowances:Record<string,string|number>,deductions:Record<string,string|number>,rule:CalculationRules['payroll']){
 const amounts=calculatePayroll(basic,allowances,deductions),before=moneyCents(amounts.netSalary);
 const after=roundUnits(before,rule.roundingCents,rule.roundingMode);
 return {...amounts,netSalary:moneyText(after),unroundedNetSalary:amounts.netSalary,roundingAdjustmentCents:after-before};
}
export function managementLate(checkIn:Date,snapshot:CalculationSnapshot){
 const grace=snapshot.rules.attendance.lateGraceMinutes,schedule=snapshot.calendar.managementOfficeSchedule;
 if(snapshot.scope!=='management_office'||grace===null)return false;
 const date=ruleDate(checkIn,schedule.timezone);
 if(!schedule.workingDays.includes(new Date(date).getUTCDay()))return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:schedule.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(checkIn).split(':').map(Number);
 const [hours,minutes]=schedule.startTime.split(':').map(Number);
 return parts[0]*60+parts[1]>hours*60+minutes+grace;
}
