import {LeaveRuns,LegacyLeave} from '@/components/operations/Leave';
import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {useAuth} from '@/contexts/AuthContext';
import {useToast} from '@/hooks/use-toast';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
type Account={leaveType:string;year:number;allocated:number;used:number;pending:number;available:number;managed:boolean;version:number;needsReconciliation:boolean};
type Ledger={accounts:Account[];entries:Array<{id:number;leaveType:string;days:number;reason:string;reference:string;createdAt:string}>;canAllocate:boolean};
export function LeaveLedger({employeeId}:{employeeId?:number}){
 const {user}=useAuth(),admin=['admin','super_admin'].includes(user?.role||'');
 const [chosen,setChosen]=useState<number>(),[search,setSearch]=useState(''),[year,setYear]=useState(new Date().getFullYear());
 const selected=chosen??employeeId;
 const directory=useQuery<{employees:Array<{id:number;firstName:string;lastName:string;employeeId:string}>}>({queryKey:[`/api/employees/directory?q=${encodeURIComponent(search)}&limit=20`],enabled:admin&&search.trim().length>=2});
 const ledger=useQuery<Ledger>({queryKey:['/api/leaves/balances',selected,year],enabled:!!selected&&year>=2000&&year<=2200});
 return <div className="space-y-3">
  {admin&&<><label className="grid gap-1">Find employee<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or employee ID"/></label>
   {directory.isError&&<p role="alert">Unable to search employees.</p>}{search.trim().length>=2&&<div className="flex flex-wrap gap-2">{directory.data?.employees.map(row=><Button key={row.id} variant={selected===row.id?'default':'outline'} onClick={()=>setChosen(row.id)}>{row.firstName} {row.lastName} · {row.employeeId}</Button>)}</div>}</>}
  <label className="flex items-center gap-2">Year<Input className="w-28" type="number" min={2000} max={2200} value={year} onChange={e=>setYear(Number(e.target.value))}/></label>
  {!selected?<p>Select an employee to view the ledger.</p>:ledger.isLoading?<p>Loading ledger…</p>:ledger.isError?<div role="alert">Unable to load balances. <Button onClick={()=>ledger.refetch()}>Retry</Button></div>:<>
   {admin&&<LegacyLeave key={selected} employeeId={selected}/>}
   {!ledger.data?.accounts.length&&<p>No leave types configured.</p>}
   {ledger.data?.accounts.map(account=><div className="rounded border p-3 space-y-2" key={account.leaveType}>
    <h4 className="font-medium">{account.leaveType}</h4>
    {account.managed?<p className="text-sm">Allocated {account.allocated} · Approved {account.used} · Pending {account.pending} · Available {account.available} days</p>:<p className="text-sm">No ledger allocation. Approved: {account.used}; pending: {account.pending}. Balance enforcement starts after the first allocation.</p>}
    {account.needsReconciliation&&<p role="alert">Legacy cross-year leave needs reconciliation before this account can be used.</p>}
    {ledger.data.canAllocate&&<Allocation key={`${selected}-${year}-${account.leaveType}-${account.version}`} employeeId={selected} account={account}/>}
    {ledger.data.canAllocate&&<LeaveRuns key={`run-${selected}-${year}-${account.leaveType}-${account.version}`} employeeId={selected} account={account}/>}
   </div>)}
   <details><summary className="cursor-pointer">Allocation history ({ledger.data?.entries.length||0})</summary>{ledger.data?.entries.map(row=><p className="text-sm mt-2" key={row.id}>{row.leaveType}: {row.days>0?'+':''}{row.days} days · {row.reason} · {row.reference}</p>)}</details>
  </>}
 </div>;
}
function Allocation({employeeId,account}:{employeeId:number;account:Account}){
 const [days,setDays]=useState(''),[reason,setReason]=useState(''),[reference]=useState(()=>crypto.randomUUID());const cache=useQueryClient(),{toast}=useToast();
 const save=useMutation({mutationFn:()=>apiJson(`/api/leaves/balances/${employeeId}/${account.year}`,{method:'POST',body:{leaveType:account.leaveType,days:Number(days),reason,reference,expectedVersion:account.version}}),
  onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/leaves')});toast({title:'Leave allocation recorded'});},onError:error=>toast({title:'Allocation failed',description:error.message,variant:'destructive'})});
 return <form onSubmit={event=>{event.preventDefault();save.mutate();}} className="space-y-2"><fieldset disabled={save.isPending} className="space-y-2">
  <label className="grid gap-1 text-sm">Days to add or deduct<Input type="number" step="0.01" min={-3660} max={3660} value={days} onChange={e=>setDays(e.target.value)} required/></label>
  <label className="grid gap-1 text-sm">Allocation reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
  <Button disabled={save.isPending||!Number(days)} type="submit">{save.isPending?'Recording…':'Record allocation'}</Button>
 </fieldset></form>;
}
