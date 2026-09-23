import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {officeScheduleSummary,type CompanySettings as CompanySettingsData} from '@shared/settings';
import {apiJson} from '@/lib/queryClient';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';

export default function CompanySettings(){
 const query=useQuery<CompanySettingsData>({queryKey:['/api/settings/company']});
 if(query.isLoading)return <p role="status">Loading company settings...</p>;
 if(query.error||!query.data)return <div role="alert" className="space-y-3"><p>Unable to load company settings.</p><Button variant="outline" onClick={()=>query.refetch()}>Try again</Button></div>;
 return <CompanyForm data={query.data}/>;
}
function CompanyForm({data}:{data:CompanySettingsData}){
 const {toast}=useToast(),cache=useQueryClient();
 const [form,setForm]=useState(data);
 const save=useMutation({mutationFn:()=>apiJson<CompanySettingsData>('/api/settings/company',{method:'PUT',body:form}),onSuccess:()=>{cache.invalidateQueries({queryKey:['/api/settings/company']});toast({title:'Settings saved'});},onError:error=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 return <Card><CardHeader><CardTitle>Company & office calendar</CardTitle></CardHeader><CardContent>
  <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate();}}>
   {(['companyName','companyEmail','companyPhone','companyAddress'] as const).map(key=><label className="space-y-1" key={key}><span>{({companyName:'Company name',companyEmail:'Company email',companyPhone:'Company phone',companyAddress:'Company address'})[key]}</span><Input disabled={save.isPending} required={key==='companyName'} type={key==='companyEmail'?'email':'text'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label>Document expiry reminder window (days)<Input type="number" min={1} max={365} disabled={save.isPending} value={form.documentExpiryDays} onChange={e=>setForm({...form,documentExpiryDays:Number(e.target.value)})}/></label>
   <fieldset><legend>Default non-working days for leave calculation</legend><div className="flex flex-wrap gap-3">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index)=><label key={day}><input type="checkbox" disabled={save.isPending} checked={form.weekendDays.includes(index)} onChange={e=>setForm({...form,weekendDays:e.target.checked?[...form.weekendDays,index]:form.weekendDays.filter(value=>value!==index)})}/> {day}</label>)}</div><p className="text-sm text-muted-foreground mt-2">Used when the employee is not assigned to the management office calendar. Shift-specific leave calendars are a separate workflow.</p></fieldset>
   <fieldset className="sm:col-span-2 rounded-md border p-4 space-y-4"><legend className="px-2 font-semibold">Management office schedule</legend>
    <p className="text-sm">{officeScheduleSummary(form.managementOfficeSchedule)}</p>
    <div className="flex flex-wrap gap-3">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index)=><label key={day} className="flex items-center gap-1"><input type="checkbox" aria-label={`Office ${day}`} disabled={save.isPending} checked={form.managementOfficeSchedule.workingDays.includes(index)} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,workingDays:e.target.checked?[...form.managementOfficeSchedule.workingDays,index]:form.managementOfficeSchedule.workingDays.filter(value=>value!==index)}})}/>{day}</label>)}</div>
    <div className="grid gap-4 sm:grid-cols-2"><label>Office start time<Input type="time" required disabled={save.isPending} value={form.managementOfficeSchedule.startTime} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,startTime:e.target.value}})}/></label><label>Office end time<Input type="time" required disabled={save.isPending} value={form.managementOfficeSchedule.endTime} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,endTime:e.target.value}})}/></label></div>
    <p className="text-sm text-muted-foreground">Assign “Management office” in an employee's Employment tab to use this calendar. Times use {form.managementOfficeSchedule.timezone}. Recorded breaks and payroll rules are configured separately.</p>
   </fieldset>
   <Button type="submit" disabled={save.isPending}>{save.isPending?'Saving...':'Save company settings'}</Button>
  </form>

 </CardContent></Card>;
}
