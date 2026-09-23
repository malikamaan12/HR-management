import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Plus,Trash2,Landmark} from 'lucide-react';
import {Link} from 'wouter';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Field,Section,QueryError,fieldClass} from '@/components/hr/Operations';
import {useToast} from '@/hooks/use-toast';
import {wpsSettingsSchema,settingsIssues,type WpsSettingsResponse,type WpsSettings as Settings} from '@shared/payroll-exports';

export default function WpsSettings(){
  const query=useQuery<WpsSettingsResponse>({queryKey:['/api/payroll/exports/settings']});
  return <div className="space-y-4"><QueryError error={query.error}/>{query.isLoading&&<p role="status">Loading WPS settings…</p>}{query.data&&<SettingsForm key={query.data.version} current={query.data}/>}</div>;
}
function SettingsForm({current}:{current:WpsSettingsResponse}){
  const [draft,setDraft]=useState(()=>structuredClone(current.settings)),[reason,setReason]=useState(''),[error,setError]=useState('');
  const cache=useQueryClient(),{toast}=useToast();
  const save=useMutation({mutationFn:()=>{const parsed=wpsSettingsSchema.parse(draft);return apiJson('/api/payroll/exports/settings',{method:'PUT',body:{version:current.version,settings:parsed,reason}});},onSuccess:()=>{cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/payroll/exports')});toast({title:'WPS settings saved'});}});
  function update<K extends keyof Settings>(key:K,value:Settings[K]){setDraft({...draft,[key]:value});}
  const issues=settingsIssues(draft);
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();setError('');const result=wpsSettingsSchema.safeParse(draft);if(!result.success){setError(result.error.issues.map(i=>i.message).join('; '));return;}save.mutate();}}><fieldset disabled={save.isPending} className="space-y-5">
    <Section title="Qatar WPS · Salary Information File v1"><div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Set the employer and paying account once. Exports use approved QAR payroll and the employees you select.</p><Button asChild variant="outline" type="button"><Link href="/payroll?tab=exports"><Landmark className="mr-2 h-4 w-4"/>Open payroll exports</Link></Button></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Employer establishment ID"><input className={fieldClass} inputMode="numeric" maxLength={8} value={draft.employerEid} onChange={e=>update('employerEid',e.target.value)}/></Field><Field label="Payer bank short code"><input className={fieldClass} placeholder="Bank's WPS short code" maxLength={4} value={draft.payerBank} onChange={e=>update('payerBank',e.target.value.toUpperCase())}/></Field><Field label="Payer establishment ID (company payer)"><input className={fieldClass} inputMode="numeric" maxLength={8} value={draft.payerEid} onChange={e=>setDraft({...draft,payerEid:e.target.value,payerQid:e.target.value?'':draft.payerQid})}/></Field><Field label="Payer QID (individual payer)"><input className={fieldClass} inputMode="numeric" maxLength={11} value={draft.payerQid} onChange={e=>setDraft({...draft,payerQid:e.target.value,payerEid:e.target.value?'':draft.payerEid})}/></Field><div className="sm:col-span-2"><Field label="Payer Qatar IBAN"><input className={fieldClass} autoComplete="off" value={draft.payerIban} maxLength={40} placeholder="QA…" onChange={e=>update('payerIban',e.target.value.replace(/\s/g,'').toUpperCase())}/></Field></div></div>
      {issues.length>0&&<div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-medium">Complete before exporting</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
      <p className="text-xs text-muted-foreground">The employer ID and payer account must match your bank's WPS registration. No bank connection or payment is initiated here.</p>
    </Section>
    <Section title="Employee bank names → WPS bank codes"><p className="text-sm text-muted-foreground">Match the bank names already stored on employee profiles. Each employee can also have explicit WPS details in Payroll exports.</p>
      {draft.bankMappings.map((mapping,index)=><div key={index} className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field label={`Bank name ${index+1}`}><input className={fieldClass} required maxLength={150} value={mapping.name} onChange={e=>update('bankMappings',draft.bankMappings.map((m,i)=>i===index?{...m,name:e.target.value}:m))}/></Field></div><Field label={`WPS code ${index+1}`}><input className={fieldClass+' max-w-32'} required maxLength={4} value={mapping.code} onChange={e=>update('bankMappings',draft.bankMappings.map((m,i)=>i===index?{...m,code:e.target.value.toUpperCase()}:m))}/></Field><Button type="button" variant="outline" size="icon" aria-label={`Remove bank mapping ${index+1}`} onClick={()=>update('bankMappings',draft.bankMappings.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4"/></Button></div>)}
      <Button type="button" variant="outline" disabled={draft.bankMappings.length>=100} onClick={()=>update('bankMappings',[...draft.bankMappings,{name:'',code:''}])}><Plus className="mr-2 h-4 w-4"/>Add bank mapping</Button>
    </Section>
    <Section title="Optional allowance breakdown"><p className="text-sm text-muted-foreground">Enter exact payroll allowance labels, one per line. Unmapped categories stay blank in the SIF. These fields describe the saved extra income; they do not add money to net pay.</p><div className="grid gap-4 sm:grid-cols-2">{([['housingLabels','Housing'],['foodLabels','Food'],['transportLabels','Transportation'],['overtimeLabels','Overtime']] as const).map(([key,label])=><Field label={label+' allowance labels'} key={key}><textarea className={fieldClass} rows={3} value={draft[key].join('\n')} onChange={e=>update(key,e.target.value.split('\n'))}/></Field>)}</div></Section>
    <Field label="Reason for this change"><textarea className={fieldClass} required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></Field><QueryError error={save.error}/>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={reason.trim().length<5||save.isPending}>{save.isPending?'Saving…':'Save WPS settings'}</Button>
  </fieldset></form>;
}
