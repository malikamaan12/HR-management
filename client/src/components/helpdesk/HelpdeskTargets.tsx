import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {categoryLabels,type CaseSummary} from '@shared/helpdesk';
type Target={category:keyof typeof categoryLabels;version:number;responseHours:number|null;resolutionHours:number|null};
export function HelpdeskTargets(){
 const query=useQuery<{canEdit:boolean;items:Target[]}>({queryKey:['/api/helpdesk/targets']});
 if(!query.data?.canEdit)return null;
 return <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Category response targets</summary>
  <p className="my-3 text-sm text-muted-foreground">Targets use elapsed hours, including weekends and time waiting for an employee. Blank values disable a target. Changes apply to new cases only; reopened cases retain their original deadlines.</p>
  <div className="grid md:grid-cols-2 gap-3">{query.data.items.map(row=><TargetEditor key={`${row.category}-${row.version}`} row={row}/>)}</div>
 </details>;
}
function TargetEditor({row}:{row:Target}){
 const [response,setResponse]=useState(String(row.responseHours??'')),[resolution,setResolution]=useState(String(row.resolutionHours??'')),[reason,setReason]=useState('');
 const cache=useQueryClient(),{toast}=useToast();
 const save=useMutation({mutationFn:()=>apiJson('/api/helpdesk/targets',{method:'POST',body:{category:row.category,responseHours:response===''?null:Number(response),resolutionHours:resolution===''?null:Number(resolution),reason,expectedVersion:row.version}}),onSuccess:async()=>{await cache.invalidateQueries({queryKey:['/api/helpdesk/targets']});toast({title:'Target policy saved for new cases'});},onError:error=>toast({title:'Unable to save targets',description:error.message,variant:'destructive'})});
 return <form className="rounded border p-3 space-y-2" onSubmit={e=>{e.preventDefault();save.mutate();}}><h3 className="font-medium">{categoryLabels[row.category]} · v{row.version}</h3><fieldset disabled={save.isPending} className="space-y-2">
  <label className="grid gap-1 text-sm">First response hours<Input type="number" min={1} max={720} step={1} value={response} onChange={e=>setResponse(e.target.value)}/></label>
  <label className="grid gap-1 text-sm">Resolution hours<Input type="number" min={1} max={2160} step={1} value={resolution} onChange={e=>setResolution(e.target.value)}/></label>
  <label className="grid gap-1 text-sm">Change reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
  <Button type="submit" disabled={save.isPending}>Save targets</Button>
 </fieldset></form>;
}
export function TargetStatus({row}:{row:CaseSummary}){
 const closed=['resolved','closed'].includes(row.status),late=!closed&&((!row.firstResponseAt&&row.responseDueAt&&Date.parse(row.responseDueAt)<Date.now())||(!row.resolvedAt&&row.resolutionDueAt&&Date.parse(row.resolutionDueAt)<Date.now()));
 if(!row.responseDueAt&&!row.resolutionDueAt)return null;
 return <p className={`mt-2 text-xs ${late?'text-destructive':'text-muted-foreground'}`}>{late?'Target overdue · ':''}{row.responseDueAt?`Response ${row.firstResponseAt?'recorded':'due '+new Date(row.responseDueAt).toLocaleString()}`:''}{row.resolutionDueAt?` · Resolution ${row.resolvedAt?'recorded':'due '+new Date(row.resolutionDueAt).toLocaleString()}`:''}</p>;
}
