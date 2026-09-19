import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ArrowUp, ArrowDown, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Section, QueryError, fieldClass, useAction } from './Operations';
import type { HelpdeskConfig } from '@shared/helpdesk';
import { workspaceSaveInput } from '@shared/helpdesk-workspace';

export function HelpdeskSettings({config}:{config:HelpdeskConfig}) {
  const [draft,setDraft]=useState(()=>structuredClone(config.workspace));
  const [version,setVersion]=useState(config.version);
  const [existingIds,setExistingIds]=useState(()=>config.workspace.categories.map(c=>c.id));
  const cache=useQueryClient();
  const [reason,setReason]=useState(''),[error,setError]=useState(''),[page,setPage]=useState(1);
  const mutation=useAction(()=>{setReason('');setVersion(v=>v+1);setExistingIds(draft.categories.map(c=>c.id));});
  const history=useQuery<{version:number;reason:string;created_at:string}[]>({queryKey:['/api/helpdesk/workspace/history',{page}]});
  const savedIds=new Set(existingIds);
  async function reload(){try{const latest=await cache.fetchQuery<HelpdeskConfig>({queryKey:['/api/helpdesk/config'],staleTime:0});setDraft(structuredClone(latest.workspace));setVersion(latest.version);setExistingIds(latest.workspace.categories.map(c=>c.id));setError('');setReason('');}catch(e){setError(e instanceof Error?e.message:'Unable to reload settings');}}
  function category(index:number, patch:Partial<typeof draft.categories[number]>) {
    setDraft(d=>({...d,categories:d.categories.map((c,i)=>i===index?{...c,...patch}:c)}));
  }
  function move(index:number,offset:number) {
    setDraft(d=>{const categories=[...d.categories];[categories[index],categories[index+offset]]=[categories[index+offset],categories[index]];return {...d,categories};});
  }
  return <Section title="Helpdesk content & categories">
    <p className="text-sm text-muted-foreground">Manage the text employees see, the services they can request, and attachment limits. Changes apply after saving. Disable unused categories to keep their history.</p>
    <form className="space-y-6" onSubmit={e=>{e.preventDefault();const result=workspaceSaveInput.safeParse({version,workspace:draft,reason});if(!result.success){setError(result.error.issues.map(i=>i.message).join('; '));return;}setError('');mutation.mutate({url:'/api/helpdesk/workspace',body:result.data});}}>
      <fieldset disabled={mutation.isPending} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Page title"><input className={fieldClass} value={draft.title} required minLength={2} maxLength={100} onChange={e=>setDraft({...draft,title:e.target.value})}/></Field>
          <Field label="Attachment limit (MB, maximum 10)"><input className={fieldClass} type="number" min={1} max={10} required value={draft.attachmentMegabytes} onChange={e=>setDraft({...draft,attachmentMegabytes:Number(e.target.value)})}/></Field>
          {(['introduction','requestGuidance','contactInstructions'] as const).map((key,i)=><Field key={key} label={['Page introduction','New request guidance','Contact / support instructions'][i]}><textarea className={fieldClass} rows={3} maxLength={key==='introduction'?1000:2000} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/></Field>)}
        </div>
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Service categories</h3><Button type="button" variant="outline" disabled={draft.categories.length>=100} onClick={()=>setDraft({...draft,categories:[...draft.categories,{id:'',label:'',description:'',enabled:true,confidential:false}]})}><Plus className="mr-2 h-4 w-4"/>Add category</Button></div>
        <div className="space-y-3">{draft.categories.map((c,i)=><div key={i} className="rounded-xl border p-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-2"><Field label="Category name"><input className={fieldClass} value={c.label} required minLength={2} maxLength={100} onChange={e=>category(i,{label:e.target.value})}/></Field><Field label="Permanent category key"><input className={fieldClass} value={c.id} disabled={savedIds.has(c.id)} required pattern="[a-z][a-z0-9_]*" maxLength={64} onChange={e=>{if(savedIds.has(e.target.value)){setError('This category key already exists. Choose another key.');return;}category(i,{id:e.target.value});}}/></Field></div>
          <Field label="Service description"><textarea className={fieldClass} rows={2} value={c.description} maxLength={500} onChange={e=>category(i,{description:e.target.value})}/></Field>
          <div className="flex flex-wrap items-center gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={c.enabled} onChange={e=>category(i,{enabled:e.target.checked})}/>Accept new requests</label><label className="flex items-center gap-2"><input type="checkbox" checked={c.confidential} disabled={config.workspace.categories.some(old=>old.id===c.id&&old.confidential)} onChange={e=>category(i,{confidential:e.target.checked})}/>Always confidential</label><div className="ml-auto flex gap-2"><Button size="icon" variant="outline" type="button" aria-label={`Move category ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp className="h-4 w-4"/></Button><Button size="icon" variant="outline" type="button" aria-label={`Move category ${i+1} down`} disabled={i===draft.categories.length-1} onClick={()=>move(i,1)}><ArrowDown className="h-4 w-4"/></Button>{!savedIds.has(c.id)&&<Button variant="outline" type="button" onClick={()=>setDraft({...draft,categories:draft.categories.filter((_,index)=>index!==i)})}>Remove</Button>}</div></div>
        </div>)}</div>
        <p className="text-xs text-muted-foreground">Confidential categories cannot be downgraded. Existing cases keep their visibility, routing and deadlines. Response targets are managed in Routing & response rules.</p>
        <Field label="Reason for these changes"><textarea className={fieldClass} value={reason} required minLength={5} maxLength={1000} onChange={e=>setReason(e.target.value)}/></Field>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<QueryError error={mutation.error}/>
        <div className="flex flex-wrap gap-3"><Button type="submit"><Settings2 className="mr-2 h-4 w-4"/>{mutation.isPending?'Saving…':'Save helpdesk settings'}</Button><Button type="button" variant="outline" onClick={reload}>Reload saved settings</Button><span className="self-center text-xs text-muted-foreground">Editing version {version}</span></div>
      </fieldset>
    </form>
    <details><summary className="cursor-pointer text-sm font-medium">Settings history</summary><QueryError error={history.error}/>{history.isLoading?<p className="py-3 text-sm">Loading history…</p>:<div className="divide-y">{history.data?.map(h=><div key={h.version} className="py-3 text-sm"><p className="font-medium">Version {h.version} · {new Date(h.created_at).toLocaleString()}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{h.reason}</p></div>)}{!history.error&&!history.data?.length&&<p className="py-3 text-sm text-muted-foreground">No saved revisions on this page.</p>}</div>}<div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><Button variant="outline" disabled={!history.data||history.data.length<25} onClick={()=>setPage(page+1)}>Next</Button></div></details>
  </Section>;
}
