import {useEffect,useState,type FormEvent} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {apiJson} from '@/lib/queryClient';
import {RecurringAvailability} from './WorkforceAvailability';
import {RenewalRequestButton} from './WorkforceRenewals';
import {useToast} from '@/hooks/use-toast';
import {Field,Section,Table,QueryError,fieldClass} from './Operations';
import {siteTimeToIso,type ShiftView,type AssignmentView,type WorkforcePerson} from '@shared/workforce';
import type {Candidate,Qualification,StaffingProfile} from '@shared/workforce-staffing';

function useStaffingSave(onDone?:()=>void){
  const cache=useQueryClient(),{toast}=useToast();
  return useMutation({mutationFn:({url,body}:{url:string;body:unknown})=>apiJson(url,{method:'POST',body}),onSuccess:async()=>{
    await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/workforce/')||String(q.queryKey[0]).startsWith('/api/team-overview')});onDone?.();toast({title:'Staffing saved'});
  }});
}
export function QualificationPicker({value,onChange}:{value:number[];onChange:(ids:number[])=>void}){
  const catalog=useQuery<Qualification[]>({queryKey:['/api/workforce/staffing/catalog']});
  return <fieldset className="space-y-2"><legend className="text-sm font-medium">Required qualifications</legend><p className="text-xs text-muted-foreground">HR verification must cover every date of the shift.</p><QueryError error={catalog.error}/>
    {catalog.isLoading?<p className="text-sm">Loading qualifications…</p>:!catalog.data?.length?<p className="text-sm text-muted-foreground">HR can add qualification types in Availability & qualifications.</p>:catalog.data.map(q=><label key={q.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(q.id)} onChange={e=>onChange(e.target.checked?[...value,q.id]:value.filter(id=>id!==q.id))}/>{q.name}</label>)}
  </fieldset>;
}

