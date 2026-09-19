import {z} from 'zod';
import {civilDate} from './calculation-rules';
export const reportLabels={headcount:'Employee register',turnover:'Employee turnover',leave:'Approved leave bookings',compliance:'Document expiry',workforce:'Event and FEC delivery',attendance:'Attendance and supervisor approval',payroll:'Payroll and payment status',recruitment:'Recruitment pipeline',lifecycle:'Onboarding and offboarding',learning:'Learning completion and quiz results',helpdesk:'HR helpdesk service levels',performance:'Published performance outcomes',expenses:'Expense approvals and reimbursement',benefits:'Benefit requests and fulfilment',equipment:'Equipment custody and returns',handbook:'Handbook acknowledgements',communications:'Announcement read receipts',qualifications:'Qualification validity',employment:'Employment changes',quality:'Employee data readiness'};
export type ReportKind=keyof typeof reportLabels;
export const reportKinds=Object.keys(reportLabels) as [ReportKind,...ReportKind[]];
export const datedReports:ReportKind[]=['turnover','leave','workforce','attendance','payroll','recruitment','lifecycle','learning','helpdesk','performance','expenses','benefits','employment','communications'];
export const reportInput=z.object({kind:z.enum(reportKinds),filters:z.object({
 department:z.string().trim().max(100).default(''),from:civilDate.optional(),to:civilDate.optional(),siteId:z.number().int().positive().optional(),teamId:z.number().int().positive().optional(),
 employeeType:z.enum(['permanent','temporary','contract']).optional(),location:z.string().trim().max(150).optional(),
}).strict(),requestKey:z.string().uuid(),comparePrevious:z.boolean().optional()}).strict().superRefine((input,ctx)=>{
 const f=input.filters,dated=datedReports.includes(input.kind);
 if(dated&&(!f.from||!f.to||f.from>f.to||Date.parse(f.to)-Date.parse(f.from)>3660*86400000))ctx.addIssue({code:'custom',message:'Choose an ordered date range of at most ten years'});
 if(!dated&&(f.from||f.to))ctx.addIssue({code:'custom',message:'This report uses current records; date filters do not apply'});
 if(input.kind!=='workforce'&&(f.siteId||f.teamId))ctx.addIssue({code:'custom',message:'Site and team filters apply to workforce delivery only'});
 if(input.kind==='workforce'&&f.department)ctx.addIssue({code:'custom',message:'Use site and team filters for workforce delivery'});
 if(['workforce','communications','helpdesk'].includes(input.kind)&&(f.employeeType||f.location))ctx.addIssue({code:'custom',message:'Employee type and location do not apply to this report'});
 if(input.kind==='communications'&&f.department)ctx.addIssue({code:'custom',message:'Announcements use their own recipient audience; department filters do not apply'});
 if(input.comparePrevious&&!dated)ctx.addIssue({code:'custom',message:'Period comparisons require a dated report'});
});
export type ReportInput=z.infer<typeof reportInput>;
export type ReportSnapshot={kind:ReportKind;title:string;generatedAt:string;asOf:string;definition:string;filters:ReportInput['filters'];policy:Record<string,unknown>;summary:Record<string,string|number|null>;columns:{key:string;label:string}[];rows:Record<string,string|number|null>[];notes:string[];comparison?:ReportSnapshot;scopeLabel?:string};
export type ReportRun={id:number;report_type:ReportKind;created_at:string;snapshot:ReportSnapshot};
export const analyticsPolicyInput=z.object({maxRows:z.number().int().min(100).max(5000),minimumPerformanceSample:z.number().int().min(1).max(50),schedulesEnabled:z.boolean()}).strict();
export const defaultAnalyticsPolicy={maxRows:5000,minimumPerformanceSample:5,schedulesEnabled:true};
export const savedReportInput=z.object({name:z.string().trim().min(3).max(120),kind:z.enum(reportKinds),filters:reportInput.innerType().shape.filters,comparePrevious:z.boolean().default(false),columns:z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(30).default([])}).strict();
export type SavedReportInput=z.infer<typeof savedReportInput>;
export const scheduleInput=z.object({name:z.string().trim().min(3).max(120),kind:z.enum(reportKinds),filters:reportInput.innerType().shape.filters,cadence:z.enum(['daily','weekly','monthly']),hour:z.number().int().min(0).max(23),enabled:z.boolean(),reason:z.string().trim().min(5).max(1000)}).strict();
export const previousPeriod=(from:string,to:string)=>{const length=Date.parse(to)-Date.parse(from)+86400000;return {from:new Date(Date.parse(from)-length).toISOString().slice(0,10),to:new Date(Date.parse(from)-86400000).toISOString().slice(0,10)};};
