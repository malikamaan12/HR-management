import BrandingSettings from '@/components/BrandingSettings';
import AccountPassword from '@/components/AccountPassword';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {useEffect,useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {defaultCompanySettings,officeScheduleSummary,type CompanySettings} from '@shared/settings';
import {apiJson} from '@/lib/queryClient';
import {useAuth} from '@/contexts/AuthContext';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';
import CalculationRules from '@/components/CalculationRules';
import SystemReadiness from '@/components/hr/SystemReadiness';
import {PageHeading} from '@/components/ux/WorkspaceUI';
export default function Settings(){
 const {user}=useAuth(),{toast}=useToast(),cache=useQueryClient();
 const admin=user?.role==='admin'||user?.role==='super_admin';
 const {data,error}=useQuery<CompanySettings>({queryKey:['/api/settings/company']});
 const [form,setForm]=useState(defaultCompanySettings);
 useEffect(()=>{if(data)setForm(data);},[data]);
 const save=useMutation({mutationFn:()=>apiJson('/api/settings/company',{method:'PUT',body:form}),onSuccess:()=>{cache.invalidateQueries({queryKey:['/api/settings/company']});toast({title:'Settings saved'});},onError:error=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 return <div className="space-y-5"><PageHeading title="Settings" description="Company details, appearance and system preferences."/><Tabs defaultValue="company" className="space-y-6"><TabsList><TabsTrigger value="company">Company</TabsTrigger>{admin&&<><TabsTrigger value="branding">Branding</TabsTrigger><TabsTrigger value="rules">Calculation rules</TabsTrigger><TabsTrigger value="services">System readiness</TabsTrigger></>}<TabsTrigger value="password">Password</TabsTrigger></TabsList><TabsContent value="company"><Card><CardHeader><CardTitle>Company settings</CardTitle></CardHeader><CardContent>
  {admin&&<p className="mb-4"><a className="text-primary underline" href="/hr-rules">Configure attendance, leave and payroll rules by employee and effective date</a></p>}
  {error&&<p role="alert">Unable to load company settings.</p>}
  <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();save.mutate();}}>
   {(['companyName','companyEmail','companyPhone','companyAddress'] as const).map(key=><label className="space-y-1" key={key}><span>{({companyName:'Company name',companyEmail:'Company email',companyPhone:'Company phone',companyAddress:'Company address'})[key]}</span><Input disabled={!admin} required={key==='companyName'} type={key==='companyEmail'?'email':'text'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label>Document expiry reminder window (days)<Input type="number" min={1} max={365} disabled={!admin} value={form.documentExpiryDays} onChange={e=>setForm({...form,documentExpiryDays:Number(e.target.value)})}/></label>
   <fieldset><legend>Default non-working days for leave calculation</legend><div className="flex flex-wrap gap-3">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,index)=><label key={day}><input type="checkbox" disabled={!admin} checked={form.weekendDays.includes(index)} onChange={e=>setForm({...form,weekendDays:e.target.checked?[...form.weekendDays,index]:form.weekendDays.filter(value=>value!==index)})}/> {day}</label>)}</div><p className="text-sm text-muted-foreground mt-2">Used when the employee is not assigned to the management office calendar. Shift-specific leave calendars are a separate workflow.</p></fieldset>
   <fieldset className="sm:col-span-2 rounded-md border p-4 space-y-4"><legend className="px-2 font-semibold">Management office schedule</legend>
    <p className="text-sm">{officeScheduleSummary(form.managementOfficeSchedule)}</p>
    <div className="flex flex-wrap gap-3">{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,index)=><label key={day} className="flex items-center gap-1"><input type="checkbox" aria-label={`Office ${day}`} disabled={!admin} checked={form.managementOfficeSchedule.workingDays.includes(index)} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,workingDays:e.target.checked?[...form.managementOfficeSchedule.workingDays,index]:form.managementOfficeSchedule.workingDays.filter(value=>value!==index)}})}/>{day}</label>)}</div>
    <div className="grid gap-4 sm:grid-cols-2"><label>Office start time<Input type="time" required disabled={!admin} value={form.managementOfficeSchedule.startTime} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,startTime:e.target.value}})}/></label><label>Office end time<Input type="time" required disabled={!admin} value={form.managementOfficeSchedule.endTime} onChange={e=>setForm({...form,managementOfficeSchedule:{...form.managementOfficeSchedule,endTime:e.target.value}})}/></label></div>
    <p className="text-sm text-muted-foreground">Assign “Management office” in an employee's Employment tab to use this calendar. Times use {form.managementOfficeSchedule.timezone}. Recorded breaks and payroll rules are configured separately.</p>
   </fieldset>
   {admin&&<Button type="submit" disabled={save.isPending||!!error}>Save settings</Button>}
  </form>
 </CardContent></Card></TabsContent>
 {admin&&<><TabsContent value="branding"><BrandingSettings/></TabsContent><TabsContent value="rules"><CalculationRules/></TabsContent><TabsContent value="services"><SystemReadiness/></TabsContent></>}
 <TabsContent value="password"><Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent><AccountPassword/></CardContent></Card></TabsContent>
 </Tabs></div>;
}
