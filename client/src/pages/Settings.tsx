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
export default function Settings(){
 const {user,logout}=useAuth(),{toast}=useToast(),cache=useQueryClient();
 const admin=user?.role==='admin'||user?.role==='super_admin';
 const {data,error}=useQuery<CompanySettings>({queryKey:['/api/settings/company']});
 const {data:integrations}=useQuery<{email:boolean;documents:boolean;timezone:string}>({queryKey:['/api/settings/integrations'],enabled:admin});
 const [form,setForm]=useState(defaultCompanySettings),[password,setPassword]=useState({currentPassword:'',newPassword:'',confirmPassword:''});
 useEffect(()=>{if(data)setForm(data);},[data]);
 const save=useMutation({mutationFn:()=>apiJson('/api/settings/company',{method:'PUT',body:form}),onSuccess:()=>{cache.invalidateQueries({queryKey:['/api/settings/company']});toast({title:'Settings saved'});},onError:error=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 const changePassword=useMutation({mutationFn:()=>apiJson('/api/auth/change-password',{method:'POST',body:password}),onSuccess:async()=>{toast({title:'Password changed',description:'Sign in again with your new password.'});await logout();},onError:error=>toast({title:'Unable to change password',description:error.message,variant:'destructive'})});
 return <div className="space-y-6"><Card><CardHeader><CardTitle>Company settings</CardTitle></CardHeader><CardContent>
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
 </CardContent></Card>
 {admin&&<CalculationRules/>}
 {admin&&<Card><CardHeader><CardTitle>Service configuration</CardTitle></CardHeader><CardContent className="space-y-2"><p>Resend email: {integrations?.email?'Configured':'Not configured'}</p><p>Private document storage: {integrations?.documents?'Configured':'Not configured'}</p><p>Attendance timezone: {integrations?.timezone || 'Loading…'}</p><p className="text-sm text-muted-foreground">Credentials and APP_TIMEZONE are configured on the server. WhatsApp and bank submission integrations are pending.</p></CardContent></Card>}
 <Card><CardHeader><CardTitle>Change password</CardTitle></CardHeader><CardContent><form className="max-w-md space-y-3" onSubmit={e=>{e.preventDefault();if(password.newPassword!==password.confirmPassword){toast({title:'Passwords do not match',variant:'destructive'});return;}changePassword.mutate();}}>{(['currentPassword','newPassword','confirmPassword'] as const).map(key=><label className="block" key={key}>{({currentPassword:'Current password',newPassword:'New password',confirmPassword:'Confirm new password'})[key]}<Input required type="password" minLength={key==='currentPassword'?1:12} autoComplete={key==='currentPassword'?'current-password':'new-password'} value={password[key]} onChange={e=>setPassword({...password,[key]:e.target.value})}/></label>)}<Button type="submit" disabled={changePassword.isPending}>Change password</Button></form></CardContent></Card>
 </div>;
}
