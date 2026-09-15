import {OperationalPolicies} from '@/components/operations/Policies';
import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {calculationRulesSchema,ruleScopes,ruleScopeLabels,type RuleScope,type CalculationRules as Rules,type CalculationSnapshot} from '@shared/calculation-rules';
import {apiJson} from '@/lib/queryClient';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useToast} from '@/hooks/use-toast';

type Version={id:number;scope:RuleScope;effectiveFrom:string;rules:Rules;reason:string;createdBy:number;createdAt:string};
type Data={today:string;active:CalculationSnapshot;history:Version[];latestVersion:number};
type PreviewResult={attendance:{calculatedMinutes:number};timesheets:{calculatedMinutes:number};leave:{totalDays:number};payroll:{netSalary:string;roundingAdjustmentCents:number}};
type Preview={current:PreviewResult;proposed:PreviewResult;currentVersion:number};
const selectClass='block w-full rounded-md border bg-background p-2 mt-1';
export default function CalculationRules(){
 const [scope,setScope]=useState<RuleScope>('management_office');
 return <Card><CardHeader><CardTitle>Rules &amp; calculations</CardTitle></CardHeader><CardContent className="space-y-5">
  <p>Admin and Super Admin can publish calculation policies. Each attendance record, leave request, payroll draft and timesheet keeps the rules used when it was created.</p>
  <label className="block max-w-md font-medium">Employee policy group<select className={selectClass} value={scope} onChange={e=>setScope(e.target.value as RuleScope)}>{ruleScopes.map(s=><option key={s} value={s}>{ruleScopeLabels[s]}</option>)}</select></label>
  <RulesEditor key={scope} scope={scope}/><OperationalPolicies/>
 </CardContent></Card>;
}
function RulesEditor({scope}:{scope:RuleScope}){
 const {toast}=useToast(),cache=useQueryClient(),key=`/api/settings/calculation-rules?scope=${scope}`;
 const {data,isLoading,error,refetch}=useQuery<Data>({queryKey:[key]});
 const [rules,setRules]=useState<Rules|null>(null),[expectedVersion,setExpectedVersion]=useState<number|null>(null),[effectiveFrom,setEffectiveFrom]=useState(''),[reason,setReason]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[sample,setSample]=useState({date:'',leaveEnd:'',elapsedMinutes:480,breakMinutes:30,basicSalary:'1000.03',allowance:'200.00',deduction:'50.00'});
 const [holidayDate,setHolidayDate]=useState(''),[holidayName,setHolidayName]=useState('');
 function load(value:Data){setRules(structuredClone(value.active.rules));setExpectedVersion(value.latestVersion);setEffectiveFrom(value.today);setReason('');setPreview(null);setSample(s=>({...s,date:value.today,leaveEnd:value.today}));}
 useEffect(()=>{if(data&&expectedVersion===null)load(data);},[data,expectedVersion]);
 const edit=(next:Rules)=>{setRules(next);setPreview(null);};
 const fail=(error:Error)=>toast({title:'Unable to complete request',description:error.message,variant:'destructive'});
 const simulate=useMutation({mutationFn:()=>apiJson<Preview>('/api/settings/calculation-rules/preview',{method:'POST',body:{scope,rules:calculationRulesSchema.parse(rules),date:sample.date,leaveEnd:sample.leaveEnd,elapsedMinutes:sample.elapsedMinutes,breakMinutes:sample.breakMinutes,basicSalary:sample.basicSalary,allowances:{sample:sample.allowance},deductions:{sample:sample.deduction}}}),onSuccess:setPreview,onError:fail});
 const publish=useMutation({mutationFn:()=>apiJson('/api/settings/calculation-rules',{method:'POST',body:{scope,rules:calculationRulesSchema.parse(rules),effectiveFrom,reason,expectedVersion}}),onSuccess:async()=>{await cache.invalidateQueries({queryKey:[key]});const result=await refetch();if(result.data)load(result.data);toast({title:'Calculation rules published',description:'Existing records keep their original calculations.'});},onError:fail});
 if(isLoading||(!rules&&!error))return <p>Loading calculation rules…</p>;
 if(error||!rules||!data)return <p role="alert">Unable to load calculation rules. <Button variant="outline" onClick={()=>refetch()}>Try again</Button></p>;
 const update=<K extends keyof Rules>(section:K,value:Partial<Rules[K]>)=>edit({...rules,[section]:{...rules[section],...value}});
 const changeSample=(values:Partial<typeof sample>)=>{setSample({...sample,...values});setPreview(null);};
 return <fieldset disabled={simulate.isPending||publish.isPending} className="space-y-6 min-w-0">
  <div className="rounded-md bg-muted p-3 text-sm">Active today: {data.active.version?`version ${data.active.version}, effective ${data.active.effectiveFrom}`:'baseline rules (no published changes)'}. {data.history.some(v=>v.effectiveFrom>data.today)&&'Future versions are scheduled; check the history below.'}
   <p>Working days and management hours come from Company settings above and are saved with each new record. Payroll selects the policy effective on the first day of its monthly period; leave uses the request start date and timesheets use the shift start date.</p>
  </div>
  {expectedVersion!==data.latestVersion&&<p role="alert">A newer version was published while you were editing. Reload the rules before publishing.</p>}
  <Button variant="outline" onClick={async()=>{const result=await refetch();if(result.data)load(result.data);}}>Reload active rules</Button>
  <div className="grid gap-6 lg:grid-cols-2">
   <fieldset className="border rounded-md p-4 space-y-3"><legend className="px-2 font-medium">Attendance</legend>
    <TimeControls title="Attendance" rule={rules.attendance} onChange={value=>update('attendance',value)}/>
    {scope==='management_office'&&<label className="block">Late arrival grace (minutes)<Input type="number" min={0} max={120} placeholder="Disabled" value={rules.attendance.lateGraceMinutes??''} onChange={e=>update('attendance',{lateGraceMinutes:e.target.value===''?null:Number(e.target.value)})}/><span className="text-sm text-muted-foreground">Blank disables automatic late status. This does not deduct pay.</span></label>}
   </fieldset>
   <fieldset className="border rounded-md p-4 space-y-3"><legend className="px-2 font-medium">Leave duration</legend>
    <label className="block">Day-count method<select className={selectClass} value={rules.leave.countMethod} onChange={e=>update('leave',{countMethod:e.target.value as Rules['leave']['countMethod']})}><option value="working_days">Working days from employee calendar</option><option value="calendar_days">All calendar days</option></select></label>
    <label className="block">Maximum calendar days per request<Input type="number" min={1} max={367} value={rules.leave.maxCalendarDays} onChange={e=>update('leave',{maxCalendarDays:Number(e.target.value)})}/></label>
    <label className="flex gap-2"><input type="checkbox" checked={rules.leave.excludeHolidays} onChange={e=>update('leave',{excludeHolidays:e.target.checked})}/>Exclude listed holidays from leave</label>
    <label className="flex gap-2"><input type="checkbox" checked={rules.leave.allowHalfDays??false} onChange={e=>update('leave',{allowHalfDays:e.target.checked})}/>Allow single-date half-day requests</label><p className="text-sm">Accrual and carryover policies are configured below. Half-day leave conservatively blocks workforce offers for that date.</p>
   </fieldset>
   <fieldset className="border rounded-md p-4 space-y-3"><legend className="px-2 font-medium">Payroll totals</legend>
    <p className="text-sm">Net salary = basic salary + allowances − deductions. Rounding is applied once to the final total and recorded as an adjustment.</p>
    <label className="block">Payroll rounding unit<select className={selectClass} value={rules.payroll.roundingCents} onChange={e=>update('payroll',{roundingCents:Number(e.target.value) as Rules['payroll']['roundingCents']})}>{[1,5,10,100].map(n=><option key={n} value={n}>QAR {(n/100).toFixed(2)}</option>)}</select></label>
    <RoundingMode title="Payroll" value={rules.payroll.roundingMode} onChange={value=>update('payroll',{roundingMode:value})}/>
    <p className="text-sm text-muted-foreground">Approved timesheet earnings use the hourly and per-timesheet overtime policy below. Salary proration and automatic absence deductions remain separate pending workflows.</p>
   </fieldset>
   <fieldset className="border rounded-md p-4 space-y-3"><legend className="px-2 font-medium">Event / FEC timesheets</legend>
    <label className="block">Payable time method<select className={selectClass} value={rules.timesheets.payableMethod} onChange={e=>update('timesheets',{payableMethod:e.target.value as Rules['timesheets']['payableMethod']})}><option value="reviewer">Reviewer enters payable minutes with a policy reference</option><option value="calculated">Calculate payable minutes from recorded time</option></select></label>
    <TimeControls title="Timesheet" rule={rules.timesheets} onChange={value=>update('timesheets',value)}/>
    <p className="text-sm text-muted-foreground">Time rules are a suggestion in reviewer mode and determine payable minutes in calculated mode. An independent reviewer must still approve the timesheet.</p>
   </fieldset>
  </div>
  <fieldset className="border rounded-md p-4 space-y-3"><legend className="px-2 font-medium">Holiday dates for this policy group</legend>
   <div className="flex flex-wrap items-end gap-3"><label>Holiday date<Input type="date" value={holidayDate} onChange={e=>setHolidayDate(e.target.value)}/></label><label>Holiday name<Input value={holidayName} maxLength={120} onChange={e=>setHolidayName(e.target.value)}/></label><Button variant="outline" disabled={!holidayDate||!holidayName.trim()} onClick={()=>{const next={...rules.leave,holidays:[...rules.leave.holidays,{date:holidayDate,name:holidayName.trim()}]};const checked=calculationRulesSchema.safeParse({...rules,leave:next});if(!checked.success){toast({title:'Check holiday',description:checked.error.issues[0].message,variant:'destructive'});return;}update('leave',next);setHolidayName('');setHolidayDate('');}}>Add holiday to draft</Button></div>
   {rules.leave.holidays.length===0?<p className="text-sm">No holiday dates configured.</p>:<ul className="space-y-2">{rules.leave.holidays.map(h=><li key={h.date} className="flex items-center justify-between gap-3"><span>{h.date} — {h.name}</span><Button variant="outline" onClick={()=>update('leave',{holidays:rules.leave.holidays.filter(v=>v.date!==h.date)})}>Remove {h.name}</Button></li>)}</ul>}
  </fieldset>
  <fieldset className="border rounded-md p-4 space-y-4"><legend className="px-2 font-medium">Preview before publishing</legend>
   <p className="text-sm">Compare a sample using the saved policy and your proposed rules. Preview does not create HR records.</p>
   <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <label>Sample start date<Input type="date" value={sample.date} onChange={e=>changeSample({date:e.target.value})}/></label><label>Sample leave end<Input type="date" value={sample.leaveEnd} onChange={e=>changeSample({leaveEnd:e.target.value})}/></label>
    <label>Elapsed minutes<Input type="number" min={1} max={1440} value={sample.elapsedMinutes} onChange={e=>changeSample({elapsedMinutes:Number(e.target.value)})}/></label><label>Break minutes<Input type="number" min={0} max={1440} value={sample.breakMinutes} onChange={e=>changeSample({breakMinutes:Number(e.target.value)})}/></label>
    <label>Sample basic salary (QAR)<Input value={sample.basicSalary} onChange={e=>changeSample({basicSalary:e.target.value})}/></label><label>Sample allowances (QAR)<Input value={sample.allowance} onChange={e=>changeSample({allowance:e.target.value})}/></label><label>Sample deductions (QAR)<Input value={sample.deduction} onChange={e=>changeSample({deduction:e.target.value})}/></label>
   </div>
   <Button variant="outline" disabled={simulate.isPending} onClick={()=>simulate.mutate()}>Preview calculations</Button>
   {preview&&<table className="w-full text-sm text-left"><thead><tr><th>Calculation</th><th>Saved policy</th><th>Proposed rules</th></tr></thead><tbody>{[
    ['Attendance minutes',preview.current.attendance.calculatedMinutes,preview.proposed.attendance.calculatedMinutes],['Timesheet payable suggestion',preview.current.timesheets.calculatedMinutes,preview.proposed.timesheets.calculatedMinutes],['Leave days',preview.current.leave.totalDays,preview.proposed.leave.totalDays],['Net salary (QAR)',preview.current.payroll.netSalary,preview.proposed.payroll.netSalary],['Payroll rounding adjustment (QAR)',(preview.current.payroll.roundingAdjustmentCents/100).toFixed(2),(preview.proposed.payroll.roundingAdjustmentCents/100).toFixed(2)]
    ].map(([name,before,after])=><tr className="border-t" key={name}><td className="py-2">{name}</td><td>{before}</td><td>{after}</td></tr>)}</tbody></table>}
  </fieldset>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(preview)publish.mutate();}}>
   <label className="block max-w-xs">Effective from (Qatar date)<Input required type="date" min={data.today} value={effectiveFrom} onChange={e=>setEffectiveFrom(e.target.value)}/></label>
   <label className="block">Reason for change<Input required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain the approved business policy"/></label>
   <p className="text-sm text-muted-foreground">Publishing creates an immutable version. A later publication on the same effective date takes precedence for new records. To restore older rules, copy that version below and publish it with a new effective date.</p>
   <Button disabled={!preview||publish.isPending||simulate.isPending||expectedVersion!==data.latestVersion}>Publish calculation rules</Button>
  </form>
  <div className="space-y-3"><h3 className="font-semibold">Published history (latest 100)</h3>{data.history.length===0?<p>No policy versions published yet.</p>:data.history.map(v=><details className="rounded-md border p-3" key={v.id}><summary className="cursor-pointer">Version {v.id} · effective {v.effectiveFrom} · {v.effectiveFrom>data.today?'Scheduled':v.id===data.active.version?'Active today':'Earlier publication'}</summary><p className="py-2">{v.reason}</p><p className="text-sm">Published by account #{v.createdBy} at {new Date(v.createdAt).toLocaleString()}</p><pre className="max-h-64 overflow-auto text-xs py-3">{JSON.stringify(v.rules,null,2)}</pre><Button variant="outline" onClick={()=>{edit(structuredClone(v.rules));setReason(`Restore rules from version ${v.id}`);}}>Copy version {v.id} to draft</Button></details>)}</div>
 </fieldset>;
}
function RoundingMode({title,value,onChange}:{title:string;value:'nearest'|'up'|'down';onChange:(v:'nearest'|'up'|'down')=>void}){
 return <label className="block">{title} rounding direction<select className={selectClass} value={value} onChange={e=>onChange(e.target.value as typeof value)}><option value="nearest">Nearest (half rounds up)</option><option value="down">Round down</option><option value="up">Round up</option></select></label>;
}
function TimeControls({title,rule,onChange}:{title:string;rule:Rules['timesheets']|Rules['attendance'];onChange:(v:Partial<Rules['timesheets']>)=>void}){
 return <><label className="block">{title} break treatment<select className={selectClass} value={rule.breakTreatment} onChange={e=>onChange({breakTreatment:e.target.value as 'unpaid'|'paid'})}><option value="unpaid">Subtract recorded breaks</option><option value="paid">Include recorded breaks</option></select></label>
  <label className="block">{title} rounding interval<select className={selectClass} value={rule.roundingMinutes} onChange={e=>onChange({roundingMinutes:Number(e.target.value) as Rules['timesheets']['roundingMinutes']})}>{[1,5,10,15,30].map(n=><option value={n} key={n}>{n} minute{n===1?'':'s'}</option>)}</select></label>
  <RoundingMode title={title} value={rule.roundingMode} onChange={roundingMode=>onChange({roundingMode})}/></>;
}
