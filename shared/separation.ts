import {z} from 'zod';
import {civilDate} from './hr-rules';

const amount=z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter a non-negative amount with up to two decimals');
const text=z.string().trim().max(6000);
export const separationManager=(role:string)=>['admin','super_admin','hr_director','hr'].includes(role);
export const separationPolicyManager=(role:string)=>['admin','super_admin','hr_director'].includes(role);
export const separationKinds=['termination','resignation','contract_expiry','mutual_agreement'] as const;
export const separationLabels:Record<string,string>={termination:'Termination',resignation:'Resignation',contract_expiry:'Contract expiry',mutual_agreement:'Mutual agreement',draft:'Draft',in_review:'In review',approved:'Approved',completed:'Completed',cancelled:'Cancelled'};
export const separationStatuses=['draft','in_review','approved','completed','cancelled'] as const;
export const documentKinds=['notice','service','settlement'] as const;
export const documentLabels={notice:'Separation / notice letter',service:'Service certificate',settlement:'End-of-service statement'};
export const documentFields=['company_name','employee_name','employee_id','position','joining_date','last_day','notice_date','notice_due','reason','reference'] as const;
const template=z.object({body:text.min(3),bodyAr:text.min(3)}).strict();
export const separationPolicySchema=z.object({
  daysPerYear:z.number().min(0).max(365).multipleOf(0.5), minimumYears:z.number().int().min(0).max(10),
  monthlyDivisor:z.number().int().min(1).max(31), yearMethod:z.enum(['anniversary','actual_365']),
  shortServiceMonths:z.number().int().min(1).max(120), shortNoticeMonths:z.number().int().min(0).max(12), longNoticeMonths:z.number().int().min(0).max(12),
  requireDirectorApproval:z.boolean(), notice:template, service:template, settlement:template,
}).strict();
export type SeparationPolicy=z.infer<typeof separationPolicySchema>;
export const defaultSeparationPolicy:SeparationPolicy={
  daysPerYear:21,minimumYears:1,monthlyDivisor:30,yearMethod:'anniversary',shortServiceMonths:24,shortNoticeMonths:1,longNoticeMonths:2,requireDirectorApproval:false,
  notice:{body:'This letter records the end of employment of {{employee_name}} ({{employee_id}}) with {{company_name}}. The last employment date is {{last_day}}. Written notice was given on {{notice_date}}.\nReason: {{reason}}\nHR will coordinate handover and the separate settlement statement.',bodyAr:'يسجل هذا الخطاب انتهاء خدمة {{employee_name}} ({{employee_id}}) لدى {{company_name}}. آخر يوم عمل هو {{last_day}}. تم تقديم الإخطار الكتابي بتاريخ {{notice_date}}.\nالسبب: {{reason}}\nتتولى الموارد البشرية تنسيق تسليم العهد وإعداد بيان المستحقات بشكل منفصل.'},
  service:{body:'{{company_name}} certifies that {{employee_name}} ({{employee_id}}) worked as {{position}} from {{joining_date}} to {{last_day}}. The recorded last basic wage is shown below. This certificate records employment service.',bodyAr:'تشهد {{company_name}} بأن {{employee_name}} ({{employee_id}}) عمل بوظيفة {{position}} من {{joining_date}} إلى {{last_day}}. يُبيّن أدناه آخر أجر أساسي مسجّل. صدرت هذه الشهادة لإثبات مدة الخدمة.'},
  settlement:{body:'This statement itemizes the reviewed end-of-service calculation for {{employee_name}} through {{last_day}}. It is not a payment receipt or a waiver of rights. Amounts already paid must not be included again.',bodyAr:'يوضح هذا البيان حساب مستحقات نهاية الخدمة بعد مراجعتها للموظف {{employee_name}} حتى {{last_day}}. لا يُعد هذا البيان إيصال سداد أو تنازلاً عن الحقوق. يجب عدم إدراج المبالغ التي سبق سدادها مرة أخرى.'},
};
export const separationInputSchema=z.object({
  kind:z.enum(separationKinds),lastDay:civilDate,noticeDate:civilDate,reason:text.min(3),reasonAr:text,
  employeeNameAr:z.string().trim().max(200),companyNameAr:z.string().trim().max(200),positionAr:z.string().trim().max(200),
  noticeMode:z.enum(['policy','custom','not_required']),noticeDays:z.number().int().min(0).max(365).nullable(),noticeReason:text,
  noticeSettlement:z.enum(['employer_pays','employee_owes','waived']),
  basicOverride:amount.nullable(),basicReason:text,
  gratuityMode:z.enum(['policy','manual']),gratuityOverride:amount.nullable(),gratuityReason:text,
  unpaidSalary:amount,leaveDays:z.number().min(0).max(1000).multipleOf(0.5),leaveMonthlyBasis:amount.nullable(),
  adjustments:z.array(z.object({label:z.string().trim().min(2).max(100),labelAr:z.string().trim().min(2).max(100),direction:z.enum(['earning','deduction']),amount,reason:z.string().trim().min(3).max(1000)}).strict()).max(30),
  reconciliationNote:text,noticeText:template,serviceText:template,settlementText:template,
}).strict().superRefine((v,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.noticeDate>v.lastDay)issue('Notice date must be on or before the last employment date');
  if(v.noticeMode==='custom'&&v.noticeDays===null)issue('Enter the agreed notice days');
  if((v.noticeMode!=='policy'||v.noticeSettlement==='waived')&&v.noticeReason.length<3)issue('Explain the notice exception or waiver');
  if(v.basicOverride!==null&&v.basicReason.length<3)issue('Explain the last basic wage override');
  if(v.gratuityMode==='manual'&&(v.gratuityOverride===null||v.gratuityReason.length<3))issue('Enter the gratuity amount and the reason for a manual calculation');
});
export type SeparationInput=z.infer<typeof separationInputSchema>;
export function blankSeparation(policy:SeparationPolicy,today:string):SeparationInput{return {kind:'termination',lastDay:today,noticeDate:today,reason:'',reasonAr:'',employeeNameAr:'',companyNameAr:'',positionAr:'',noticeMode:'policy',noticeDays:null,noticeReason:'',noticeSettlement:'employer_pays',basicOverride:null,basicReason:'',gratuityMode:'policy',gratuityOverride:null,gratuityReason:'',unpaidSalary:'0.00',leaveDays:0,leaveMonthlyBasis:null,adjustments:[],reconciliationNote:'',noticeText:{...policy.notice},serviceText:{...policy.service},settlementText:{...policy.settlement}};}
export type SettlementLine={label:string;labelAr:string;cents:number;direction:'earning'|'deduction';method:string};
export type SeparationSnapshot={
  employee:{id:number;name:string;reference:string;position:string;joiningDate:string;status:string};company:{name:string;address:string};
  policy:SeparationPolicy & {version:number};currency:string;basicCents:number;basicSource:string;compensationId:number|null;
  remuneration:{label:string;labelAr:string;cents:number;frequency:string}[];
  service:{start:string;end:string;days:number;years:number;eligible:boolean;source:string;continuityPolicyVersion:number;bridgedDays:number};
  notice:{days:number;servedDays:number;shortfallDays:number;dueDate:string;source:string};
  lines:SettlementLine[];earningsCents:number;deductionsCents:number;netCents:number;sourceHash:string;
};
export type SeparationRecord={id:number;reference:string;employee_id:number;employee_name:string;status:typeof separationStatuses[number];version:number;input:SeparationInput;snapshot:SeparationSnapshot|null;created_by:number;prepared_by:number;reviewed_by:number|null;created_at:string;reviewed_at:string|null;completed_at:string|null;canManage:boolean;canReview:boolean;history:{action:string;note:string;created_at:string;actor_name:string}[]};
export function fillSeparationText(value:string,fields:Record<string,string>){return value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(match,key)=>fields[key]??match);}
