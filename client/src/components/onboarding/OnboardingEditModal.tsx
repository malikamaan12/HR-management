import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';

export function OnboardingEditModal({isOpen,onClose,onboarding}:{isOpen:boolean;onClose:()=>void;onboarding:any}){
 const [notes,setNotes]=useState(onboarding?.notes||''),[reason,setReason]=useState(''),[action,setAction]=useState<'notes'|'cancel'>('notes');
 const cache=useQueryClient(),{toast}=useToast();
 const history=useQuery<any[]>({queryKey:[`/api/employee-onboarding/${onboarding.id}/history`],enabled:isOpen});
 const save=useMutation({mutationFn:()=>apiJson(`/api/employee-onboarding/${onboarding.id}`,{method:'PUT',body:{expectedUpdatedAt:onboarding.updatedAt,action,notes,reason}}),
  onSuccess:async()=>{await Promise.all(['/api/employee-onboarding','/api/onboarding-stats','/api/onboarding-tasks',`/api/employee-onboarding/${onboarding.id}/history`].map(key=>cache.invalidateQueries({queryKey:[key]})));toast({title:action==='cancel'?'Onboarding cancelled':'Notes saved'});onClose();},
  onError:(error:Error)=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 return <Dialog open={isOpen} onOpenChange={open=>{if(!open&&!save.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Review onboarding</DialogTitle><DialogDescription>{onboarding.employeeName} · {onboarding.checklistName}. Completion follows task reviews and document checks.</DialogDescription></DialogHeader>
  <p className="text-sm">Status: {onboarding.status.replaceAll('_',' ')} · Progress: {onboarding.progress}%</p>
  {onboarding.status==='in_progress'?<form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
   <div><Label htmlFor="onboarding-action">Action</Label><select id="onboarding-action" className="flex h-10 w-full rounded-md border bg-background px-3" value={action} onChange={e=>setAction(e.target.value as 'notes'|'cancel')}><option value="notes">Update notes</option><option value="cancel">Cancel onboarding</option></select></div>
   {action==='cancel'&&<p className="text-sm">Cancellation stops changes to this checklist and its tasks. Existing evidence stays in the history.</p>}
   <div><Label htmlFor="onboarding-notes">Notes</Label><Textarea id="onboarding-notes" maxLength={5000} value={notes} onChange={e=>setNotes(e.target.value)}/></div>
   <div><Label htmlFor="onboarding-reason">Reason for change</Label><Textarea id="onboarding-reason" required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></div>
   <Button disabled={save.isPending||!onboarding.updatedAt}>{save.isPending?'Saving…':action==='cancel'?'Cancel onboarding':'Save notes'}</Button>
  </form>:<p className="text-sm text-muted-foreground">This checklist is closed. Use the task workflow for any permitted reopening of completed work.</p>}
  <details><summary className="cursor-pointer">Change history</summary>{history.isLoading?<p>Loading history…</p>:history.isError?<p role="alert">Unable to load history.</p>:!history.data?.length?<p className="text-sm text-muted-foreground">No note or cancellation changes recorded.</p>:<ol className="space-y-3 pt-3">{history.data.map(row=><li key={row.version} className="border-t pt-2 text-sm"><p>Change {row.version} · {new Date(row.created_at).toLocaleString()}</p><p>{row.reason}</p><p>{row.snapshot.after.status.replaceAll('_',' ')} · {row.snapshot.after.notes||'No notes'}</p></li>)}</ol>}</details>
 </DialogContent></Dialog>;
}
