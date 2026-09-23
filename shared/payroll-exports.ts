import {z} from 'zod';
import {moneyCents,moneyText} from './money';

export const exportKinds=['all','head_office','fec','mall_activation','event','unassigned'] as const;
export const exportKindLabels:Record<typeof exportKinds[number],string>={all:'All employees',head_office:'Head Office',fec:'FEC',mall_activation:'Mall activation',event:'Event',unassigned:'Unassigned'};
export const exportFilterSchema=z.object({month:z.coerce.number().int().min(1).max(12),year:z.coerce.number().int().min(2000).max(2200),kind:z.enum(exportKinds).default('all'),teamId:z.coerce.number().int().positive().optional(),siteId:z.coerce.number().int().positive().optional()}).strict();
export type ExportFilter=z.infer<typeof exportFilterSchema>;
const text=(max:number)=>z.string().trim().max(max);
const safeText=(max:number)=>text(max).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'Use a single line of text');
const amount=z.string().regex(/^\d{1,10}(\.\d{1,2})?$/,'Use a non-negative amount with up to two decimal places');
export const wpsSettingsSchema=z.object({
  employerEid:text(8),payerEid:text(8),payerQid:text(11),payerBank:text(4).transform(v=>v.toUpperCase()),payerIban:text(40).transform(v=>v.replace(/\s/g,'').toUpperCase()),
  bankMappings:z.array(z.object({name:safeText(150),code:text(4).transform(v=>v.toUpperCase())}).strict()).max(100),
  housingLabels:z.array(safeText(100)).max(50).transform(values=>values.filter(Boolean)),foodLabels:z.array(safeText(100)).max(50).transform(values=>values.filter(Boolean)),transportLabels:z.array(safeText(100)).max(50).transform(values=>values.filter(Boolean)),overtimeLabels:z.array(safeText(100)).max(50).transform(values=>values.filter(Boolean)),
}).strict().superRefine((v,ctx)=>{
  const names=v.bankMappings.map(m=>m.name.toLowerCase());
  if(new Set(names).size!==names.length)ctx.addIssue({code:'custom',path:['bankMappings'],message:'Use one mapping per bank name'});
  const labels=[...v.housingLabels,...v.foodLabels,...v.transportLabels,...v.overtimeLabels];
  if(new Set(labels).size!==labels.length)ctx.addIssue({code:'custom',message:'Assign each allowance label to only one category'});
  if(v.bankMappings.some(m=>!m.name||!bankCode(m.code)))ctx.addIssue({code:'custom',path:['bankMappings'],message:'Enter a bank name and a valid 2–4 letter bank code'});
});
export type WpsSettings=z.infer<typeof wpsSettingsSchema>;
export const defaultWpsSettings:WpsSettings={employerEid:'',payerEid:'',payerQid:'',payerBank:'',payerIban:'',bankMappings:[],housingLabels:[],foodLabels:[],transportLabels:[],overtimeLabels:[]};
export const wpsEmployeeSchema=z.object({name:safeText(70),qid:text(11),visaId:text(12),bank:text(4).transform(v=>v.toUpperCase()),account:text(40).transform(v=>v.replace(/\s/g,'').toUpperCase())}).strict();
export type WpsEmployee=z.infer<typeof wpsEmployeeSchema>;
export const deductionReasons={'01':'Working hours','02':'Work arrangements','03':'Harm or damage','04':'Advance payments','99':'Other reason'} as const;
export const paymentTypes=['Normal Payment','Settlement Payment','Partial Payment','Delayed Payment'] as const;
export const wpsRecordSchema=z.object({basic:amount,extraIncome:amount,deductions:amount,extraHours:z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),workingDays:z.number().int().min(0).max(999).nullable(),deductionReason:z.enum(['','01','02','03','04','99']),paymentType:z.enum(paymentTypes),notes:safeText(300)}).strict();
export type WpsRecord=z.infer<typeof wpsRecordSchema>;
export type ExportGroup={id:number;name:string;kind:'event'|'fec'|'mall_activation'|'head_office';siteId:number;siteName:string};
export type PayrollExportRow={
  id:number;employeeId:number;employeeRef:string;name:string;department:string;position:string;status:string;currency:string|null;periodStart:string|null;periodEnd:string|null;payDate:string|null;
  basic:string;allowances:Record<string,string>;deductions:Record<string,string>;roundingCents:number;net:string;paymentReference:string|null;groups:ExportGroup[];headOffice:boolean;fingerprint:string;
  wps?:{employee:WpsEmployee;employeeVersion:number;record:WpsRecord;recordVersion:number;issues:string[];warnings:string[];lastExport:{filename:string;at:string}|null;breakdown:{housing:string;food:string;transport:string;overtime:string}};
};
export type PayrollExportPreview={rows:PayrollExportRow[];teams:ExportGroup[];canWps:boolean;canConfigure:boolean;settingsVersion:number;settingsIssues:string[];settings:WpsSettings|null;totalBeforeFilter:number;limit:number};
export type WpsSettingsResponse={version:number;settings:WpsSettings;issues:string[]};
export const exportRequestSchema=z.object({filter:exportFilterSchema,records:z.array(z.object({id:z.number().int().positive(),fingerprint:z.string().length(64)}).strict()).min(1).max(500),format:z.enum(['payslips','csv','wps']),settingsVersion:z.number().int().min(0).optional(),confirmed:z.boolean().optional(),allowReexport:z.boolean().optional(),reason:text(1000).optional()}).strict().refine(v=>new Set(v.records.map(r=>r.id)).size===v.records.length,'Select each payroll record only once');

