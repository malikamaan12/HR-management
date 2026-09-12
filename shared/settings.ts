import { z } from 'zod';
export const companySettingsSchema=z.object({companyName:z.string().trim().min(1).max(200),companyEmail:z.union([z.string().email(),z.literal('')]),
  companyPhone:z.string().max(80),companyAddress:z.string().max(500),documentExpiryDays:z.number().int().min(1).max(365),
  weekendDays:z.array(z.number().int().min(0).max(6)).max(6).refine(days=>new Set(days).size===days.length)});
export type CompanySettings=z.infer<typeof companySettingsSchema>;
export const defaultCompanySettings:CompanySettings={companyName:'E3 HR',companyEmail:'',companyPhone:'',companyAddress:'',documentExpiryDays:30,weekendDays:[0,6]};
export function leaveDays(start:string,end:string,weekends:number[]):number{
  const from=Date.parse(start),to=Date.parse(end);if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>366*86400000)throw new Error('Choose a valid leave period of at most one year');
  let days=0;for(let time=from;time<=to;time+=86400000)if(!weekends.includes(new Date(time).getUTCDay()))days++;return days;
}
