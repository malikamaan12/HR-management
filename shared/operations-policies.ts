import {z} from 'zod';
import {roundUnits} from './calculation-rules';
export const hundredths=z.number().finite().refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'Use at most two decimal places');
export const accrualPolicy=z.object({enabled:z.boolean(),monthlyDays:hundredths.refine(n=>n>=0&&n<=31),annualCap:hundredths.refine(n=>n>=0&&n<=366),prorate:z.boolean(),minServiceDays:z.number().int().min(0).max(3650),carryoverCap:hundredths.refine(n=>n>=0&&n<=366)}).strict();
export const payPolicy=z.object({enabled:z.boolean(),hourlyRateCents:z.number().int().min(0).max(1000000),overtimeAfterMinutes:z.number().int().min(1).max(1440),overtimeMultiplierHundredths:z.number().int().min(100).max(500),roundingMode:z.enum(['nearest','down','up'])}).strict();
export const dayAmount=(n:number)=>Math.round(n*100)/100;
export function timeEarnings(minutes:number,p:z.infer<typeof payPolicy>){
 if(!Number.isInteger(minutes)||minutes<0||minutes>1440)throw new Error('Invalid approved payable minutes');
 const regular=Math.min(minutes,p.overtimeAfterMinutes),overtime=Math.max(0,minutes-regular);
 const amountCents=roundUnits((regular*p.hourlyRateCents*100+overtime*p.hourlyRateCents*p.overtimeMultiplierHundredths)/6000,1,p.roundingMode);
 return {regularMinutes:regular,overtimeMinutes:overtime,amountCents};
}
