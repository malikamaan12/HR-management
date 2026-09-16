import {format} from 'date-fns';
import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {apiJson,queryClient} from '@/lib/queryClient';
import {csvCell} from '@shared/money';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
const reports={'employee-headcount':'Employee headcount','attendance-summary':'Attendance summary','turnover-rate':'Employee turnover','leave-utilization':'Leave utilization','event-staff-cost':'Event staffing cost estimate','compliance-status':'Document compliance'};
const label=(value:string)=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
function flatten(value:unknown,path=''):Array<[string,string]>{
 if(Array.isArray(value))return value.flatMap((item,index)=>flatten(item,`${path} / ${index+1}`));
 if(value!==null&&typeof value==='object')return Object.entries(value).flatMap(([key,item])=>flatten(item,path?`${path} / ${label(key)}`:label(key)));
 return [[path,value==null?'—':String(value)]];
}
function ReportValue({value}:{value:unknown}){
 if(Array.isArray(value)){
  if(!value.length)return <p className="text-muted-foreground">No records.</p>;
  if(value.every(item=>item&&typeof item==='object'&&!Array.isArray(item))){const columns=Array.from(new Set(value.flatMap(item=>Object.keys(item))));return <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{columns.map(key=><th className="text-left p-2" key={key}>{label(key)}</th>)}</tr></thead><tbody>{value.map((item,index)=><tr key={index} className="border-t">{columns.map(key=><td className="p-2 align-top" key={key}><ReportValue value={(item as Record<string,unknown>)[key]}/></td>)}</tr>)}</tbody></table></div>;}
  return <ul>{value.map((item,index)=><li key={index}><ReportValue value={item}/></li>)}</ul>;
 }
 if(value!==null&&typeof value==='object')return <dl className="space-y-3">{Object.entries(value).map(([key,item])=><div key={key}><dt className="font-medium">{label(key)}</dt><dd><ReportValue value={item}/></dd></div>)}</dl>;
 return <span>{value==null?'—':typeof value==='boolean'?value?'Yes':'No':String(value)}</span>;
}
export default function Reports(){
 const [report,setReport]=useState<keyof typeof reports>('employee-headcount'),[department,setDepartment]=useState(''),[site,setSite]=useState(''),[teamId,setTeamId]=useState(''),[start,setStart]=useState(`${new Date().getFullYear()}-01-01`),[end,setEnd]=useState(format(new Date(),'yyyy-MM-dd')), [viewName,setViewName]=useState('');
 const views=useQuery<any[]>({queryKey:['/api/reporting/saved-views']});
 const generate=useMutation({mutationFn:()=>{const params=new URLSearchParams({startDate:start,endDate:end,year:start.slice(0,4)});if(department.trim())params.set('department',department.trim());if(site.trim())params.set('site',site.trim());if(teamId.trim())params.set('teamId',teamId.trim());return apiJson<unknown>(`/api/reporting/${report}?${params}`);}});
 const saveView=useMutation({mutationFn:()=>apiJson('/api/reporting/saved-views',{method:'POST',data:{name:viewName,queryDefinition:{report,department,site,teamId,start,end}}}),onSuccess:()=>{setViewName('');queryClient.invalidateQueries({queryKey:['/api/reporting/saved-views']});}});
 const deleteView=useMutation({mutationFn:(id:number)=>apiJson(`/api/reporting/saved-views/${id}`,{method:'DELETE'}),onSuccess:()=>queryClient.invalidateQueries({queryKey:['/api/reporting/saved-views']})});
 const loadView=(view:any)=>{const settings=view.queryDefinition||{};if(settings.report)setReport(settings.report);setDepartment(settings.department||'');setSite(settings.site||'');setTeamId(settings.teamId||'');setStart(settings.start||start);setEnd(settings.end||end);};
 const download=()=>{const rows=[['Field','Value'],...flatten(generate.data)];const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=report+'.csv';link.click();URL.revokeObjectURL(url);};
 return <Card><CardHeader><CardTitle>Reports</CardTitle></CardHeader><CardContent className="space-y-6"><form className="flex flex-wrap gap-4 items-end" onSubmit={e=>{e.preventDefault();generate.mutate();}}>
 <label>Report<select className="block border rounded p-2" value={report} onChange={e=>{setReport(e.target.value as keyof typeof reports);generate.reset();}}>{Object.entries(reports).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
 <label>Department (optional)<Input value={department} onChange={e=>setDepartment(e.target.value)}/></label><label>Site / location (optional)<Input value={site} onChange={e=>setSite(e.target.value)}/></label><label>Team ID (optional)<Input value={teamId} onChange={e=>setTeamId(e.target.value)} inputMode="numeric"/></label><label>From<Input type="date" required value={start} onChange={e=>setStart(e.target.value)}/></label><label>To<Input type="date" min={start} required value={end} onChange={e=>setEnd(e.target.value)}/></label><Button disabled={generate.isPending}>Generate report</Button>
 </form><div className="flex flex-wrap items-end gap-3"><label className="min-w-60">Save this view<Input placeholder="View name" value={viewName} onChange={e=>setViewName(e.target.value)}/></label><Button type="button" variant="outline" disabled={!viewName.trim()||saveView.isPending} onClick={()=>saveView.mutate()}>Save view</Button></div>{views.data?.length?<div className="space-y-2"><p className="text-sm font-medium">Saved views</p><div className="flex flex-wrap gap-2">{views.data.map(view=><div key={view.id} className="flex items-center gap-1 rounded-md border px-2 py-1"><Button type="button" size="sm" variant="ghost" onClick={()=>loadView(view)}>{view.name}</Button><Button type="button" size="sm" variant="ghost" onClick={()=>deleteView.mutate(view.id)} aria-label={`Delete ${view.name}`}>×</Button></div>)}</div></div>:null}<p className="text-sm text-muted-foreground">Headcount and document compliance show current records. Attendance, turnover and event estimates use the date range. Leave utilization uses the selected start year. Attendance rows include status, work minutes, overtime and location for drill-down. Team ID filters attendance to accepted assignments for that team.</p>
 {generate.isPending&&<p>Generating report…</p>}{generate.error&&<p role="alert">{generate.error.message}</p>}
 {generate.data!==undefined&&<><div className="flex gap-3"><Button variant="outline" onClick={download}>Download CSV</Button><Button variant="outline" onClick={()=>window.print()}>Print / save PDF</Button></div><ReportValue value={generate.data}/></>}
 </CardContent></Card>;
}
