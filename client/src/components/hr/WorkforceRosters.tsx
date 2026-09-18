import {useState, type FormEvent} from 'react';
import {useMutation, useQueryClient, useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import {Field, fieldClass, QueryError} from './Operations';
import {siteTimeToIso, type ShiftView} from '@shared/workforce';
import {siteWallTime, type Recurrence, type SeriesEditorView} from '@shared/workforce-rosters';

import {QualificationPicker} from './WorkforceStaffing';

const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
type Details = {role:string; station:string; headcount:number; breakMinutes:number;qualificationIds:number[]};
function ShiftDetails({value, onChange}: {value:Details; onChange:(value:Partial<Details>)=>void}) {
  return <><Field label="Role"><input className={fieldClass} value={value.role} minLength={2} maxLength={120} required onChange={e=>onChange({role:e.target.value})}/></Field>
    <Field label="Station"><input className={fieldClass} value={value.station} maxLength={120} onChange={e=>onChange({station:e.target.value})}/></Field>
    <div className="grid grid-cols-2 gap-3"><Field label="People needed"><input className={fieldClass} type="number" min={1} max={500} value={value.headcount} required onChange={e=>onChange({headcount:Number(e.target.value)})}/></Field>
      <Field label="Break minutes"><input className={fieldClass} type="number" min={0} max={1439} value={value.breakMinutes} required onChange={e=>onChange({breakMinutes:Number(e.target.value)})}/></Field></div><QualificationPicker value={value.qualificationIds} onChange={qualificationIds=>onChange({qualificationIds})}/></>;
}
function useRosterSave(onDone:()=>void) {
  const cache=useQueryClient(),{toast}=useToast();
  return useMutation({mutationFn:({url,body}:{url:string;body:unknown})=>apiJson(url,{method:'POST',body}), onSuccess:async()=>{
    await cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/workforce/')});
    onDone();toast({title:'Roster saved'});
  }});
}

export function RecurringShiftsButton({teamId,zone}:{teamId:number;zone:string}) {
  const [open,setOpen]=useState(false),[requestKey,setRequestKey]=useState('');
  const initial=():Recurrence=>({role:'',station:'',qualificationIds:[],headcount:1,breakMinutes:0,startDate:'',endDate:'',weekdays:[],startTime:'09:00',endTime:'17:00',endDayOffset:0});
  const [form,setForm]=useState<Recurrence>(initial),[preview,setPreview]=useState<{timezone:string;shifts:{startAt:string;endAt:string}[]}|null>(null);
  const save=useRosterSave(()=>setOpen(false));
  const check=useMutation({mutationFn:(body:Recurrence)=>apiJson<NonNullable<typeof preview>>(`/api/workforce/teams/${teamId}/series/preview`,{method:'POST',body}),onSuccess:setPreview});
  const busy=save.isPending||check.isPending;
  function change(value:Partial<Recurrence>) {setForm({...form,...value});setPreview(null);setRequestKey(crypto.randomUUID());check.reset();save.reset();}
  function begin() {setForm(initial());setPreview(null);setRequestKey(crypto.randomUUID());check.reset();save.reset();setOpen(true);}
  async function submit(e:FormEvent) {e.preventDefault();try{
    if(!preview) await check.mutateAsync(form);
    else await save.mutateAsync({url:`/api/workforce/teams/${teamId}/series`,body:{requestKey,recurrence:form}});
  }catch{}}
  return <><Button variant="outline" onClick={begin}>Recurring shifts</Button>
    <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v);}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>Create recurring shifts</DialogTitle><DialogDescription>Choose days and hours in {zone}. Preview up to 60 shifts across 90 days, then offer them to team members.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4">
        <ShiftDetails value={form} onChange={change}/>
        <div className="grid grid-cols-2 gap-3"><Field label="First date"><input className={fieldClass} type="date" value={form.startDate} required onChange={e=>change({startDate:e.target.value})}/></Field><Field label="Last date"><input className={fieldClass} type="date" value={form.endDate} required onChange={e=>change({endDate:e.target.value})}/></Field></div>
        <fieldset><legend className="mb-2 text-sm font-medium">Repeat on</legend><div className="grid grid-cols-2 gap-2">{weekdayNames.map((name,day)=><label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.weekdays.includes(day)} onChange={e=>change({weekdays:e.target.checked?[...form.weekdays,day]:form.weekdays.filter(d=>d!==day)})}/>{name}</label>)}</div></fieldset>
        <div className="grid grid-cols-2 gap-3"><Field label="Start time"><input className={fieldClass} type="time" value={form.startTime} required onChange={e=>change({startTime:e.target.value})}/></Field><Field label="End time"><input className={fieldClass} type="time" value={form.endTime} required onChange={e=>change({endTime:e.target.value})}/></Field></div>
        <Field label="End day"><select className={fieldClass} value={form.endDayOffset} onChange={e=>change({endDayOffset:Number(e.target.value)})}><option value={0}>Same day</option><option value={1}>Following day (overnight)</option></select></Field>
      </fieldset>
      {preview&&<section className="rounded-md border p-3" aria-label="Shift preview"><h3 className="font-semibold">{preview.shifts.length} shifts ready to create</h3><p className="text-sm text-muted-foreground">{preview.timezone} · {form.headcount} people per shift · {form.breakMinutes} min break</p><ol className="mt-2 max-h-48 list-inside list-decimal overflow-auto text-sm">{preview.shifts.map((s,i)=><li className="py-1" key={i}>{siteWallTime(s.startAt,preview.timezone).replace('T',' ')} → {siteWallTime(s.endAt,preview.timezone).replace('T',' ')}</li>)}</ol></section>}
      <QueryError error={check.error||save.error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Close</Button><Button type="submit" disabled={busy||!form.weekdays.length}>{busy?'Working…':preview?`Create ${preview.shifts.length} shifts`:'Preview shifts'}</Button></div>
      </form></DialogContent></Dialog></>;
}

