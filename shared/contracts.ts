import {z} from 'zod';
export const contractManager = (role:string) => ['admin','super_admin','hr_director','hr'].includes(role);
export const contractStatuses = ['draft','sent','signed','declined','withdrawn'] as const;
const text=(max:number)=>z.string().trim().max(max).default('');
export const clauseSchema=z.object({title:text(160),body:text(6000),titleAr:text(160),bodyAr:text(6000)}).strict();
const arabicSchema=z.object({title:text(200),position:text(200),department:text(200),location:text(300),schedule:text(3000),compensation:text(6000)}).strict();
export const contractContentSchema=z.object({
  title:z.string().trim().min(3).max(200),position:text(200),department:text(200),location:text(300),schedule:text(3000),compensation:text(6000),
  arabic:arabicSchema.default({}),companyNameAr:text(200),companyAddressAr:text(1000),clauses:z.array(clauseSchema).max(30),
}).strict();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Choose a valid date');
const dateOrEmpty=z.union([date,z.literal('')]);
export const contractDraftSchema=contractContentSchema.extend({startDate:dateOrEmpty,endDate:dateOrEmpty,employeeNameAr:text(200),languageMode:z.literal('en-ar').default('en-ar')})
  .refine(v=>!v.startDate||!v.endDate||v.endDate>=v.startDate,'End date must follow the start date')
  .refine(v=>JSON.stringify(v).length<=80000,'Keep the bilingual contract under 80,000 characters');
export type ContractContent=z.infer<typeof contractContentSchema>;
export type ContractDraft=z.infer<typeof contractDraftSchema>;
export type ContractDocument=ContractDraft & {companyName:string;companyAddress:string;employeeName:string;employeeReference:string};
export const templateSchema=z.object({name:z.string().trim().min(3).max(160),category:z.string().trim().min(2).max(80),description:text(600),active:z.boolean(),document:contractContentSchema}).strict();
export function templateIssues(value:z.infer<typeof templateSchema>):string[]{
  if(!value.active)return [];
  const issues:string[]=[];
  if(!value.document.arabic.title.trim())issues.push('Add the Arabic contract title before making this template available.');
  if(!value.document.clauses.length||value.document.clauses.some(c=>!c.title||!c.body||!c.titleAr||!c.bodyAr))issues.push('Available templates need at least one complete English–Arabic clause.');
  return issues;
}
export type ContractTemplate={id:number;name:string;category:string;description:string;active:boolean;version:number;document:ContractContent;updated_at:string};
export type TemplateSummary=Omit<ContractTemplate,'document'> & {clause_count:number};
export const blankContent=():ContractContent=>({title:'Employment contract',position:'',department:'',location:'',schedule:'',compensation:'',companyNameAr:'',companyAddressAr:'',arabic:{title:'عقد عمل',position:'',department:'',location:'',schedule:'',compensation:''},clauses:[]});
export const blankDraft=():ContractDraft=>({...blankContent(),startDate:'',endDate:'',employeeNameAr:'',languageMode:'en-ar'});
// Normalize only an editable copy. Never modify a sent document or its fingerprint.
export function editableDraft(d:ContractDocument):ContractDraft{
  const b=blankDraft();return {...b,...contentOf(d),startDate:d.startDate,endDate:d.endDate,employeeNameAr:d.employeeNameAr||''};
}
export function contentOf(d:ContractContent):ContractContent{
  const b=blankContent();return {title:d.title,position:d.position,department:d.department,location:d.location,schedule:d.schedule,compensation:d.compensation,
    companyNameAr:d.companyNameAr||'',companyAddressAr:d.companyAddressAr||'',arabic:{...b.arabic,...d.arabic,title:d.arabic?.title||''},
    clauses:d.clauses.map(c=>({title:c.title,body:c.body,titleAr:c.titleAr||'',bodyAr:c.bodyAr||''}))};
}
export function bilingualIssues(d:ContractDocument):string[]{
  const issues:string[]=[];
  for(const [key,label] of [['title','Contract title'],['position','Position'],['schedule','Working arrangements'],['compensation','Compensation']] as const){
    if(!d[key]?.trim())issues.push(label+' · English');if(!d.arabic?.[key]?.trim())issues.push(label+' · Arabic');
  }
  for(const [key,label] of [['department','Department'],['location','Work location']] as const){
    if(d[key]?.trim()&&!d.arabic?.[key]?.trim())issues.push(label+' · Arabic');
    if(d.arabic?.[key]?.trim()&&!d[key]?.trim())issues.push(label+' · English');
  }
  if(!d.startDate)issues.push('Start date');
  if(!d.employeeNameAr?.trim())issues.push('Employee name · Arabic');
  if(!d.companyNameAr?.trim())issues.push('Company name · Arabic');
  if(d.companyAddress&&!d.companyAddressAr?.trim())issues.push('Company address · Arabic');
  if(!d.clauses.length)issues.push('At least one English–Arabic clause');
  d.clauses.forEach((c,i)=>{if(!c.title?.trim()||!c.body?.trim())issues.push('Term '+(i+1)+' · English');if(!c.titleAr?.trim()||!c.bodyAr?.trim())issues.push('Term '+(i+1)+' · Arabic');});
  if(JSON.stringify(d).includes('{{')||JSON.stringify(d).includes('}}'))issues.push('Replace all placeholders');
  return issues;
}
export const agreementEnglish='I have reviewed both the English and Arabic text of this exact contract and agree to its terms. I intend my signature to confirm my agreement.';
export const agreementArabic='لقد راجعت النصين الإنجليزي والعربي لهذا العقد بصيغته الحالية وأوافق على شروطه، وأقصد بتوقيعي تأكيد موافقتي.';
export function fillContractClause(body:string,values:Record<string,string>){
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(original,key)=>values[key]?.trim()||original);
}
export function fillContractContent(d:ContractContent,values:Record<string,string>):ContractContent{
  const fill=(s:string)=>fillContractClause(s,values);
  return {...d,title:fill(d.title),position:fill(d.position),department:fill(d.department),location:fill(d.location),schedule:fill(d.schedule),compensation:fill(d.compensation),
    arabic:{title:fill(d.arabic.title),position:fill(d.arabic.position),department:fill(d.arabic.department),location:fill(d.arabic.location),schedule:fill(d.arabic.schedule),compensation:fill(d.arabic.compensation)},
    clauses:d.clauses.map(c=>({title:fill(c.title),body:fill(c.body),titleAr:fill(c.titleAr),bodyAr:fill(c.bodyAr)}))};
}
export const signatureSchema=z.object({name:z.string().trim().min(2).max(200),consent:z.literal(true),
  strokes:z.array(z.array(z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])).min(2).max(400)).max(20)
    .refine(lines=>lines.reduce((n,line)=>n+line.length,0)<=1500,'Signature is too detailed; clear it and try again')}).strict();
export type ContractSignature=z.infer<typeof signatureSchema> & {statement:string;statementAr?:string;contentHash:string;userId:number;recordedAt:string};
export type ContractClause=z.infer<typeof clauseSchema> & {id:number;category:string;active:boolean;version:number};
export type ContractRecord={id:number;reference:string;employee_id:number;employee_name:string;status:typeof contractStatuses[number];version:number;
  document:ContractDocument;content_hash:string|null;signature:ContractSignature|null;signed_at:string|null;sent_at:string|null;source_id:number|null;
  template_id?:number|null;template_version?:number|null;response_note:string|null;created_at:string;canManage:boolean;canSign:boolean;history:{action:string;actor_name:string;created_at:string;note:string}[]};