export function StaffingCandidatesButton({shift,source}:{shift:ShiftView;source?:AssignmentView}){
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[q,setQ]=useState(''),[employeeId,setEmployeeId]=useState(''),[reason,setReason]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setQ(search),300);return()=>clearTimeout(timer);},[search]);
  const candidates=useQuery<{candidates:Candidate[];hasMore:boolean}>({queryKey:[`/api/workforce/shifts/${shift.id}/candidates`,{q}],enabled:open});
  const save=useStaffingSave(()=>setOpen(false));
  function begin(){setEmployeeId('');setReason('');setSearch('');setQ('');save.reset();setOpen(true);}
  async function submit(e:FormEvent){e.preventDefault();try{await save.mutateAsync({url:source?`/api/workforce/assignments/${source.id}/replacement`:`/api/workforce/shifts/${shift.id}/offers`,body:source?{employeeId:Number(employeeId),shiftVersion:shift.version,reason}:{employeeId:Number(employeeId)}});}catch{}}
  return <><Button type="button" size="sm" variant="outline" onClick={begin}>{source?'Find replacement':'Find available staff'}</Button><Dialog open={open} onOpenChange={v=>{if(!save.isPending)setOpen(v);}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{source?`Replace ${source.name}`:`Staff ${shift.role}`}</DialogTitle><DialogDescription>{source?'An accepted employee remains assigned until the replacement accepts. Declining or cancelling the replacement keeps the current assignment.':'Candidates have no recorded membership, availability, qualification or scheduling conflict. Each employee must still accept the offer.'}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={submit}><fieldset disabled={save.isPending} className="space-y-4"><Field label="Search team members"><input className={fieldClass} value={search} maxLength={80} onChange={e=>{setSearch(e.target.value);setEmployeeId('');}}/></Field>
      <QueryError error={candidates.error}/>{candidates.isFetching?<p>Checking candidates…</p>:<><Field label="Select eligible employee"><select className={fieldClass} value={employeeId} required onChange={e=>setEmployeeId(e.target.value)}><option value="">Choose…</option>{candidates.data?.candidates.filter(p=>p.eligible).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {candidates.data?.hasMore&&<p className="text-sm">Showing the first 50 candidates. Search by name to narrow the list.</p>}
      {candidates.data?.candidates.filter(p=>!p.eligible).map(p=><p key={p.id} className="rounded border p-2 text-sm"><strong>{p.name}</strong>: {p.issue}</p>)}
      {!candidates.data?.candidates.length&&<p className="text-sm">No new members cover this shift. Employees with an existing assignment or response are excluded.</p>}</>}
      {source&&<Field label="Replacement reason"><textarea className={fieldClass} value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={500} required/></Field>}
    </fieldset><QueryError error={save.error}/><Button disabled={save.isPending||candidates.isFetching||!employeeId} type="submit">{save.isPending?'Saving…':source?'Offer replacement':'Offer shift'}</Button></form>
  </DialogContent></Dialog></>;
}

export function WorkforceStaffing({isAdmin}:{isAdmin:boolean}){
  const [search,setSearch]=useState(''),[q,setQ]=useState(''),[employeeId,setEmployeeId]=useState('');
  const [zone,setZone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone),[start,setStart]=useState(''),[end,setEnd]=useState(''),[note,setNote]=useState('');
  const [name,setName]=useState(''),[qualificationId,setQualificationId]=useState(''),[validFrom,setValidFrom]=useState(''),[validThrough,setValidThrough]=useState(''),[reference,setReference]=useState('');
  const [reasonTarget,setReasonTarget]=useState<{url:string;title:string}|null>(null),[reason,setReason]=useState(''),[formError,setFormError]=useState<unknown>(null);
  useEffect(()=>{const timer=setTimeout(()=>setQ(search.trim()),300);return()=>clearTimeout(timer);},[search]);
  const people=useQuery<WorkforcePerson[]>({queryKey:['/api/workforce/directory',{kind:'employees',q}],enabled:isAdmin&&q.length>=2});
  const profile=useQuery<StaffingProfile>({queryKey:['/api/workforce/staffing/profile',employeeId?{employeeId}:{}]});
  const catalog=useQuery<Qualification[]>({queryKey:['/api/workforce/staffing/catalog']});
  const save=useStaffingSave(),reasonSave=useStaffingSave(()=>setReasonTarget(null));
  const id=profile.data?.employee.id;
  function format(value:string){try{return new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return value;}}
  async function submitAvailability(e:FormEvent){e.preventDefault();setFormError(null);try{await save.mutateAsync({url:`/api/workforce/staffing/employees/${id}/unavailable`,body:{startAt:siteTimeToIso(start,zone),endAt:siteTimeToIso(end,zone),note}});setStart('');setEnd('');setNote('');}catch(e){setFormError(e);}}
  async function submitCredential(e:FormEvent){e.preventDefault();try{await save.mutateAsync({url:`/api/workforce/staffing/employees/${id}/qualifications`,body:{qualificationId:Number(qualificationId),validFrom,validThrough:validThrough||null,verificationReference:reference}});setReference('');}catch{}}
  function askReason(url:string,title:string){setReasonTarget({url,title});setReason('');reasonSave.reset();}
  return <div className="space-y-5">
    {isAdmin&&<Section title="Employee selection"><Field label="Find employee"><input className={fieldClass} disabled={save.isPending} value={search} placeholder="Search at least 2 characters" onChange={e=>setSearch(e.target.value)}/></Field><QueryError error={people.error}/><Field label="Employee profile"><select className={fieldClass} disabled={save.isPending} value={employeeId} onChange={e=>{setEmployeeId(e.target.value);setStart('');setEnd('');setNote('');setQualificationId('');setValidFrom('');setValidThrough('');setReference('');save.reset();setFormError(null);}}><option value="">My employee record</option>{employeeId&&profile.data&&!people.data?.some(p=>String(p.id)===employeeId)&&<option value={employeeId}>{profile.data.employee.name}</option>}{people.data?.map(p=><option key={p.id} value={p.id}>{p.name} · {p.label}</option>)}</select></Field></Section>}
    {isAdmin&&<Section title="Qualification types"><p className="text-sm text-muted-foreground">Add the qualifications used by your company. Select required qualifications when creating or revising a shift.</p><form className="flex items-end gap-3" onSubmit={async e=>{e.preventDefault();try{await save.mutateAsync({url:'/api/workforce/staffing/catalog',body:{name}});setName('');}catch{}}}><div className="flex-1"><Field label="Qualification name"><input className={fieldClass} value={name} minLength={2} maxLength={120} required onChange={e=>setName(e.target.value)}/></Field></div><Button type="submit" disabled={save.isPending}>Add type</Button></form><QueryError error={catalog.error}/><p className="text-sm">{catalog.data?.map(c=>c.name).join(' · ')||'No types added yet.'}</p></Section>}
    <QueryError error={profile.error||save.error||formError}/>{profile.isLoading?<p>Loading employee staffing details…</p>:profile.data&&<>
    <h2 className="text-xl font-semibold">{profile.data.employee.name}</h2>
    <RecurringAvailability key={profile.data.employee.id} employeeId={profile.data.employee.id}/>
    <Section title="Unavailable periods"><p className="text-sm text-muted-foreground">Record when you cannot accept workforce shifts. This does not request leave or change payroll. Ask your lead to release or replace any overlapping accepted shift first. Notes are visible only to you and HR.</p>
      <form className="space-y-3" onSubmit={submitAvailability}><fieldset disabled={save.isPending} className="space-y-3"><Field label="Availability time zone"><input className={fieldClass} value={zone} onChange={e=>setZone(e.target.value)} required/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Unavailable from"><input className={fieldClass} type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} required/></Field><Field label="Unavailable until"><input className={fieldClass} type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} required/></Field></div><Field label="Private note (optional)"><textarea className={fieldClass} value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></Field></fieldset><Button type="submit" disabled={save.isPending}>Record unavailability</Button></form>
      <Table headers={['Period','Status / note','Action']} rows={profile.data.unavailable.map(u=>[`${format(u.startAt)} → ${format(u.endAt)}`,<span>{u.cancelledAt?'Cancelled':new Date(u.endAt)<new Date()?'Past':'Unavailable'}{u.note&&<span className="block">{u.note}</span>}{u.cancellationReason&&<span className="block">{u.cancellationReason}</span>}</span>,!u.cancelledAt&&new Date(u.endAt)>new Date()?<Button variant="outline" size="sm" onClick={()=>askReason(`/api/workforce/staffing/unavailable/${u.id}/cancel`,'Cancel unavailable period')}>Cancel period</Button>:null])}/>
    </Section>
    <Section title="Verified qualifications"><p className="text-sm text-muted-foreground">HR records verification and validity dates. Revoked or expired qualifications flag affected upcoming assignments for review.</p>
      {isAdmin&&<form className="space-y-3" onSubmit={submitCredential}><fieldset disabled={save.isPending} className="space-y-3"><Field label="Qualification type"><select className={fieldClass} value={qualificationId} onChange={e=>setQualificationId(e.target.value)} required><option value="">Choose…</option>{catalog.data?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Valid from"><input className={fieldClass} type="date" value={validFrom} onChange={e=>setValidFrom(e.target.value)} required/></Field><Field label="Valid through (optional)"><input className={fieldClass} type="date" value={validThrough} onChange={e=>setValidThrough(e.target.value)}/></Field></div><Field label="Verification reference"><textarea className={fieldClass} value={reference} minLength={5} maxLength={500} onChange={e=>setReference(e.target.value)} required placeholder="Certificate reference or record of HR verification"/></Field></fieldset><Button type="submit" disabled={save.isPending}>Record verification</Button></form>}
      <Table headers={['Qualification','Valid dates','Verification / status','Action']} rows={profile.data.qualifications.map(c=>[c.name,`${c.validFrom} → ${c.validThrough||'No expiry recorded'}`,<span>{c.verificationReference}{c.renewsCredentialId&&<span className="block">Renews verification #{c.renewsCredentialId}</span>}{c.renewedById&&<span className="block">Renewed by verification #{c.renewedById}</span>}{c.revokedAt&&<strong className="block text-destructive">Revoked: {c.revocationReason}</strong>}</span>,<div className="flex flex-wrap gap-2">{!c.revokedAt&&!c.renewedById&&c.validThrough&&<RenewalRequestButton credentialId={c.id}/>} {isAdmin&&!c.revokedAt&&<Button variant="outline" size="sm" onClick={()=>askReason(`/api/workforce/staffing/qualifications/${c.id}/revoke`,'Revoke qualification verification')}>Revoke</Button>}</div>])}/>
    </Section></>}
    <Dialog open={!!reasonTarget} onOpenChange={v=>{if(!v&&!reasonSave.isPending)setReasonTarget(null);}}><DialogContent><DialogHeader><DialogTitle>{reasonTarget?.title}</DialogTitle><DialogDescription>Keep the original record and add the reason for this change. Existing accepted shifts remain visible for lead review.</DialogDescription></DialogHeader><form className="space-y-3" onSubmit={async e=>{e.preventDefault();try{await reasonSave.mutateAsync({url:reasonTarget!.url,body:{reason}});}catch{}}}><Field label="Reason"><textarea className={fieldClass} value={reason} minLength={5} maxLength={500} onChange={e=>setReason(e.target.value)} required/></Field><QueryError error={reasonSave.error}/><Button type="submit" disabled={reasonSave.isPending}>Save change</Button></form></DialogContent></Dialog>
  </div>;
}
