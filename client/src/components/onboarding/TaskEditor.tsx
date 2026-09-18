import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {useToast} from '@/hooks/use-toast';
export type EditableTask={id:number;version:number;status:string;comments?:string|null;assigneeId?:number|null;assigneeName?:string|null;dueDate:string;reviewRequired?:boolean;reviewState?:string};
export function TaskEditor({task}:{task:EditableTask}){
 const [open,setOpen]=useState(false);
 if(task.reviewState==='pending')return <p>Awaiting independent HR review in the task review panel above.</p>;
 return <><Button variant="outline" size="sm" onClick={()=>setOpen(!open)}>{open?'Close':'Update task'}</Button>{open&&<TaskForm key={task.version} task={task} close={()=>setOpen(false)}/>}</>;
}
function TaskForm({task,close}:{task:EditableTask;close:()=>void}){
 const [status,setStatus]=useState(task.status==='overdue'?'in_progress':task.status),[comments,setComments]=useState(task.comments||''),[owner,setOwner]=useState(task.assigneeId||null),[due,setDue]=useState(task.dueDate),[search,setSearch]=useState('');
 const cache=useQueryClient(),{toast}=useToast();
 const people=useQuery<{employees:{id:number;firstName:string;lastName:string}[]}>({queryKey:['/api/employees/directory',{q:search.trim(),status:'active',limit:20}],enabled:search.trim().length>=2});
 const save=useMutation({mutationFn:()=>apiJson(`/api/onboarding-tasks/${task.id}`,{method:'PUT',body:{expectedVersion:task.version,status,comments,assigneeId:owner,dueDate:due}}),onSuccess:async()=>{await Promise.all(['/api/onboarding-tasks','/api/employee-onboarding','/api/onboarding-stats'].map(key=>cache.invalidateQueries({queryKey:[key]})));toast({title:'Task and checklist progress updated'});close();},onError:error=>toast({title:'Unable to update task',description:error.message,variant:'destructive'})});
 return <form className="mt-3 min-w-64 space-y-2 rounded border p-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="space-y-2">
  <label className="grid gap-1">Task status<select className="rounded border bg-background p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="completed" disabled={task.reviewRequired}>Completed{task.reviewRequired?' (HR review required)':''}</option></select></label>
  <label className="grid gap-1">Due date<Input type="date" value={due} onChange={e=>setDue(e.target.value)} required/></label>
  <label className="grid gap-1">Find task owner<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Enter at least two characters"/></label>
  {people.error&&<p role="alert">Unable to search employees.</p>}
  <label className="grid gap-1">Task owner<select className="rounded border bg-background p-2" value={owner??''} onChange={e=>setOwner(e.target.value?Number(e.target.value):null)}><option value="">Unassigned</option>{owner&&!people.data?.employees.some(p=>p.id===owner)&&<option value={owner}>{owner===task.assigneeId?task.assigneeName||`Employee #${owner}`:`Employee #${owner}`}</option>}{people.data?.employees.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
  <label className="grid gap-1">Task notes<Textarea value={comments} onChange={e=>setComments(e.target.value)} maxLength={5000}/></label><Button type="submit">Save task</Button>
 </fieldset></form>;
}
