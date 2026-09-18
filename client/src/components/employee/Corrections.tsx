import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {correctionLabels} from '@shared/employee-corrections';
import {apiJson} from '@/lib/queryClient';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';
type Correction={id:number;status:string;patch:Record<string,string|null>;previous_values:Record<string,string|null>;reason:string;decision_reason:string|null;created_at:string};
export function CorrectionInbox({select}:{select:(id:number)=>void}){
 const [page,setPage]=useState(1);const query=useQuery<{id:number;employee_id:number;employee_name:string;created_at:string}[]>({queryKey:['/api/employees/corrections',{page}]});
 return <details className="mb-4 rounded border p-3"><summary className="cursor-pointer font-semibold">Pending employee corrections</summary>{query.error?<p role="alert">Unable to load HR correction queue.</p>:<><ul>{query.data?.map(r=><li key={r.id} className="flex items-center justify-between gap-3">{r.employee_name} · {new Date(r.created_at).toLocaleDateString()}<Button variant="outline" onClick={()=>select(r.employee_id)}>Review profile</Button></li>)}</ul>{query.data?.length===0&&<p>No pending requests.</p>}<div className="mt-2 flex gap-2"><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><Button disabled={(query.data?.length||0)<25} onClick={()=>setPage(page+1)}>Next</Button></div></>}</details>;
}
export function Corrections({employeeId,version}:{employeeId:number;version:number}){
 const [page,setPage]=useState(1),[field,setField]=useState<keyof typeof correctionLabels>('primaryMobile'),[value,setValue]=useState(''),[reason,setReason]=useState('');
 const key=`/api/employees/${employeeId}/corrections`,query=useQuery<{canRequest:boolean;canReview:boolean;items:Correction[]}>({queryKey:[key,{page}]});
 const cache=useQueryClient(),{toast}=useToast();
 const save=useMutation({mutationFn:({path,body}:{path:string;body:unknown})=>apiJson(path,{method:'POST',body}),onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/employees')});setReason('');setValue('');toast({title:'Correction saved'});},onError:error=>toast({title:'Unable to save correction',description:error.message,variant:'destructive'})});
 if(query.error)return <p className="text-sm">Correction requests are available to the employee and authorized HR reviewers.</p>;
 if(!query.data)return <p>Loading correction requests…</p>;
 return <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Employee correction requests</summary><p className="my-3 text-sm">Contact, address and emergency details require HR approval before the employee record changes.</p>
  {query.data.canRequest&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();save.mutate({path:key,body:{expectedVersion:version,patch:{[field]:field==='personalEmail'&&!value.trim()?null:value},reason}});}}>
   <label className="grid gap-1">Field to correct<select className="rounded border bg-background p-2" value={field} onChange={e=>{setField(e.target.value as keyof typeof correctionLabels);setValue('');}}>{Object.entries(correctionLabels).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
   <label className="grid gap-1">Proposed value<Input value={value} onChange={e=>setValue(e.target.value)} required={field!=='personalEmail'} maxLength={field==='residentialAddress'?2000:254}/></label>
   <label className="grid gap-1">Request reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={1000} required/></label><Button type="submit" disabled={save.isPending||query.data.items.some(r=>r.status==='pending')}>Request correction</Button>
  </form>}
  <div className="my-3 space-y-3">{query.data.items.map(row=><Review key={row.id+row.status} row={row} canRequest={query.data.canRequest} canReview={query.data.canReview} decide={(action,reason)=>save.mutate({path:`${key}/${row.id}/decision`,body:{action,reason}})} pending={save.isPending}/>)}</div>
  <div className="flex gap-2"><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page}</span><Button disabled={query.data.items.length<25} onClick={()=>setPage(page+1)}>Next</Button></div>
 </details>;
}
function Review({row,canRequest,canReview,decide,pending}:{row:Correction;canRequest:boolean;canReview:boolean;decide:(action:string,reason:string)=>void;pending:boolean}){
 const [reason,setReason]=useState('');
 return <div className="rounded border p-3 space-y-2"><p>#{row.id} · {row.status} · {new Date(row.created_at).toLocaleString()}</p><p>Request: {row.reason}</p><ul>{Object.entries(row.patch).map(([key,value])=><li key={key}>{correctionLabels[key as keyof typeof correctionLabels]}: {row.previous_values[key]||'Not set'} → {value||'Not set'}</li>)}</ul>
  {row.decision_reason&&<p>Decision: {row.decision_reason}</p>}
  {row.status==='pending'&&<><label className="grid gap-1">Decision or withdrawal reason<Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label><div className="flex gap-2">{(canReview?['approve','reject']:canRequest?['withdraw']:[]).map(action=><Button key={action} disabled={pending||reason.trim().length<5} onClick={()=>decide(action,reason)}>{action==='approve'?'Approve correction':action==='reject'?'Reject correction':'Withdraw request'}</Button>)}</div></>}
 </div>;
}
