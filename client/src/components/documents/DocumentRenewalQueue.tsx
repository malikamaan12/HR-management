import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';

type Renewal={id:number;documentId:number;employeeName:string;documentType:string;status:string;createdAt:string;requestedBy:number;reviewedBy:number|null;reviewReason:string|null;canReview:boolean;canWithdraw:boolean;proposal:{documentNumber:string;issueDate:string;expiryDate:string;issueAuthority:string;notes:string;reason:string}};
export function DocumentRenewalQueue(){
  const [offset,setOffset]=useState(0);
  const query=useQuery<{items:Renewal[];hasMore:boolean}>({queryKey:['/api/documents/renewal-requests',offset],queryFn:()=>apiJson(`/api/documents/renewal-requests?offset=${offset}`)});
  return <section className="rounded-lg border bg-card p-4 space-y-3">
    <h3 className="text-lg font-semibold">Renewal requests</h3>
    <p className="text-sm text-muted-foreground">Review proposed files before they become current. Submit a request from a document’s details. Direct replacement remains available under existing permissions.</p>
    {query.isLoading?<p>Loading requests…</p>:query.isError?<div role="alert">Unable to load renewal requests. <Button variant="outline" onClick={()=>query.refetch()}>Retry</Button></div>:<>
      {!query.data?.items.length?<p className="text-sm">No renewal requests to show.</p>:query.data.items.map(row=><RenewalCard key={row.id} row={row}/>)}
      <div className="flex gap-2"><Button variant="outline" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous requests</Button><Button variant="outline" disabled={!query.data?.hasMore} onClick={()=>setOffset(offset+50)}>Next requests</Button></div>
    </>}
  </section>;
}
function RenewalCard({row}:{row:Renewal}){
  const [reason,setReason]=useState('');const cache=useQueryClient(),{toast}=useToast();
  const decision=useMutation({mutationFn:(value:string)=>apiJson(`/api/documents/renewal-requests/${row.id}/decision`,{method:'POST',body:JSON.stringify({decision:value,reason})}),
    onSuccess:async()=>{await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/documents')||String(q.queryKey[0]).startsWith('/api/dashboard')});toast({title:'Renewal decision recorded'});},
    onError:error=>toast({title:'Unable to record decision',description:error.message,variant:'destructive'})});
  return <details className="rounded border p-3">
    <summary className="cursor-pointer">#{row.id} · {row.employeeName} · {row.documentType} · {row.status}</summary>
    <div className="space-y-2 pt-3 text-sm">
      <p>Proposed number: {row.proposal.documentNumber}</p><p>Issue: {row.proposal.issueDate} · Expiry: {row.proposal.expiryDate}</p>
      <p>Authority: {row.proposal.issueAuthority||'Not specified'}</p><p>Reason: {row.proposal.reason}</p>{row.proposal.notes&&<p>Notes: {row.proposal.notes}</p>}
      <p>Submitted by account #{row.requestedBy} on {new Date(row.createdAt).toLocaleString()}</p>
      <Button variant="outline" asChild><a href={`/api/documents/renewal-requests/${row.id}/download`} target="_blank" rel="noopener noreferrer">Download proposed file</a></Button>
      {row.reviewReason&&<p>Decision by account #{row.reviewedBy}: {row.reviewReason}</p>}
      {(row.canReview||row.canWithdraw)&&<fieldset disabled={decision.isPending} className="space-y-2">
        <label className="grid gap-1">Decision reason<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500}/></label>
        <div className="flex gap-2">{row.canReview&&<><Button disabled={reason.trim().length<5||decision.isPending} onClick={()=>decision.mutate('approved')}>Approve renewal</Button><Button variant="outline" disabled={reason.trim().length<5||decision.isPending} onClick={()=>decision.mutate('rejected')}>Reject renewal</Button></>}
        {row.canWithdraw&&<Button variant="outline" disabled={reason.trim().length<5||decision.isPending} onClick={()=>decision.mutate('withdrawn')}>Withdraw request</Button>}</div>
      </fieldset>}
    </div>
  </details>;
}