export function ShiftActions({shift,zone}:{shift:ShiftView;zone:string}) {
  const [mode,setMode]=useState<'revise'|'cancel'|null>(null),[reason,setReason]=useState(''),[error,setError]=useState<unknown>(null);
  const [form,setForm]=useState({qualificationIds:shift.requiredQualifications.map(q=>q.id),role:shift.role,station:shift.station||'',headcount:shift.headcount,breakMinutes:shift.breakMinutes,startAt:'',endAt:''});
  const save=useRosterSave(()=>setMode(null));
  function begin(value:'revise'|'cancel') {setMode(value);setReason('');setError(null);save.reset();setForm({qualificationIds:shift.requiredQualifications.map(q=>q.id),role:shift.role,station:shift.station||'',headcount:shift.headcount,breakMinutes:shift.breakMinutes,startAt:siteWallTime(shift.startAt,zone),endAt:siteWallTime(shift.endAt,zone)});}
  async function submit(e:FormEvent) {e.preventDefault();setError(null);try{
    const body={version:shift.version,reason,...(mode==='revise'?{shift:{...form,startAt:siteTimeToIso(form.startAt,zone),endAt:siteTimeToIso(form.endAt,zone)}}:{})};
    await save.mutateAsync({url:`/api/workforce/shifts/${shift.id}/${mode}`,body});
  }catch(e){setError(e);}}
  if(!shift.canSchedule||shift.status!=='scheduled'||new Date(shift.startAt)<=new Date())return null;
  const active=shift.assignments.filter(a=>['offered','accepted'].includes(a.status)).length;
  return <><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={()=>begin('revise')}>Revise shift</Button><Button variant="outline" size="sm" onClick={()=>begin('cancel')}>Cancel shift</Button>{shift.seriesId&&<SeriesActions shift={shift} zone={zone}/>}</div>
    <Dialog open={!!mode} onOpenChange={v=>{if(!v&&!save.isPending)setMode(null);}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader><DialogTitle>{mode==='revise'?'Revise shift':'Cancel shift'}</DialogTitle><DialogDescription>{mode==='revise'?`This changes one occurrence. ${active} current assignments will be cancelled and reoffered for fresh acceptance. All dates use ${zone}.`:`This cancels one occurrence and its ${active} current assignments. The reason will be visible to employees.`}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4"><fieldset disabled={save.isPending} className="space-y-4">
        {mode==='revise'&&<><ShiftDetails value={form} onChange={v=>setForm({...form,...v})}/><Field label="Revised start"><input className={fieldClass} type="datetime-local" value={form.startAt} required onChange={e=>setForm({...form,startAt:e.target.value})}/></Field><Field label="Revised end"><input className={fieldClass} type="datetime-local" value={form.endAt} required onChange={e=>setForm({...form,endAt:e.target.value})}/></Field></>}
        <Field label="Reason for change"><textarea className={fieldClass} value={reason} minLength={5} maxLength={500} required onChange={e=>setReason(e.target.value)}/></Field>
      </fieldset><QueryError error={error}/><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={save.isPending} onClick={()=>setMode(null)}>Close</Button><Button type="submit" variant={mode==='cancel'?'destructive':'default'} disabled={save.isPending}>{save.isPending?'Saving…':mode==='revise'?'Save revision & reoffer':'Confirm cancellation'}</Button></div></form>
    </DialogContent></Dialog></>;
}

function SeriesActions({shift,zone}:{shift:ShiftView;zone:string}){
  const [open,setOpen]=useState(false),[mode,setMode]=useState('revise'),[fromDate,setFromDate]=useState(''),[reason,setReason]=useState('');
  const initial=()=>{const start=siteWallTime(shift.startAt,zone),end=siteWallTime(shift.endAt,zone);return {role:shift.role,station:shift.station||'',headcount:shift.headcount,breakMinutes:shift.breakMinutes,qualificationIds:shift.requiredQualifications.map(q=>q.id),startTime:start.slice(11),endTime:end.slice(11),endDayOffset:start.slice(0,10)===end.slice(0,10)?0:1};};
  const [form,setForm]=useState(initial),save=useRosterSave(()=>setOpen(false));
  const query=useQuery<SeriesEditorView>({queryKey:[`/api/workforce/series/${shift.seriesId}`,{fromDate}],enabled:open&&!!fromDate});
  function begin(){setFromDate(siteWallTime(new Date().toISOString(),zone).slice(0,10));setReason('');setMode('revise');setForm(initial());save.reset();setOpen(true);}
  return <><Button variant="outline" size="sm" onClick={begin}>Manage recurring series</Button><Dialog open={open} onOpenChange={value=>{if(!save.isPending)setOpen(value);}}><DialogContent className="max-h-[90vh] max-w-2xl overflow-auto"><DialogHeader><DialogTitle>Manage future recurring shifts</DialogTitle><DialogDescription>Revise or cancel future scheduled occurrences together. Dates stay on their existing days in {zone}. Revised offers require fresh employee acceptance.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(!query.data?.shifts.length)return;save.mutate({url:`/api/workforce/series/${shift.seriesId}/${mode}`,body:{version:query.data.version,fromDate,expectedShifts:query.data.shifts.map(s=>({id:s.id,version:s.version})),reason,...(mode==='revise'?{details:form}:{})}});}}><fieldset disabled={save.isPending} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="Change occurrences from"><input className={fieldClass} type="date" required value={fromDate} onChange={e=>{setFromDate(e.target.value);save.reset();}}/></Field><Field label="Series action"><select className={fieldClass} value={mode} onChange={e=>{setMode(e.target.value);save.reset();}}><option value="revise">Revise hours / staffing details</option><option value="cancel">Cancel future occurrences</option></select></Field></div>
      {mode==='revise'&&<><ShiftDetails value={form} onChange={v=>setForm({...form,...v})}/><div className="grid gap-3 sm:grid-cols-2"><Field label="Revised start time"><input className={fieldClass} type="time" required value={form.startTime} onChange={e=>setForm({...form,startTime:e.target.value})}/></Field><Field label="Revised end time"><input className={fieldClass} type="time" required value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></Field></div><Field label="End day"><select className={fieldClass} value={form.endDayOffset} onChange={e=>setForm({...form,endDayOffset:Number(e.target.value)})}><option value={0}>Same day</option><option value={1}>Following day</option></select></Field></>}
      <QueryError error={query.error}/>{query.isFetching&&<p className="text-sm">Loading current occurrences…</p>}{query.data&&<div className="rounded border p-3 text-sm"><p className="font-semibold">{query.data.shifts.length} future occurrences · {query.data.shifts.reduce((n,s)=>n+s.activeCount,0)} current offers / assignments</p><ol className="max-h-48 overflow-auto list-inside list-decimal mt-2">{query.data.shifts.map(s=><li key={s.id} className="py-1">#{s.id}: {siteWallTime(s.startAt,zone).replace('T',' ')} → {siteWallTime(s.endAt,zone).replace('T',' ')} · {s.activeCount} assigned</li>)}</ol></div>}
      <p className="text-sm text-muted-foreground">Past and already cancelled occurrences stay unchanged. Recorded arrival, timesheets, payroll-linked time, eligibility conflicts, or an outdated occurrence prevent the entire change.</p><Field label="Reason for recurring roster change"><textarea className={fieldClass} required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field><label className="flex gap-2 text-sm"><input type="checkbox" required/>I reviewed the future occurrences and want to apply this action to all of them.</label>
      <QueryError error={save.error}/><Button type="submit" variant={mode==='cancel'?'destructive':'default'} disabled={!query.data?.shifts.length||query.isFetching||!!query.error}>{mode==='revise'?'Revise series & reoffer':'Cancel future series occurrences'}</Button>
    </fieldset></form>{!!query.data?.history.length&&<details className="border-t pt-3 text-sm"><summary className="cursor-pointer font-medium">Recent series changes</summary>{query.data.history.map(h=><div className="mt-3" key={h.version}><strong>Version {h.version} · {h.snapshot.action} · {h.snapshot.shiftIds.length} occurrences</strong><p>{h.reason}</p><p className="text-muted-foreground">{new Date(h.created_at).toLocaleString()}</p></div>)}</details>}
  </DialogContent></Dialog></>;
}
