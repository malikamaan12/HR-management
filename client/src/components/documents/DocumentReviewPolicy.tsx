import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';
export type ReviewPolicy={version:number;replacementMode:'optional'|'self_service'|'all';documentTypes:string[];requireAssignedReviewer:boolean;reviewDays:number;canEdit?:boolean};
const modes={optional:'Optional approval',self_service:'Approval for employee self-service replacements',all:'Approval for all replacements, including administrators'};
export function DocumentReviewPolicy(){
 const q=useQuery<ReviewPolicy>({queryKey:['/api/documents/review-policy']});
 return <section className="border rounded-lg p-4 space-y-3"><h2 className="text-lg font-semibold">Document approval rules</h2>
 <p className="text-sm text-muted-foreground">These rules cover replacements of existing documents. Initial uploads use the existing upload permissions. Submitted requests keep their original assignment requirement and due date.</p>
 {q.isLoading?<p>Loading rules…</p>:q.isError?<p role="alert">Unable to load rules. <Button onClick={()=>q.refetch()}>Retry</Button></p>:q.data&&<><p>{modes[q.data.replacementMode]} · Policy version {q.data.version}</p><p>Types: {q.data.documentTypes.join(', ')||'All document types'} · Review due in {q.data.reviewDays} calendar days · {q.data.requireAssignedReviewer?'Named reviewer required':'Any eligible independent reviewer when unassigned'}</p>
 {q.data.canEdit&&<><PolicyEditor key={q.data.version} policy={q.data}/><DocumentAudit url="/api/documents/review-policy/history" label="Policy history" version={q.data.version} policy/></>}</>}
 </section>;
}
function PolicyEditor({policy}:{policy:ReviewPolicy}){
 const [mode,setMode]=useState(policy.replacementMode),[types,setTypes]=useState(policy.documentTypes.join(', ')),[assigned,setAssigned]=useState(policy.requireAssignedReviewer),[days,setDays]=useState(String(policy.reviewDays)),[reason,setReason]=useState('');const cache=useQueryClient(),{toast}=useToast();
 const save=useMutation({mutationFn:()=>apiJson('/api/documents/review-policy',{method:'POST',body:{version:policy.version,replacementMode:mode,documentTypes:types.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean),requireAssignedReviewer:assigned,reviewDays:Number(days),reason}}),onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/documents')});toast({title:'Document rules saved'});},onError:e=>toast({title:'Unable to save rules',description:e.message,variant:'destructive'})});
 return <form className="space-y-3 border-t pt-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="space-y-3"><label className="block">Replacement approval<select className="block w-full border rounded p-2" value={mode} onChange={e=>setMode(e.target.value as ReviewPolicy['replacementMode'])}>{Object.entries(modes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label className="block">Types requiring approval (comma separated; blank means all)<Input value={types} onChange={e=>setTypes(e.target.value)} placeholder="Passport, Qatar ID"/></label>
 <label className="flex gap-2 items-center"><input type="checkbox" checked={assigned} onChange={e=>setAssigned(e.target.checked)}/>Require a named reviewer for every new renewal request</label>
 <label className="block">Review target in calendar days<Input type="number" min={1} max={365} required value={days} onChange={e=>setDays(e.target.value)}/></label><label className="block">Reason for change<Input minLength={5} maxLength={1000} required value={reason} onChange={e=>setReason(e.target.value)}/></label><Button type="submit" disabled={reason.trim().length<5||save.isPending}>Save approval rules</Button></fieldset></form>;
}
export function DocumentAudit({url,label,version,policy=false}:{url:string;label:string;version:number;policy?:boolean}){
 const [open,setOpen]=useState(false),[offset,setOffset]=useState(0);
 const q=useQuery<{items:{version:number;actor_id:number;reason:string;created_at:string;snapshot:any}[];hasMore:boolean}>({queryKey:[url,{version,offset}],queryFn:()=>apiJson(url+'?'+(policy?'page='+(offset/20+1):'offset='+offset)),enabled:open});
 return <details onToggle={e=>setOpen(e.currentTarget.open)} className="border rounded p-3"><summary className="cursor-pointer">{label}</summary>{open&&<div className="space-y-2 pt-2">{q.isLoading?<p>Loading history…</p>:q.isError?<p role="alert">History unavailable. <Button onClick={()=>q.refetch()}>Retry</Button></p>:<>{!q.data?.items.length&&<p>No recorded history for this page. Older requests may predate history tracking.</p>}{q.data?.items.map(r=><div className="border-b pb-2 text-sm" key={r.version}><p>Version {r.version} · Account #{r.actor_id} · {new Date(r.created_at).toLocaleString()}</p><p>{policy?(modes[r.snapshot.replacement_mode as ReviewPolicy['replacementMode']]+' · '+r.snapshot.review_days+' days · '+(r.snapshot.require_assigned_reviewer?'Named reviewer required':'Assignment optional')+' · Types: '+(r.snapshot.document_types.join(', ')||'All')):(r.snapshot.action+' · '+r.snapshot.status+' · Reviewer '+(r.snapshot.assignedReviewerId?'#'+r.snapshot.assignedReviewerId:'unassigned'))}</p><p>{r.reason}</p></div>)}<div className="flex gap-2"><Button type="button" variant="outline" disabled={!offset} onClick={()=>setOffset(n=>n-20)}>Newer history</Button><Button type="button" variant="outline" disabled={!q.data?.hasMore} onClick={()=>setOffset(n=>n+20)}>Older history</Button></div></>}</div>}</details>;
}
