import {ArrowDown,ArrowUp,Plus,Trash2,Languages} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Field,fieldClass} from '@/components/hr/Operations';
import {bilingualIssues,fillContractClause,type ContractContent,type ContractDocument,type ContractClause} from '@shared/contracts';

const fields=[
  {key:'title',en:'Contract title',ar:'عنوان العقد',max:200},
  {key:'position',en:'Position',ar:'المسمى الوظيفي',max:200},
  {key:'department',en:'Department',ar:'القسم',max:200},
  {key:'location',en:'Work location',ar:'مكان العمل',max:300},
  {key:'schedule',en:'Working arrangements',ar:'ترتيبات العمل',max:3000,rows:4},
  {key:'compensation',en:'Compensation and allowances',ar:'الأجر والبدلات',max:6000,rows:4},
] as const;
export function LanguageField({label,value,onChange,arabic=false,max=6000,rows=0}:{label:string;value:string;onChange:(value:string)=>void;arabic?:boolean;max?:number;rows?:number}){
  const props={className:fieldClass+(arabic?' text-right [font-family:Tahoma,Arial,sans-serif]':''),lang:arabic?'ar':'en',dir:arabic?'rtl' as const:'ltr' as const,value,maxLength:max,onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(e.target.value)};
  return <Field label={label}>{rows?<textarea {...props} rows={rows}/>:<input {...props}/>}</Field>;
}
export function ContentFields({value,onChange}:{value:ContractContent;onChange:(value:ContractContent)=>void}){
  return <div className="space-y-5">
    <div className="flex items-center gap-2 text-sm text-primary"><Languages className="h-4 w-4"/>English + العربية</div>
    {fields.map(f=><div key={f.key} className="grid gap-4 lg:grid-cols-2">
      <LanguageField label={f.en+' · English'} value={value[f.key]} max={f.max} rows={'rows' in f?f.rows:0} onChange={text=>onChange({...value,[f.key]:text})}/>
      <LanguageField label={f.ar+' · Arabic'} value={value.arabic[f.key]} arabic max={f.max} rows={'rows' in f?f.rows:0} onChange={text=>onChange({...value,arabic:{...value.arabic,[f.key]:text}})}/>
    </div>)}
    <div className="grid gap-4 lg:grid-cols-2">
      <LanguageField label="اسم الشركة · Arabic company name" value={value.companyNameAr} arabic max={200} onChange={text=>onChange({...value,companyNameAr:text})}/>
      <LanguageField label="عنوان الشركة · Arabic company address" value={value.companyAddressAr} arabic max={1000} rows={2} onChange={text=>onChange({...value,companyAddressAr:text})}/>
    </div>
  </div>;
}
export function ClauseEditor({clauses,onChange,library=[],values={}}:{clauses:ContractContent['clauses'];onChange:(clauses:ContractContent['clauses'])=>void;library?:ContractClause[];values?:Record<string,string>}){
  const change=(index:number,key:keyof ContractContent['clauses'][number],text:string)=>onChange(clauses.map((c,i)=>i===index?{...c,[key]:text}:c));
  const move=(index:number,delta:number)=>{const copy=[...clauses];[copy[index],copy[index+delta]]=[copy[index+delta],copy[index]];onChange(copy);};
  const add=(id:string)=>{const c=library.find(item=>item.id===Number(id));if(c)onChange([...clauses,{title:c.title,body:fillContractClause(c.body,values),titleAr:c.titleAr||'',bodyAr:fillContractClause(c.bodyAr||'',values)}]);};
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3"><select aria-label="Add a library clause" className={fieldClass+' sm:max-w-sm'} value="" disabled={clauses.length>=30} onChange={e=>add(e.target.value)}><option value="">Add from clause library…</option>{library.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.category} · {c.title}</option>)}</select><Button type="button" variant="outline" disabled={clauses.length>=30} onClick={()=>onChange([...clauses,{title:'',body:'',titleAr:'',bodyAr:''}])}><Plus className="mr-2 h-4 w-4"/>Custom term</Button></div>
    {!clauses.length&&<p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Add a clause or write a custom English–Arabic term.</p>}
    {clauses.map((c,i)=><section key={i} className="space-y-4 rounded-2xl border bg-background/50 p-4 sm:p-5">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Term {i+1} · البند {i+1}</h3><div className="flex gap-1">
        <Button type="button" size="icon" variant="ghost" aria-label={`Move term ${i+1} up`} disabled={!i} onClick={()=>move(i,-1)}><ArrowUp className="h-4 w-4"/></Button>
        <Button type="button" size="icon" variant="ghost" aria-label={`Move term ${i+1} down`} disabled={i===clauses.length-1} onClick={()=>move(i,1)}><ArrowDown className="h-4 w-4"/></Button>
        <Button type="button" size="icon" variant="ghost" aria-label={`Remove term ${i+1}`} onClick={()=>onChange(clauses.filter((_,at)=>at!==i))}><Trash2 className="h-4 w-4"/></Button>
      </div></div>
      <div className="grid gap-5 lg:grid-cols-2"><div className="space-y-3"><LanguageField label={`Term ${i+1} title · English`} value={c.title} max={160} onChange={v=>change(i,'title',v)}/><LanguageField label={`Term ${i+1} text · English`} value={c.body} rows={6} onChange={v=>change(i,'body',v)}/></div>
        <div className="space-y-3"><LanguageField label={`عنوان البند ${i+1} · Arabic`} value={c.titleAr||''} max={160} arabic onChange={v=>change(i,'titleAr',v)}/><LanguageField label={`نص البند ${i+1} · Arabic`} value={c.bodyAr||''} rows={6} arabic onChange={v=>change(i,'bodyAr',v)}/></div>
      </div>
    </section>)}
  </div>;
}
export function Readiness({document}:{document:ContractDocument}){
  const missing=bilingualIssues(document);
  return missing.length?<details className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><summary className="cursor-pointer font-medium">{missing.length} items to complete before sending</summary><ul className="mt-3 grid list-inside list-disc gap-1 sm:grid-cols-2">{missing.map(item=><li key={item}>{item}</li>)}</ul></details>:<p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">Both languages are filled. Review the wording before sending.</p>;
}
export function DocumentPreview({document:d,template=false}:{document:ContractDocument;template?:boolean}){
  const bilingual=d.languageMode==='en-ar',a=d.arabic;
  const pair=(title:string,body:string,titleAr:string,bodyAr:string|undefined,key:string)=><section key={key} className={'grid gap-5 border-b pb-5 last:border-0 '+(bilingual?'lg:grid-cols-2':'')}>
    <div lang="en" dir="ltr"><h3 className="font-semibold">{title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{body||'To be completed'}</p></div>
    {bilingual&&<div lang="ar" dir="rtl" className="border-t pt-4 text-right [font-family:Tahoma,Arial,sans-serif] lg:border-t-0 lg:pt-0"><h3 className="font-semibold">{titleAr}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-8 text-muted-foreground">{bodyAr||'يُستكمل قبل الإرسال'}</p></div>}
  </section>;
  return <article className="space-y-5 rounded-2xl border bg-card p-5 sm:p-8">
    <header className={'grid gap-5 border-b border-primary/30 pb-5 '+(bilingual?'lg:grid-cols-2':'')}><div lang="en"><p className="text-sm font-semibold text-primary">{d.companyName}</p><h2 className="mt-2 text-2xl font-semibold">{d.title}</h2><p className="mt-2 text-sm text-muted-foreground">{d.companyAddress}</p></div>{bilingual&&<div lang="ar" dir="rtl" className="text-right [font-family:Tahoma,Arial,sans-serif]"><p className="text-sm font-semibold text-primary">{d.companyNameAr||'اسم الشركة'}</p><h2 className="mt-2 text-2xl font-semibold">{a?.title||'عنوان العقد'}</h2><p className="mt-2 text-sm text-muted-foreground">{d.companyAddressAr}</p></div>}</header>
    {template?<p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">Template preview · Employee details and dates are added when creating a contract.</p>:pair('Employee',d.employeeName+' · '+d.employeeReference,'الموظف',d.employeeNameAr,'employee')}
    {pair('Appointment',[d.position,d.department,d.location,...(template?[]:[`Start: ${d.startDate||'To be completed'}`,d.endDate?'End: '+d.endDate:'No end date specified'])].filter(Boolean).join('\n'),'بيانات التعيين',[a?.position,a?.department,a?.location,...(template?[]:[`تاريخ البدء: ${d.startDate?'\u2066'+d.startDate+'\u2069':'يُستكمل قبل الإرسال'}`,d.endDate?'تاريخ الانتهاء: \u2066'+d.endDate+'\u2069':'لم يُحدَّد تاريخ انتهاء'])].filter(Boolean).join('\n'),'appointment')}
    {pair('Working arrangements',d.schedule,'ترتيبات العمل',a?.schedule,'schedule')}
    {pair('Compensation and allowances',d.compensation,'الأجر والبدلات',a?.compensation,'compensation')}
    {d.clauses.map((c,i)=>pair(`${i+1}. ${c.title}`,c.body,`${i+1}. ${c.titleAr||'عنوان البند'}`,c.bodyAr,'clause-'+i))}
  </article>;
}
