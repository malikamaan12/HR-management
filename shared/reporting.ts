import {z} from 'zod';
import {civilDate} from './calculation-rules';
export const reportLabels={headcount:'Employee register',turnover:'Employee turnover',leave:'Approved leave bookings',compliance:'Document expiry',workforce:'Event and FEC delivery'};
export type ReportKind=keyof typeof reportLabels;
export const reportInput=z.object({kind:z.enum(['headcount','turnover','leave','compliance','workforce']),filters:z.object({
 department:z.string().trim().max(100).default(''),from:civilDate.optional(),to:civilDate.optional(),siteId:z.number().int().positive().optional(),teamId:z.number().int().positive().optional(),
}).strict(),requestKey:z.string().uuid()}).strict().superRefine((input,ctx)=>{
 const f=input.filters,dated=['turnover','leave','workforce'].includes(input.kind);
 if(dated&&(!f.from||!f.to||f.from>f.to||Date.parse(f.to)-Date.parse(f.from)>3660*86400000))ctx.addIssue({code:'custom',message:'Choose an ordered date range of at most ten years'});
 if(!dated&&(f.from||f.to))ctx.addIssue({code:'custom',message:'This report uses current records; date filters do not apply'});
 if(input.kind!=='workforce'&&(f.siteId||f.teamId))ctx.addIssue({code:'custom',message:'Site and team filters apply to workforce delivery only'});
 if(input.kind==='workforce'&&f.department)ctx.addIssue({code:'custom',message:'Use site and team filters for workforce delivery'});
});
export type ReportInput=z.infer<typeof reportInput>;
export type ReportSnapshot={kind:ReportKind;title:string;generatedAt:string;asOf:string;definition:string;filters:ReportInput['filters'];policy:Record<string,unknown>;summary:Record<string,string|number|null>;columns:{key:string;label:string}[];rows:Record<string,string|number|null>[];notes:string[]};
export type ReportRun={id:number;report_type:ReportKind;created_at:string;snapshot:ReportSnapshot};
