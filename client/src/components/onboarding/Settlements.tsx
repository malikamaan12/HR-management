import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';
type Line={label:string;kind:'earning'|'deduction';amount:string;basis:string};
type Row={id:number;employee_name:string;exit_date:string;version:number;status:string;net_amount:string;lines:Line[];payment_reference:string|null;capabilities:{edit:boolean;submit:boolean;review:boolean;pay:boolean}};
function useSave(){const cache=useQueryClient(),{toast}=useToast();return useMutation({mutationFn:({path,body}:{path:string;body:unknown})=>apiJson(path,{method:'POST',body}),onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/settlements')});toast({title:'Settlement saved'});},onError:error=>toast({title:'Unable to save settlement',description:error.message,variant:'destructive'})});}
function Lines({items,onChange}:{items:Line[];onChange:(rows:Line[])=>void}){
 const [label,setLabel]=useState(''),[kind,setKind]=useState<'earning'|'deduction'>('earning'),[amount,setAmount]=useState(''),[basis,setBasis]=useState('');
 return <div className="space-y-2"><ul>{items.map((l,i)=><li key={i} className="rounded border p-2">{l.label} · {l.kind} · QAR {l.amount}<p className="text-sm">Basis: {l.basis}</p><Button type="button" variant="ghost" onClick={()=>onChange(items.filter((_,n)=>i!==n))}>Remove draft line</Button></li>)}</ul>
  <div className="grid gap-2 md:grid-cols-3"><label>Item<Input value={label} onChange={e=>setLabel(e.target.value)} maxLength={120}/></label><label>Type<select className="block rounded border bg-background p-2" value={kind} onChange={e=>setKind(e.target.value as Line['kind'])}><option value="earning">Earning</option><option value="deduction">Deduction</option></select></label><label>Amount (QAR)<Input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></div>
  <label className="grid gap-1">Calculation basis / supporting record<Input value={basis} onChange={e=>setBasis(e.target.value)} maxLength={1000}/></label><Button type="button" variant="outline" disabled={label.trim().length<2||basis.trim().length<5||!amount||items.length>=100} onClick={()=>{onChange([...items,{label,kind,amount,basis}]);setLabel('');setAmount('');setBasis('');}}>Add line</Button>
 </div>;
}
export function Settlements(){
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[employeeId,setEmployeeId]=useState(''),[exitDate,setExitDate]=useState(''),[reason,setReason]=useState(''),[items,setItems]=useState<Line[]>([]);
 const query=useQuery<{canCreate:boolean;items:Row[]}>({queryKey:['/api/settlements',{page}]});
 const people=useQuery<{employees:{id:number;firstName:string;lastName:string}[]}>({queryKey:['/api/employees/directory',{q:search.trim(),limit:30}],enabled:search.trim().length>=2});const save=useSave();
 return <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Final settlements</summary><p className="my-3 text-sm">Record verified earnings and deductions with their calculation basis. Gratuity, leave payout and other entitlements require approved amounts; no entitlement formula runs automatically. These records are separate from monthly payroll and record external payments.</p>
  {query.error?<p role="alert">Detailed payroll access is required, or settlements are unavailable.</p>:<>
   {query.data?.canCreate&&<form className="space-y-3 rounded border p-3" onSubmit={async e=>{e.preventDefault();try{await save.mutateAsync({path:'/api/settlements',body:{employeeId:Number(employeeId),exitDate,lines:items,reason}});setItems([]);setReason('');}catch{}}}>
    <label className="grid gap-1">Search employee<Input value={search} onChange={e=>{setSearch(e.target.value);setEmployeeId('');}}/></label>
    {people.error&&<p role="alert">Unable to search employees.</p>}
    <label className="grid gap-1">Employee<select className="rounded border bg-background p-2" value={employeeId} onChange={e=>setEmployeeId(e.target.value)} required><option value="">Select employee</option>{people.data?.employees.map(p=><option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
    <label className="grid gap-1">Exit date<Input type="date" value={exitDate} onChange={e=>setExitDate(e.target.value)} required/></label><Lines items={items} onChange={setItems}/>
    <label className="grid gap-1">Preparation reason<Input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={save.isPending||!items.length} type="submit">Create settlement draft</Button>
   </form>}
   <div className="my-3 space-y-3">{query.data?.items.map(row=><SettlementCard key={`${row.id}-${row.version}`} row={row}/>)}</div>
   <div className="flex gap-2"><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page}</span><Button disabled={(query.data?.items.length||0)<25} onClick={()=>setPage(page+1)}>Next</Button></div>
  </>}
 </details>;
}
function SettlementCard({row}:{row:Row}){
 const [items,setItems]=useState(row.lines),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[showHistory,setShowHistory]=useState(false);const save=useSave();
 const history=useQuery<{version:number;reason:string;snapshot:Row;created_at:string}[]>({queryKey:[`/api/settlements/${row.id}/history`],enabled:showHistory});
 const action=(action:string,extra={})=>save.mutate({path:`/api/settlements/${row.id}/actions`,body:{action,version:row.version,reason,...extra}});
 return <details className="rounded border p-3"><summary>#{row.id} · {row.employee_name} · {row.exit_date} · {row.status} · QAR {row.net_amount}</summary><div className="mt-3 space-y-3">
  {row.capabilities.edit?<Lines items={items} onChange={setItems}/>:<ul>{row.lines.map((l,i)=><li key={i}>{l.label} · {l.kind} · QAR {l.amount} · {l.basis}</li>)}</ul>}
  {row.payment_reference&&<p>Payment reference: {row.payment_reference}</p>}
  {row.status!=='paid'&&<label className="grid gap-1">Action reason<Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label>}
  {row.capabilities.pay&&<label className="grid gap-1">External payment reference<Input value={reference} onChange={e=>setReference(e.target.value)} maxLength={150}/></label>}
  <div className="flex flex-wrap gap-2">{row.capabilities.edit&&<Button disabled={save.isPending||reason.trim().length<5} onClick={()=>action('edit',{lines:items})}>Save draft changes</Button>}{row.capabilities.submit&&<Button disabled={save.isPending||reason.trim().length<5||JSON.stringify(items)!==JSON.stringify(row.lines)} onClick={()=>action('submit')}>Submit saved draft</Button>}{row.capabilities.review&&<><Button disabled={save.isPending||reason.trim().length<5} onClick={()=>action('approve')}>Approve settlement</Button><Button variant="outline" disabled={save.isPending||reason.trim().length<5} onClick={()=>action('return')}>Return for correction</Button></>}{row.capabilities.pay&&<Button disabled={save.isPending||reason.trim().length<5||reference.trim().length<3} onClick={()=>action('pay',{reference})}>Record completed payment</Button>}</div>
  <Button variant="outline" onClick={()=>setShowHistory(!showHistory)}>Revision history</Button>{showHistory&&(history.error?<p role="alert">Unable to load history.</p>:<ul>{history.data?.map(h=><li key={h.version}>v{h.version} · {h.snapshot.status} · QAR {h.snapshot.net_amount} · {h.reason}</li>)}</ul>)}
 </div></details>;
}
