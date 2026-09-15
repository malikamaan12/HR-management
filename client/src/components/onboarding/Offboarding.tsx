import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';
type Task={title:string;kind:'asset'|'checklist';ownerId:number;dueDate:string;status:'pending'|'done';notes:string};
type Case={id:number;employee_id:number;employee_name:string;version:number;status:string;tasks:Task[];account_deactivated:boolean};
function useSave(){const cache=useQueryClient(),{toast}=useToast();return useMutation({mutationFn:({path,body}:{path:string;body:unknown})=>apiJson(path,{method:'POST',body}),onSuccess:async()=>{await cache.invalidateQueries({queryKey:['/api/offboarding']});toast({title:'Offboarding saved'});},onError:error=>toast({title:'Unable to save offboarding',description:error.message,variant:'destructive'})});}
export function Offboarding(){
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[employeeId,setEmployeeId]=useState(''),[ownerId,setOwnerId]=useState(''),[dueDate,setDueDate]=useState(''),[reason,setReason]=useState(''),[title,setTitle]=useState(''),[kind,setKind]=useState<'asset'|'checklist'>('checklist'),[tasks,setTasks]=useState<Task[]>([]);
 const cases=useQuery<{items:Case[]}>({queryKey:['/api/offboarding',{page}]});
 const people=useQuery<{employees:{id:number;firstName:string;lastName:string}[]}>({queryKey:['/api/employees/directory',{q:search.trim(),limit:50}],enabled:search.trim().length>=2});const save=useSave();
 return <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Offboarding and asset return</summary>
  <p className="my-3 text-sm">Track exit tasks and returned assets. Employment termination is recorded separately in the employee lifecycle. Completion can optionally deactivate the linked account.</p>
  {cases.error?<p role="alert">HR management access is required, or the offboarding service is unavailable.</p>:<>
  <form className="space-y-3 rounded border p-3" onSubmit={async e=>{e.preventDefault();try{await save.mutateAsync({path:'/api/offboarding',body:{employeeId:Number(employeeId),reason,tasks}});setTasks([]);setReason('');}catch{}}}>
   <label className="grid gap-1">Search employees and task owners<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Enter at least two characters"/></label>
   {people.error&&<p role="alert">Unable to search employees.</p>}
   <div className="grid gap-3 md:grid-cols-2">{[['Departing employee',employeeId,setEmployeeId],['Task owner',ownerId,setOwnerId]].map(([label,value,setter])=><label key={String(label)} className="grid gap-1">{String(label)}<select className="rounded border bg-background p-2" value={String(value)} onChange={e=>(setter as (v:string)=>void)(e.target.value)}><option value="">Select employee</option>{value&&!people.data?.employees.some(p=>String(p.id)===value)&&<option value={String(value)}>Employee #{String(value)}</option>}{people.data?.employees.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName} · #{p.id}</option>)}</select></label>)}</div>
   <label className="grid gap-1">Exit case reason<Input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <div className="grid gap-2 md:grid-cols-3"><label>Task / asset description<Input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160}/></label><label>Type<select className="block rounded border bg-background p-2" value={kind} onChange={e=>setKind(e.target.value as 'asset'|'checklist')}><option value="checklist">Checklist</option><option value="asset">Asset return</option></select></label><label>Due date<Input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label></div>
   <Button type="button" variant="outline" disabled={!ownerId||!dueDate||title.trim().length<2||tasks.length>=100} onClick={()=>{setTasks([...tasks,{title,kind,ownerId:Number(ownerId),dueDate,status:'pending',notes:''}]);setTitle('');}}>Add task</Button>
   <ul>{tasks.map((t,i)=><li key={i}>{t.kind}: {t.title} · Owner #{t.ownerId} · {t.dueDate} <Button type="button" variant="ghost" onClick={()=>setTasks(tasks.filter((_,n)=>n!==i))}>Remove draft task</Button></li>)}</ul>
   <Button type="submit" disabled={!employeeId||!tasks.length||save.isPending}>Start offboarding</Button>
  </form>
  <div className="mt-4 space-y-4">{cases.data?.items.map(row=><CaseEditor key={`${row.id}-${row.version}`} row={row}/>)}</div>
  <div className="mt-3 flex gap-2"><Button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</Button><span>Page {page}</span><Button disabled={(cases.data?.items.length||0)<25} onClick={()=>setPage(page+1)}>Next</Button></div>
  </>}
 </details>;
}
function CaseEditor({row}:{row:Case}){
 const [reason,setReason]=useState(''),[deactivate,setDeactivate]=useState(false);const save=useSave();
 return <details className="rounded border p-3"><summary>#{row.id} · {row.employee_name} · {row.status} · {row.tasks.filter(t=>t.status==='done').length}/{row.tasks.length} complete</summary>
  {row.tasks.map((task,index)=><TaskRow key={index} task={task} index={index} row={row}/>)}
  {row.account_deactivated&&<p>Linked account deactivated.</p>}
  {row.status==='open'&&<div className="mt-3 space-y-2"><label className="grid gap-1">Completion or cancellation reason<Input value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000}/></label><label className="flex gap-2"><input type="checkbox" checked={deactivate} onChange={e=>setDeactivate(e.target.checked)}/>Deactivate linked account and revoke sessions on completion (administrator only)</label><div className="flex gap-2"><Button disabled={save.isPending||reason.trim().length<5||row.tasks.some(t=>t.status!=='done')} onClick={()=>save.mutate({path:`/api/offboarding/${row.id}/actions`,body:{action:'complete',version:row.version,deactivateAccount:deactivate,reason}})}>Complete offboarding</Button><Button variant="outline" disabled={save.isPending||reason.trim().length<5} onClick={()=>save.mutate({path:`/api/offboarding/${row.id}/actions`,body:{action:'cancel',version:row.version,reason}})}>Cancel case</Button></div></div>}
 </details>;
}
function TaskRow({task,index,row}:{task:Task;index:number;row:Case}){
 const [notes,setNotes]=useState(task.notes),[done,setDone]=useState(task.status==='done');const save=useSave();
 return <div className="my-2 rounded border p-2"><p>{task.kind==='asset'?'Asset return':'Checklist'}: {task.title} · Owner #{task.ownerId} · Due {task.dueDate}</p>{row.status==='open'?<div className="space-y-2"><label className="flex gap-2"><input type="checkbox" checked={done} onChange={e=>setDone(e.target.checked)}/>Completed / returned</label><label className="grid gap-1">Completion evidence or progress notes<Input value={notes} onChange={e=>setNotes(e.target.value)} maxLength={1000}/></label><Button variant="outline" disabled={save.isPending||(done&&notes.trim().length<5)} onClick={()=>save.mutate({path:`/api/offboarding/${row.id}/actions`,body:{action:'task',version:row.version,index,task:{...task,notes,status:done?'done':'pending'}}})}>Save task</Button></div>:<p>{task.status} · {task.notes}</p>}</div>;
}
