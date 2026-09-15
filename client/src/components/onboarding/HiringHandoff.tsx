import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Link} from 'wouter';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';
export function HiringHandoff({offerId}:{offerId:number}){
 const [open,setOpen]=useState(false);
 return <div><Button variant="outline" size="sm" onClick={()=>setOpen(!open)}>Hiring handoff</Button>{open&&<HandoffForm offerId={offerId}/>}</div>;
}
function HandoffForm({offerId}:{offerId:number}){
 const [search,setSearch]=useState(''),[employeeId,setEmployeeId]=useState<number|null>(null),[reason,setReason]=useState('');
 const cache=useQueryClient(),{toast}=useToast();
 const context=useQuery<{offerUpdatedAt:string;applicationUpdatedAt:string;handoff:{employeeId:number}|null}>({queryKey:[`/api/job-offers/${offerId}/handoff`]});
 const directory=useQuery<{employees:{id:number;firstName:string;lastName:string;employeeId:string}[]}>({queryKey:['/api/employees/directory',{q:search.trim(),status:'active',limit:20}],enabled:search.trim().length>=2});
 const employee=useQuery<{recordVersion:number}>({queryKey:[`/api/employees/${employeeId}`],enabled:!!employeeId});
 const save=useMutation({mutationFn:()=>apiJson(`/api/job-offers/${offerId}/handoff`,{method:'POST',body:{employeeId,expectedEmployeeVersion:employee.data!.recordVersion,offerUpdatedAt:context.data!.offerUpdatedAt,applicationUpdatedAt:context.data!.applicationUpdatedAt,reason}}),onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/job-')});toast({title:'Accepted offer linked to employee'});},onError:error=>toast({title:'Unable to link employee',description:error.message,variant:'destructive'})});
 if(context.error)return <p role="alert">Unable to load hiring handoff.</p>;
 if(!context.data)return <p>Loading handoff…</p>;
 if(context.data.handoff)return <p className="mt-2 text-sm">Linked to employee #{context.data.handoff.employeeId}. <Link href="/onboarding" className="text-primary underline">Choose an onboarding checklist</Link></p>;
 return <form className="mt-3 min-w-72 space-y-2 rounded border p-3" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <p className="text-sm">Create and verify the employee record first. The candidate and employee QIDs must match. This links the accepted offer and marks its application hired.</p>
  <Link href="/employees" className="text-primary underline">Open employee records</Link>
  <label className="grid gap-1">Find employee<Input value={search} onChange={e=>{setSearch(e.target.value);setEmployeeId(null);}} placeholder="Name or employee ID"/></label>
  {directory.error&&<p role="alert">Unable to search employee records.</p>}
  <label className="grid gap-1">Verified employee<select className="rounded border bg-background p-2" value={employeeId??''} onChange={e=>setEmployeeId(e.target.value?Number(e.target.value):null)} required><option value="">Select employee</option>{directory.data?.employees.map(e=><option key={e.id} value={e.id}>{e.firstName} {e.lastName} · {e.employeeId}</option>)}</select></label>
  {employee.error&&<p role="alert">Unable to verify employee record.</p>}
  <label className="grid gap-1">Handoff reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
  <Button disabled={save.isPending||!employeeId||!employee.data||employee.isFetching} type="submit">Link accepted offer</Button>
 </form>;
}
