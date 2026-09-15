import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {caseCategories,categoryLabels} from '@shared/helpdesk';
type Category=typeof caseCategories[number];
type Policy={category:Category;confidential:boolean;version:number;assigneeId:number|null;name:string|null};
export function HelpdeskRouting(){
 const [category,setCategory]=useState<Category>('payroll'),[confidential,setConfidential]=useState(false);
 const query=useQuery<{canConfigureConfidential:boolean;items:Policy[]}>({queryKey:['/api/helpdesk/routing']});
 const privateRoute=confidential||category==='employee_relations';
 const current=query.data?.items.find(r=>r.category===category&&r.confidential===privateRoute);
 return <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Category routing</summary>
  <p className="my-3 text-sm text-muted-foreground">Assign new requests automatically. Existing cases keep their handler. Inactive, ineligible or self-assigned handlers fall back to unassigned triage. Confidential requests use a separate policy and only route to HR Directors or Super Admins.</p>
  {query.error?<p role="alert">Unable to load routing policies.</p>:query.data?<div className="space-y-3">
   <label className="grid gap-1">Routing category<select className="rounded border bg-background p-2" value={category} onChange={e=>setCategory(e.target.value as Category)}>{caseCategories.filter(c=>c!=='employee_relations'||query.data.canConfigureConfidential).map(c=><option key={c} value={c}>{categoryLabels[c]}</option>)}</select></label>
   {query.data.canConfigureConfidential&&category!=='employee_relations'&&<label className="flex gap-2"><input type="checkbox" checked={confidential} onChange={e=>setConfidential(e.target.checked)}/>Confidential requests</label>}
   <RoutingEditor key={`${category}-${privateRoute}-${current?.version||0}`} row={current||{category,confidential:privateRoute,version:0,assigneeId:null,name:null}}/>
  </div>:<p>Loading routing policies…</p>}
 </details>;
}
function RoutingEditor({row}:{row:Policy}){
 const [search,setSearch]=useState(''),[assignee,setAssignee]=useState(row.assigneeId),[reason,setReason]=useState(''),[history,setHistory]=useState(false);
 const cache=useQueryClient(),{toast}=useToast();
 const candidates=useQuery<{id:number;name:string}[]>({queryKey:['/api/helpdesk/routing/responders',{q:search.trim(),confidential:String(row.confidential)}],enabled:search.trim().length>=2});
 const versions=useQuery<(Policy&{reason:string;createdAt:string})[]>({queryKey:['/api/helpdesk/routing/history',{category:row.category,confidential:String(row.confidential)}],enabled:history});
 const save=useMutation({mutationFn:()=>apiJson('/api/helpdesk/routing',{method:'POST',body:{category:row.category,confidential:row.confidential,assigneeId:assignee,expectedVersion:row.version,reason}}),onSuccess:async()=>{await cache.invalidateQueries({queryKey:['/api/helpdesk/routing']});toast({title:'Routing saved for new requests'});},onError:error=>toast({title:'Unable to save routing',description:error.message,variant:'destructive'})});
 return <div className="space-y-3"><p className="text-sm">Current version: {row.version} · Handler: {row.name||'Unassigned triage'}</p>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="space-y-3">
   <label className="grid gap-1">Search eligible handler<Input value={search} onChange={e=>setSearch(e.target.value)} maxLength={80} placeholder="Enter at least two characters"/></label>
   {candidates.error&&<p role="alert">Unable to search handlers.</p>}
   <label className="grid gap-1">Default handler<select className="rounded border bg-background p-2" value={assignee??''} onChange={e=>setAssignee(e.target.value?Number(e.target.value):null)}><option value="">Unassigned triage (disable automatic assignment)</option>{assignee&&!candidates.data?.some(c=>c.id===assignee)&&<option value={assignee}>{assignee===row.assigneeId?row.name||`Handler #${assignee}`:`Selected handler #${assignee}`}</option>}{candidates.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="grid gap-1">Routing change reason<Input required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button type="submit">Save routing</Button>
  </fieldset></form>
  <Button variant="outline" onClick={()=>setHistory(!history)}>{history?'Hide':'Show'} routing history</Button>
  {history&&(versions.error?<p role="alert">Unable to load history.</p>:<ul className="space-y-2 text-sm">{versions.data?.map(v=><li key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString()} · {v.assigneeId?`Handler #${v.assigneeId}`:'Unassigned'} · {v.reason}</li>)}</ul>)}
 </div>;
}