export function bankCode(value:string){return /^[A-Z]{2,4}$/.test(value);}
export function validQatarIban(value:string){
  if(!/^QA\d{2}[A-Z]{4}[A-Z0-9]{21}$/.test(value))return false;
  let remainder=0;
  for(const char of value.slice(4)+value.slice(0,4)){
    for(const digit of /[A-Z]/.test(char)?String(char.charCodeAt(0)-55):char)remainder=(remainder*10+Number(digit))%97;
  }
  return remainder===1;
}
export function settingsIssues(value:WpsSettings):string[]{
  const issues:string[]=[];
  if(!/^\d{7,8}$/.test(value.employerEid))issues.push('Enter the employer establishment ID (7 or 8 digits).');
  if(!((/^\d{7,8}$/.test(value.payerEid)&&!value.payerQid)||(/^\d{11}$/.test(value.payerQid)&&!value.payerEid)))issues.push('Enter either a payer establishment ID or a payer QID.');
  if(!bankCode(value.payerBank))issues.push('Enter the payer bank short code.');
  if(!validQatarIban(value.payerIban))issues.push('Enter a valid Qatar payer IBAN.');
  return issues;
}
export function employeeIssues(value:WpsEmployee,settings:WpsSettings):string[]{
  const issues:string[]=[];
  if(!value.name||value.name.length>70||/^[=+@-]/.test(value.name))issues.push('Enter the employee name as shown on their QID or visa (up to 70 characters).');
  if(!((/^\d{11}$/.test(value.qid)&&!value.visaId)||(/^\d{12}$/.test(value.visaId)&&!value.qid)))issues.push('Enter either an 11-digit QID or a 12-digit visa ID.');
  if(!bankCode(value.bank))issues.push('Set the employee bank short code.');
  const sameBank=value.bank===settings.payerBank;
  if(!validQatarIban(value.account)&&!(sameBank&&/^[A-Z0-9]{1,29}$/.test(value.account)&&!value.account.startsWith('QA')))issues.push(sameBank?'Enter a valid Qatar IBAN or same-bank account number.':'Enter a valid Qatar IBAN for this employee.');
  return issues;
}
export function recordIssues(value:WpsRecord,net:string):string[]{
  const issues:string[]=[];
  if(moneyCents(value.basic)<=0)issues.push('Enter a positive contractual basic salary for WPS.');
  if(moneyCents(value.basic)+moneyCents(value.extraIncome)-moneyCents(value.deductions)!==moneyCents(net))issues.push('WPS basic + extra income − deductions must equal the saved net pay.');
  if(moneyCents(value.deductions)>0&&!value.deductionReason)issues.push('Choose a deduction reason code.');
  if(value.deductionReason==='99'&&!value.notes)issues.push('Add a note explaining the other deduction reason.');
  if(/^[=+@-]/.test(value.notes))issues.push('Start WPS notes with a word or number.');
  return issues;
}
export function sumMoney(values:Record<string,string>){return Object.values(values).reduce((total,value)=>total+moneyCents(value),0);}
export function totalMoney(rows:PayrollExportRow[]){return moneyText(rows.reduce((total,row)=>total+moneyCents(row.net),0));}
