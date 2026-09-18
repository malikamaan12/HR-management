import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {Candidate} from '@shared/schema';
const labels={fullNameEn:'English name',fullNameAr:'Arabic name',qidNumber:'QID number',email:'Email',phone:'Phone',linkedinProfile:'LinkedIn URL',visaStatus:'Visa status'};
type RecordData={candidate:Candidate;identityLocked:boolean;canCorrect:boolean};
export function CandidateCorrections({isOpen,onClose,candidateId}:{isOpen:boolean;onClose:()=>void;candidateId:number}){
 const [page,setPage]=useState(1);
 const record=useQuery<RecordData>({queryKey:[`/api/candidates/${candidateId}/correction-record`],enabled:isOpen});
 const history=useQuery<{items:any[];hasMore:boolean}>({queryKey:[`/api/candidates/${candidateId}/corrections`,{page}],enabled:isOpen});
 return <Dialog open={isOpen} onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Candidate record</DialogTitle><DialogDescription>Corrections keep a private version history. They do not change an employee record created from this candidate.</DialogDescription></DialogHeader>
 {record.isPending&&<p role="status">Loading candidate…</p>}{record.error&&<p role="alert">{record.error.message}</p>}
 {record.data&&<CorrectionForm key={candidateId+':'+record.data.candidate.recordVersion} record={record.data}/>}
 <section className="space-y-2"><h3 className="font-semibold">Correction history</h3>{history.error&&<p role="alert">{history.error.message}</p>}{history.data?.items.length===0&&<p>No corrections recorded.</p>}{history.data?.items.map(row=><details key={row.version} className="border rounded p-3"><summary>Version {row.version} · {new Date(row.created_at).toLocaleString()}</summary><p className="py-2">{row.reason}</p><dl>{Object.entries(labels).map(([key,label])=><div key={key} className="grid grid-cols-2 gap-2 break-words"><dt>{label}</dt><dd>{row.snapshot[key]||'—'}</dd></div>)}</dl></details>)}<div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous history</Button><Button variant="outline" disabled={!history.data?.hasMore} onClick={()=>setPage(p=>p+1)}>Next history</Button></div></section>
 </DialogContent></Dialog>;
}
function CorrectionForm({record}:{record:RecordData}){
 const client=useQueryClient(),[reason,setReason]=useState(''),[saved,setSaved]=useState(false);
 const [values,setValues]=useState<Record<string,string>>(Object.fromEntries(Object.keys(labels).map(key=>[key,(record.candidate as any)[key]||''])));
 const save=useMutation({mutationFn:()=>{const fields=Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==((record.candidate as any)[key]||'')).map(([key,value])=>[key,value||null]));return apiJson(`/api/candidates/${record.candidate.id}/corrections`,'POST',{expectedVersion:record.candidate.recordVersion,fields,reason});},onSuccess:async()=>{setSaved(true);await Promise.all([client.invalidateQueries({queryKey:['/api/candidates']}),client.invalidateQueries({queryKey:[`/api/candidates/${record.candidate.id}/correction-record`]}),client.invalidateQueries({queryKey:[`/api/candidates/${record.candidate.id}/corrections`]})]);}});
 const dirty=Object.entries(values).some(([key,value])=>value!==((record.candidate as any)[key]||''));
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}><p className="text-sm text-muted-foreground">Version {record.candidate.recordVersion}. {record.identityLocked?'An offer exists. Names and QID are locked to preserve hiring identity.':'Names and QID can be corrected until the first offer exists.'}</p><div className="grid gap-4 sm:grid-cols-2">{Object.entries(labels).map(([key,label])=><div key={key}><Label htmlFor={'candidate-'+key}>{label}</Label><Input id={'candidate-'+key} type={key==='email'?'email':key==='linkedinProfile'?'url':'text'} required={['fullNameEn','email','phone'].includes(key)} disabled={!record.canCorrect||save.isPending||(record.identityLocked&&['fullNameEn','fullNameAr','qidNumber'].includes(key))} value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/></div>)}</div>{record.canCorrect&&<><Label htmlFor="candidate-reason">Reason for correction</Label><Textarea id="candidate-reason" required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/><Button disabled={!dirty||reason.trim().length<5||save.isPending}>Save correction</Button></>}{save.error&&<p role="alert">{save.error.message}</p>}{saved&&<p role="status">Correction saved.</p>}</form>;
}
