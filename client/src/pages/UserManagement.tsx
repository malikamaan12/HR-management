import {MetricCard,StatusPill} from '@/components/ux/ModuleVisuals';
import {roleLabel} from '@shared/navigation';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userRoleEnum, type UserRole } from '@shared/schema';
import type { ApiEmployee } from '@/lib/api-types';
import { apiJson } from '@/lib/queryClient';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

type Account = {id:number;username:string;email:string;firstName:string;lastName:string;role:UserRole;department:string|null;isActive:boolean;approvalStatus:string;accountState:string;accountVersion:number;passwordSetupRequired:boolean};
type Provision = {employeeId:number;recordVersion?:number;employeeRef:string;name?:string;email?:string;username?:string;role?:string;status:string;setupToken?:string;expiresAt?:string};
type Setup = {username:string;email:string;setupUrl:string;expiresAt:string};
type History = {id:number;actorId:number;timestamp:string;description:string;metadata:{reason?:string}};
const blank = {username:'',email:'',firstName:'',lastName:'',password:'',role:'permanent_employee' as UserRole};
const labels:Record<string,string> = {active:'Active',frozen:'Frozen',on_hold:'On hold',revoked:'Access revoked',deleted:'Deleted'};
function setupLink(token:string) { const url=new URL('/reset-password',window.location.origin);url.hash=new URLSearchParams({token}).toString();return url.href; }
export default function UserManagement() {
 const {user}=useAuth(), {toast}=useToast(), cache=useQueryClient();
 const [overridePassword,setOverridePassword]=useState('');
 const [form,setForm]=useState(blank), [showCreate,setShowCreate]=useState(false), [search,setSearch]=useState('');
 const [selected,setSelected]=useState<Account|null>(null),[reason,setReason]=useState(''),[action,setAction]=useState('save'),[confirmed,setConfirmed]=useState(false);
 const [preview,setPreview]=useState<Provision[]|null>(null),[bulkConfirmed,setBulkConfirmed]=useState(false),[setups,setSetups]=useState<Setup[]>([]);
 const {data:accounts=[],isLoading,error}=useQuery<Account[]>({queryKey:['/api/admin/users']});
 const {data:employees=[],isLoading:employeesLoading,error:employeeError}=useQuery<ApiEmployee[]>({queryKey:['/api/employees',{limit:1000}]});
 const {data:history=[]}=useQuery<History[]>({queryKey:[`/api/admin/users/${selected?.id}/history`],enabled:!!selected});
 const mutation=useMutation({mutationFn:({url,method='POST',body}:{url:string;method?:string;body?:unknown})=>apiJson<any>(url,{method,body}),
  onSuccess:()=>{cache.invalidateQueries({queryKey:['/api/admin/users']});cache.invalidateQueries({queryKey:['/api/employees']});},
  onError:(error)=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 useEffect(()=>{if(selected)document.getElementById('account-details')?.scrollIntoView({behavior:'smooth',block:'start'});},[selected?.id]);
 const roles=userRoleEnum.enumValues.filter(role=>role!=='super_admin'||user?.role==='super_admin');
 const unlinked=employees.filter(employee=>!employee.userId);
 const canManage=(account:Account)=>account.id!==user?.userId && account.accountState!=='deleted' && (account.role!=='super_admin'||user?.role==='super_admin');
 const notify=()=>toast({title:'Account updated',description:'Existing sessions and password links were revoked.'});
 async function applyAction() {
  if(!selected)return;
  try {
   const base={accountVersion:selected.accountVersion,reason};
   if(action==='save') await mutation.mutateAsync({url:`/api/admin/users/${selected.id}`,method:'PATCH',body:{...base,username:selected.username,email:selected.email,role:selected.role,department:selected.department??''}});
   else if(action in labels) await mutation.mutateAsync({url:`/api/admin/users/${selected.id}`,method:'PATCH',body:{...base,accountState:action}});
   else {
    const result=await mutation.mutateAsync({url:`/api/admin/users/${selected.id}/${action}`,body:action==='set-password'?{...base,password:overridePassword}:base});
    if(result.setupToken)setSetups(current=>[...current.filter(row=>row.username!==selected.username),{username:accounts.find(row=>row.id===selected.id)!.username,email:accounts.find(row=>row.id===selected.id)!.email,setupUrl:setupLink(result.setupToken),expiresAt:result.expiresAt}]);
   }
   cache.invalidateQueries({queryKey:[`/api/admin/users/${selected.id}/history`]});setSelected(null);setOverridePassword('');setConfirmed(false);notify();
  } catch { /* Error toast retains the draft. */ }
 }
 function downloadSetups() {
  const url=URL.createObjectURL(new Blob([JSON.stringify(setups,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='employee-password-setup-links.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 return <div className="space-y-6"><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><h1>Account management</h1><Button variant="outline" onClick={()=>setShowCreate(!showCreate)}>Add user</Button></div><p className="text-sm text-muted-foreground">Manage sign-in access separately from employee records. Changes are audited and sign the affected user out.</p></CardHeader><CardContent className="space-y-5"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label="Accounts" value={isLoading?'…':error?'—':accounts.length}/><MetricCard label="Active access" value={isLoading?'…':error?'—':accounts.filter(a=>a.accountState==='active'&&a.isActive).length} tone="positive"/><MetricCard label="Setup pending" value={isLoading?'…':error?'—':accounts.filter(a=>a.passwordSetupRequired).length} tone="attention"/><MetricCard label="Unlinked staff" value={employeesLoading?'…':employeeError?'—':unlinked.length}/></div>
  {showCreate&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();try{await mutation.mutateAsync({url:'/api/admin/users',body:form});setForm(blank);setShowCreate(false);toast({title:'Account created'});}catch{}}}>
   {(['username','email','firstName','lastName','password'] as const).map(key=><label key={key}>{({username:'Username',email:'Email',firstName:'First name',lastName:'Last name',password:'Initial password (12–72 characters)'})[key]}<Input required type={key==='password'?'password':key==='email'?'email':'text'} minLength={key==='password'?12:1} maxLength={key==='password'?72:254} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} autoComplete={key==='password'?'new-password':'off'}/></label>)}
   <label>Role<select className="block w-full border rounded p-2" value={form.role} onChange={e=>setForm({...form,role:e.target.value as UserRole})}>{roles.map(role=><option key={role}>{role}</option>)}</select></label>
   <Button disabled={mutation.isPending} type="submit">Create account</Button>
  </form>}
  <details className="rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Set up employee accounts{!employeesLoading&&!employeeError?` · ${unlinked.length} unlinked`: ""}</summary><div className="mt-4 space-y-3"><p className="text-sm">Use each employee’s work email as their username. Permanent staff receive permanent employee access; contract staff receive employee access; temporary staff receive temporary staff access.</p><p className="text-sm">Each employee chooses their own password using a one-time link valid for one hour. No email is sent automatically. You can generate a fresh link later.</p>
   {employeeError?<p role="alert">Employee records could not be loaded.</p>:<Button disabled={mutation.isPending||employeesLoading||!unlinked.length} onClick={async()=>{try{const result=await mutation.mutateAsync({url:'/api/admin/users/provision-employees',body:{employeeIds:unlinked.map(e=>e.id),preview:true}});setPreview(result.accounts);setBulkConfirmed(false);}catch{}}}>Review {unlinked.length} unlinked employee accounts</Button>}
   {preview&&<div className="space-y-3"><div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Employee','Username / email','Role','Result'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{preview.map(row=><tr className="border-t" key={row.employeeId}><td className="p-2">{row.name} ({row.employeeRef})</td><td className="p-2">{row.email}</td><td className="p-2">{row.role}</td><td className="p-2">{row.status.replaceAll('_',' ')}</td></tr>)}</tbody></table></div>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={bulkConfirmed} onChange={e=>setBulkConfirmed(e.target.checked)}/>I reviewed these employees and their access roles.</label>
    <Button disabled={mutation.isPending||!bulkConfirmed||!preview.some(row=>row.status==='ready')} onClick={async()=>{try{const result=await mutation.mutateAsync({url:'/api/admin/users/provision-employees',body:{employeeIds:preview.map(row=>row.employeeId),preview:false,versions:Object.fromEntries(preview.filter(row=>row.recordVersion).map(row=>[String(row.employeeId),row.recordVersion]))}});const created:Provision[]=result.accounts;setSetups(current=>[...current,...created.filter(row=>row.setupToken).map(row=>({username:row.username!,email:row.email!,setupUrl:setupLink(row.setupToken!),expiresAt:row.expiresAt!}))]);setPreview(null);setBulkConfirmed(false);toast({title:`${created.filter(row=>row.status==='created').length} employee accounts created`});}catch{}}}>Create reviewed accounts</Button> <Button variant="ghost" onClick={()=>setPreview(null)}>Cancel review</Button>
   </div>}
  </div></details>
  {!!setups.length&&<section className="border rounded-lg p-4 space-y-3" aria-label="Password setup links"><h2 className="font-semibold">Password setup links ({setups.length})</h2><p className="text-sm">These links allow password setup. Share each link only with its intended employee. They expire after one hour and are shown only in this page session. Download them before leaving if needed.</p><div className="flex gap-2"><Button onClick={downloadSetups}>Download setup links</Button><Button variant="outline" onClick={()=>setSetups([])}>Hide links</Button></div>{setups.map((row,index)=><div key={index}><p className="text-sm">{row.username} · Expires {new Date(row.expiresAt).toLocaleString()}</p><Input aria-label={`Setup link for ${row.username}`} readOnly value={row.setupUrl} onFocus={e=>e.target.select()}/></div>)}</section>}
  <Input aria-label="Search accounts" placeholder="Search by name, username or email" value={search} onChange={e=>setSearch(e.target.value)}/>
  {isLoading?<p>Loading accounts…</p>:error?<p role="alert">Unable to load accounts. Administrator access is required.</p>:<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Account','Role','Access','Employee','Actions'].map(label=><th className="text-left p-3" key={label}>{label}</th>)}</tr></thead><tbody>{accounts.filter(account=>`${account.firstName} ${account.lastName} ${account.email} ${account.username}`.toLowerCase().includes(search.toLowerCase())).map(account=>{
   const linked=employees.find(employee=>employee.userId===account.id);
   return <tr className="border-t" key={account.id}><td className="p-3"><p className="font-medium">{account.firstName} {account.lastName}</p><p>{account.username}</p><p className="text-muted-foreground">{account.email}</p></td><td className="p-3">{roleLabel(account.role)}</td><td className="p-3"><StatusPill value={account.accountState}/>{account.approvalStatus!=='approved'&&<p>Pending approval</p>}{account.passwordSetupRequired&&<p className="text-muted-foreground">Password setup pending</p>}</td><td className="p-3">{linked?`${linked.firstName} ${linked.lastName} (${linked.employeeId})`:canManage(account)?<select aria-label={`Link employee to ${account.username}`} value="" disabled={mutation.isPending} onChange={async e=>{try{await mutation.mutateAsync({url:`/api/admin/users/${account.id}/link-employee`,body:{employeeId:Number(e.target.value)}});toast({title:'Employee linked'});}catch{}}}><option value="">Link employee…</option>{unlinked.map(employee=><option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.employeeId})</option>)}</select>:'Unlinked'}</td><td className="p-3"><Button variant="outline" aria-label={`Manage ${account.username}`} onClick={()=>{setSelected({...account});setReason('');setAction('save');setOverridePassword('');setConfirmed(false);}}>Manage</Button></td></tr>;
  })}</tbody></table></div>}
 </CardContent></Card>
 {selected&&<Card id="account-details"><CardHeader><CardTitle>Manage {selected.firstName} {selected.lastName}</CardTitle><p className="text-sm text-muted-foreground">{selected.username} · {labels[selected.accountState]}</p></CardHeader><CardContent className="space-y-4">
  {canManage(selected)?<form className="space-y-4" onSubmit={e=>{e.preventDefault();void applyAction();}}><div className="grid gap-3 sm:grid-cols-2">
   <label>Username<Input value={selected.username} required minLength={3} maxLength={254} onChange={e=>setSelected({...selected,username:e.target.value})}/></label><label>Email<Input type="email" value={selected.email} required onChange={e=>setSelected({...selected,email:e.target.value})}/></label>
   <label>Role<select className="block w-full border rounded p-2" value={selected.role} onChange={e=>setSelected({...selected,role:e.target.value as UserRole})}>{roles.map(role=><option key={role}>{role}</option>)}</select></label><label>Department<Input value={selected.department??''} onChange={e=>setSelected({...selected,department:e.target.value})}/></label>
  </div><label className="block">Action<select className="block w-full border rounded p-2" value={action} onChange={e=>{setAction(e.target.value);setConfirmed(false);}}><option value="save">Save username, email, role and department</option><option value="frozen">Freeze account</option><option value="on_hold">Hold access</option><option value="revoked">Revoke access</option><option value="active">Restore access</option><option value="set-password">Set a new password as administrator</option><option value="password-setup">Require password reset and generate setup link</option><option value="revoke-sessions">Sign out all sessions</option><option value="unlock">Clear failed-login lockout</option>{selected.approvalStatus!=='approved'&&<option value="approve">Approve account</option>}<option value="deleted">Delete account access permanently</option></select></label>
  <p className="text-sm text-muted-foreground">Freeze, hold and revoke block sign-in until an administrator restores access. Deletion is permanent and retains HR records and audit history. Password reset requires an active, approved account. Save identifier changes before generating a link.</p>
  {action==='set-password'&&<label className="block">New password (12–72 characters)<Input type="password" autoComplete="new-password" required minLength={12} maxLength={72} value={overridePassword} onChange={e=>setOverridePassword(e.target.value)}/></label>}
  <label className="block">Reason<Input required minLength={3} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this change needed?"/></label>
  <label className="flex gap-2 items-center"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this action for {selected.firstName} {selected.lastName}. Existing sessions and password links will be revoked.</label>
  <Button type="submit" disabled={mutation.isPending||!confirmed||reason.trim().length<3}>Apply account action</Button>
  </form>:<p>This account is protected. Use My account for your own profile; deleted accounts retain their history.</p>}
  <Button variant="ghost" onClick={()=>setSelected(null)}>Close account details</Button>
  <h3 className="font-semibold">Recent account history</h3>{history.length?<ul className="space-y-2 text-sm">{history.map(entry=><li key={entry.id}>{new Date(entry.timestamp).toLocaleString()} · {entry.description} · Account #{entry.actorId}<p className="text-muted-foreground">{entry.metadata?.reason}</p></li>)}</ul>:<p className="text-sm text-muted-foreground">No account-management events recorded yet.</p>}
 </CardContent></Card>}
 </div>;
}
