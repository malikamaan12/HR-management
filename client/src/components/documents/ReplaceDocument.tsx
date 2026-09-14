import {useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import type {ApiDocument} from '@/lib/api-types';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';

export function ReplaceDocument({document,onDone,onCancel}:{document:ApiDocument;onDone:()=>void;onCancel:()=>void}) {
  const [initial]=useState(document);
  const [number,setNumber]=useState(document.documentNumber),[issue,setIssue]=useState(document.issueDate),[expiry,setExpiry]=useState(document.expiryDate);
  const [authority,setAuthority]=useState(document.issueAuthority||''),[notes,setNotes]=useState(document.notes||''),[reason,setReason]=useState(''),[file,setFile]=useState<File|null>(null);
  const cache=useQueryClient(),{toast}=useToast();
  const save=useMutation({mutationFn:()=>{
    if(!file||file.size<1||file.size>10*1024*1024)throw new Error('Choose a PDF, PNG or JPEG between 1 byte and 10 MB');
    if(initial.currentVersion===undefined)throw new Error('Reload the document before replacing it');
    const body=new FormData();
    for(const [key,value] of Object.entries({documentNumber:number,issueDate:issue,expiryDate:expiry,issueAuthority:authority,notes,reason,expectedVersion:String(initial.currentVersion)}))body.append(key,value);
    body.append('document',file);
    return apiJson(`/api/documents/${initial.id}/replace`,{method:'POST',body});
  },onSuccess:async()=>{
    await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/documents')||String(q.queryKey[0]).startsWith('/api/dashboard')});
    toast({title:'Document renewed or replaced',description:'The earlier file remains in version history.'});onDone();
  },onError:error=>toast({title:'Unable to replace document',description:error.message,variant:'destructive'})});
  return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
    <p className="text-sm text-muted-foreground">Upload the renewed or corrected {document.documentType}. The employee and document type remain the same. Earlier versions stay available to authorized readers.</p>
    <fieldset disabled={save.isPending} className="space-y-3">
      <label className="grid gap-1 text-sm">Document number<Input value={number} onChange={e=>setNumber(e.target.value)} maxLength={200} required/></label>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm">Issue date<Input type="date" value={issue} onChange={e=>setIssue(e.target.value)} required/></label><label className="grid gap-1 text-sm">Expiry date<Input type="date" value={expiry} min={issue} onChange={e=>setExpiry(e.target.value)} required/></label></div>
      <label className="grid gap-1 text-sm">Issuing authority<Input value={authority} onChange={e=>setAuthority(e.target.value)} maxLength={200}/></label>
      <label className="grid gap-1 text-sm">Notes<textarea className="rounded-md border bg-background p-2" value={notes} onChange={e=>setNotes(e.target.value)} maxLength={5000}/></label>
      <label className="grid gap-1 text-sm">Reason for renewal or replacement<Input value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></label>
      <label className="grid gap-1 text-sm">New document file<Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFile(e.target.files?.[0]??null)} required/></label>
      <p className="text-xs text-muted-foreground">PDF, PNG or JPEG, up to 10 MB. Every retained version uses private storage space.</p>
      <div className="flex gap-2"><Button type="submit" disabled={save.isPending||!file}>{save.isPending?'Saving…':'Save new version'}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onCancel}>Cancel replacement</Button></div>
    </fieldset>
  </form>;
}
