import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useToast} from '@/hooks/use-toast';
import {siteTimeToIso,type WorkforceSkill,type WorkforceQualification} from '@shared/workforce';

const selectClass='w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function SkillCatalogue({skills,selected,onChange,canCreate=false,disabled=false}:{skills:WorkforceSkill[];selected?:number[];onChange?:(ids:number[])=>void;canCreate?:boolean;disabled?:boolean}) {
  const [search,setSearch]=useState(''),[name,setName]=useState(''),[category,setCategory]=useState('');
  const cache=useQueryClient(),{toast}=useToast();
  const create=useMutation({mutationFn:()=>apiJson<WorkforceSkill>('/api/workforce/skills',{method:'POST',body:{name,category}}),onSuccess:async()=>{
    setName('');setCategory('');await cache.invalidateQueries({queryKey:['/api/workforce/skills']});toast({title:'Skill added to catalogue'});
  },onError:error=>toast({title:'Unable to add skill',description:error.message,variant:'destructive'})});
  const matches=skills.filter(skill=>`${skill.name} ${skill.category||''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="space-y-3">
    <label className="grid gap-1 text-sm">Search skills<Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or category"/></label>
    {selected&&<p className="text-sm text-muted-foreground">{selected.length} / 30 required. Select all skills the employee must hold for the whole shift.</p>}
    <div className="max-h-52 overflow-auto rounded-md border p-3 space-y-2">
      {matches.map(skill=><label key={skill.id} className="flex items-start gap-2 text-sm">
        {selected&&onChange&&<input type="checkbox" checked={selected.includes(skill.id)} disabled={disabled||(!selected.includes(skill.id)&&selected.length>=30)} onChange={e=>onChange(e.target.checked?[...selected,skill.id]:selected.filter(id=>id!==skill.id))}/>}
        <span>{skill.name}{skill.category&&<span className="text-muted-foreground"> · {skill.category}</span>}</span>
      </label>)}
      {!matches.length&&<p className="text-sm text-muted-foreground">{skills.length?'No skills match this search.':'No skills have been added. Ask HR to add catalogue skills.'}</p>}
    </div>
    {selected&&selected.length>0&&<p className="text-sm">Selected: {selected.map(id=>skills.find(s=>s.id===id)?.name||`Unavailable skill #${id}`).join(', ')}</p>}
    {canCreate&&<fieldset disabled={disabled||create.isPending} className="space-y-2 rounded-md border p-3"><legend className="px-1 text-sm font-medium">Add a catalogue skill</legend>
      <label className="grid gap-1 text-sm">Skill name<Input value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="First aid"/></label>
      <label className="grid gap-1 text-sm">Category (optional)<Input value={category} maxLength={80} onChange={e=>setCategory(e.target.value)} placeholder="Safety"/></label>
      <Button type="button" variant="outline" disabled={name.trim().length<2||create.isPending} onClick={()=>create.mutate()}>{create.isPending?'Adding…':'Add skill'}</Button>
      <p className="text-xs text-muted-foreground">Adding a skill does not grant it to an employee or automatically select it for a shift.</p>
    </fieldset>}
  </div>;
}

function wallTime(value:string,zone:string) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function QualificationDialog({employee,onClose,zone}:{employee:{id:number;name:string};onClose:()=>void;zone:string}) {
  const cache=useQueryClient(),{toast}=useToast();
  const url=`/api/workforce/employees/${employee.id}/qualifications`;
  const records=useQuery<WorkforceQualification[]>({queryKey:[url]});
  const catalogue=useQuery<WorkforceSkill[]>({queryKey:['/api/workforce/skills']});
  const [skillId,setSkillId]=useState(''),[level,setLevel]=useState('3'),[expiry,setExpiry]=useState(''),[noExpiry,setNoExpiry]=useState(false);
  const [original,setOriginal]=useState<WorkforceQualification|null>(null);
  function choose(value:string) {
    const record=records.data?.find(r=>r.skillId===Number(value))??null;
    setSkillId(value);setOriginal(record);setLevel(String(record?.proficiencyLevel??3));
    setNoExpiry(!!record&&!record.certificationExpiry);setExpiry(record?.certificationExpiry?wallTime(record.certificationExpiry,zone):'');
  }
  const save=useMutation({mutationFn:()=>{
    const certificationExpiry=noExpiry?null:original?.certificationExpiry&&expiry===wallTime(original.certificationExpiry,zone)?original.certificationExpiry:siteTimeToIso(expiry,zone);
    return apiJson(url,{method:'POST',body:{skillId:Number(skillId),proficiencyLevel:Number(level),certificationExpiry,expectedUpdatedAt:original?.updatedAt??null}});
  },onSuccess:async()=>{await cache.invalidateQueries({queryKey:[url]});setSkillId('');setOriginal(null);toast({title:'Qualification saved'});},
  onError:error=>toast({title:'Unable to save qualification',description:error.message,variant:'destructive'})});
  return <Dialog open onOpenChange={open=>{if(!open&&!save.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-auto"><DialogHeader>
    <DialogTitle>Qualifications · {employee.name}</DialogTitle><DialogDescription>Record skills verified by HR. Expiry times use {zone}. Changes affect new offers and acceptance checks; review already accepted shifts separately.</DialogDescription>
  </DialogHeader>
    {records.isLoading||catalogue.isLoading?<p>Loading qualifications…</p>:records.error||catalogue.error?<div role="alert"><p>Unable to load qualifications or the skill catalogue.</p><Button variant="outline" onClick={()=>{void records.refetch();void catalogue.refetch();}}>Try again</Button></div>:<>
      <div className="space-y-2">{records.data?.map(record=><div key={record.id} className="rounded-md border p-3 text-sm"><p className="font-medium">{record.name} · Level {record.proficiencyLevel}/5</p><p>{record.certificationExpiry?`${new Date(record.certificationExpiry)<=new Date()?'Expired':'Valid until'} ${wallTime(record.certificationExpiry,zone).replace('T',' ')} (${zone})`:'No expiry recorded'}</p><Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={()=>choose(String(record.skillId))}>Edit {record.name}</Button></div>)}{!records.data?.length&&<p className="text-sm text-muted-foreground">No qualifications recorded.</p>}</div>
      <form className="space-y-3" onSubmit={e=>{e.preventDefault();save.mutate();}}><fieldset disabled={save.isPending} className="space-y-3">
        <label className="grid gap-1 text-sm">Qualification skill<select className={selectClass} value={skillId} onChange={e=>choose(e.target.value)} required><option value="">Choose skill…</option>{catalogue.data?.map(skill=><option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
        {!catalogue.data?.length&&<p className="text-sm">Add skills using Skills catalogue in the team workspace first.</p>}
        <label className="grid gap-1 text-sm">Proficiency level<select className={selectClass} value={level} onChange={e=>setLevel(e.target.value)}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n} / 5</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={noExpiry} onChange={e=>setNoExpiry(e.target.checked)}/>This skill has no expiry</label>
        {!noExpiry&&<label className="grid gap-1 text-sm">Valid until ({zone})<Input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} required/></label>}
        <p className="text-xs text-muted-foreground">Shift requirements check that the skill is recorded and remains valid until the shift ends. They do not impose a minimum proficiency level.</p>
        <div className="flex gap-2"><Button disabled={!skillId||save.isPending} type="submit">{save.isPending?'Saving…':'Save qualification'}</Button><Button type="button" variant="outline" onClick={()=>{setSkillId('');setOriginal(null);void records.refetch();}}>Reload qualifications</Button></div>
      </fieldset></form>
    </>}
  </DialogContent></Dialog>;
}
