import {useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {useAuth} from '@/contexts/AuthContext';
import {Field,Section,QueryError,fieldClass} from '@/components/hr/Operations';
import {useLocale} from '@/contexts/LocaleContext';

export default function AccountMfa(){
 const {language}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
 const {saveMfaRecoveryCodes}=useAuth();
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[secondFactor,setSecondFactor]=useState('');
 const status=useQuery<{configured:boolean;enabled:boolean;required:boolean}>({queryKey:['/api/auth/mfa']});
 const start=useMutation({mutationFn:()=>apiJson<{secret:string;uri:string}>('/api/auth/mfa/start',{method:'POST',body:{password,secondFactor}}),onSuccess:()=>{setPassword('');setSecondFactor('');}});
 const confirm=useMutation({mutationFn:()=>apiJson<{recoveryCodes:string[]}>('/api/auth/mfa/confirm',{method:'POST',body:{code}}),onSuccess:data=>{setCode('');start.reset();saveMfaRecoveryCodes(data.recoveryCodes);}});
 return <Section title="Multifactor authentication">
  <QueryError error={status.error||start.error||confirm.error}/>
  {status.isLoading?<p role="status">{L('Loading security status…','جارٍ تحميل حالة الأمان…')}</p>:!status.data?.configured?<p role="alert">{L('Authenticator setup is unavailable until the service administrator configures the MFA encryption key.','إعداد المصادقة غير متاح حتى يُهيّئ مسؤول الخدمة مفتاح تشفير المصادقة متعددة العوامل.')}</p>:<>
   <p>{status.data.enabled?L('Your authenticator is enabled. To replace a lost device, sign in with a recovery code, then verify another unused recovery code below. Your old authenticator stays active until you confirm the replacement.','المصادقة مفعّلة. لاستبدال جهاز مفقود، سجّل الدخول برمز استرداد، ثم أدخل رمز استرداد آخر غير مستخدم أدناه. يظل تطبيق المصادقة القديم فعّالًا حتى تؤكد الاستبدال.'):status.data.required?L('Set up an authenticator before using this account.','أعدّ تطبيق المصادقة قبل استخدام هذا الحساب.'):L('Use an authenticator app to add a second verification step at sign-in.','استخدم تطبيق مصادقة لإضافة خطوة تحقق ثانية عند تسجيل الدخول.')}</p>
   {!start.data?<form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();start.mutate();}}>
    <Field label="Current password"><input className={fieldClass} type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)}/></Field>
    {status.data.enabled&&<Field label="Current authenticator or unused recovery code"><input className={fieldClass} autoComplete="one-time-code" required maxLength={24} value={secondFactor} onChange={e=>setSecondFactor(e.target.value.trim())}/></Field>}
    <Button disabled={start.isPending}>{status.data.enabled?L('Replace authenticator','استبدال تطبيق المصادقة'):L('Set up authenticator','إعداد تطبيق المصادقة')}</Button>
   </form>:<form className="mt-4 space-y-4" onSubmit={e=>{e.preventDefault();confirm.mutate();}}>
    <p>{L('Add a time-based account in your authenticator using this setup key. It expires in ten minutes. Do not share it.','أضف حسابًا قائمًا على الوقت في تطبيق المصادقة باستخدام مفتاح الإعداد هذا. تنتهي صلاحيته بعد عشر دقائق. لا تشاركه.')}</p><code dir="ltr" className="block break-all rounded border p-3">{start.data.secret}</code>
    <Field label="Six-digit authenticator code"><input className={fieldClass} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></Field>
    <Button disabled={confirm.isPending}>{L('Verify and enable','التحقق والتفعيل')}</Button><Button type="button" variant="outline" onClick={()=>{start.reset();setCode('');}}>{L('Restart setup','إعادة بدء الإعداد')}</Button>
   </form>}
  </>}
 </Section>;
}
