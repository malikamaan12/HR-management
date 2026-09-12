import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userRoleEnum, type UserRole } from '@shared/schema';
import type { ApiEmployee } from '@/lib/api-types';
import { apiJson } from '@/lib/queryClient';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card,CardHeader,CardTitle,CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
type Account={id:number;username:string;email:string;firstName:string;lastName:string;role:UserRole;isActive:boolean;approvalStatus:string};
const blank={username:'',email:'',firstName:'',lastName:'',password:'',role:'permanent_employee' as UserRole};
export default function UserManagement(){
 const {user}=useAuth(),{toast}=useToast(),cache=useQueryClient();
 const [form,setForm]=useState(blank),[showCreate,setShowCreate]=useState(false),[search,setSearch]=useState('');
 const {data:accounts=[],isLoading,error}=useQuery<Account[]>({queryKey:['/api/admin/users']});
 const {data:employees=[]}=useQuery<ApiEmployee[]>({queryKey:['/api/employees',{limit:1000}]});
 const mutation=useMutation({mutationFn:({url,method='POST',body}:{url:string;method?:string;body?:unknown})=>apiJson(url,{method,body}),
  onSuccess:()=>{cache.invalidateQueries({queryKey:['/api/admin/users']});cache.invalidateQueries({queryKey:['/api/employees']});toast({title:'Saved'});},
  onError:(error)=>toast({title:'Unable to save',description:error.message,variant:'destructive'})});
 const change=(name:keyof typeof blank,value:string)=>setForm({...form,[name]:value});
 return <Card><CardHeader><div className="flex justify-between"><CardTitle>User management</CardTitle><Button onClick={()=>setShowCreate(!showCreate)}>Add user</Button></div></CardHeader><CardContent className="space-y-6">
  {showCreate&&<form className="grid gap-3 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();try{await mutation.mutateAsync({url:'/api/admin/users',body:form});setForm(blank);setShowCreate(false);}catch{}}}>
   {(['username','email','firstName','lastName','password'] as const).map(key=><label key={key} className="space-y-1"><span>{({username:'Username',email:'Email',firstName:'First name',lastName:'Last name',password:'Initial password (12+ characters)'})[key]}</span><Input required type={key==='password'?'password':key==='email'?'email':'text'} minLength={key==='password'?12:1} value={form[key]} onChange={e=>change(key,e.target.value)} autoComplete={key==='password'?'new-password':'off'}/></label>)}
   <label>Role<select className="block w-full border rounded p-2" value={form.role} onChange={e=>change('role',e.target.value)}>{userRoleEnum.enumValues.filter(role=>role!=='super_admin'||user?.role==='super_admin').map(role=><option key={role}>{role}</option>)}</select></label>
   <Button disabled={mutation.isPending} type="submit">Create account</Button>
  </form>}
  <Input aria-label="Search users" placeholder="Search users" value={search} onChange={e=>setSearch(e.target.value)}/>
  {isLoading?<p>Loading users…</p>:error?<p role="alert">Unable to load users. Administrator access is required.</p>:<div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['User','Role','Status','Employee link','Actions'].map(label=><th className="text-left p-3" key={label}>{label}</th>)}</tr></thead><tbody>
   {accounts.filter(account=>`${account.firstName} ${account.lastName} ${account.email} ${account.username}`.toLowerCase().includes(search.toLowerCase())).map(account=>{
    const linked=employees.find(employee=>employee.userId===account.id);return <tr className="border-t" key={account.id}>
     <td className="p-3"><p>{account.firstName} {account.lastName}</p><p className="text-muted-foreground">{account.email}</p></td>
     <td className="p-3"><select aria-label={`Role for ${account.username}`} value={account.role} disabled={mutation.isPending||account.id===user?.userId} onChange={e=>mutation.mutate({url:`/api/admin/users/${account.id}`,method:'PATCH',body:{role:e.target.value}})}>{userRoleEnum.enumValues.filter(role=>role!=='super_admin'||user?.role==='super_admin'||account.role==='super_admin').map(role=><option key={role}>{role}</option>)}</select></td>
     <td className="p-3">{account.approvalStatus==='pending'?'Pending approval':account.isActive?'Active':'Inactive'}</td>
     <td className="p-3">{linked?`${linked.firstName} ${linked.lastName} (${linked.employeeId})`:<select aria-label={`Link employee to ${account.username}`} value="" disabled={mutation.isPending} onChange={e=>mutation.mutate({url:`/api/admin/users/${account.id}/link-employee`,body:{employeeId:Number(e.target.value)}})}><option value="">Select employee…</option>{employees.filter(employee=>!employee.userId).map(employee=><option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName} ({employee.employeeId})</option>)}</select>}</td>
     <td className="p-3">{account.approvalStatus==='pending'?<Button disabled={mutation.isPending} onClick={()=>mutation.mutate({url:`/api/auth/approve-user/${account.id}`})}>Approve</Button>:<Button variant="outline" disabled={mutation.isPending||account.id===user?.userId} onClick={()=>mutation.mutate({url:`/api/admin/users/${account.id}`,method:'PATCH',body:{isActive:!account.isActive}})}>{account.isActive?'Deactivate':'Activate'}</Button>}</td>
    </tr>;
   })}
  </tbody></table>{accounts.length===0&&<p>No users found.</p>}</div>}
 </CardContent></Card>;
}
