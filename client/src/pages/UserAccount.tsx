import {useState} from 'react';
import {Link} from 'wouter';
import {useMutation} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {apiJson} from '@/lib/queryClient';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {useToast} from '@/hooks/use-toast';
export default function UserAccount(){
 const {user,refreshToken}=useAuth(),{toast}=useToast();
 const [firstName,setFirstName]=useState(user?.firstName||''),[lastName,setLastName]=useState(user?.lastName||'');
 const save=useMutation({mutationFn:()=>apiJson('/api/auth/profile',{method:'PUT',body:{firstName,lastName}}),onSuccess:async()=>{await refreshToken();toast({title:'Profile saved'});},onError:error=>toast({title:'Unable to save profile',description:error.message,variant:'destructive'})});
 return <Card><CardHeader><CardTitle>My account</CardTitle></CardHeader><CardContent className="space-y-5"><p>{user?.username} · {user?.role}</p><p>Account email: {user?.email}</p><form className="max-w-lg space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}>
  <label className="block">First name<Input required maxLength={100} value={firstName} onChange={e=>setFirstName(e.target.value)}/></label><label className="block">Last name<Input required maxLength={100} value={lastName} onChange={e=>setLastName(e.target.value)}/></label><Button disabled={save.isPending}>Save profile</Button></form>
  <p>Contact HR for changes to your employee record or account email.</p><Link href="/settings" className="text-primary">Change password →</Link></CardContent></Card>;
}
