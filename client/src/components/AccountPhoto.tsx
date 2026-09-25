import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {useLocale} from '@/contexts/LocaleContext';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Avatar,AvatarImage,AvatarFallback} from '@/components/ui/avatar';
import {preparePhoto} from '@/components/employee/EmployeePhoto';
type Photo={url:string|null;version:string};
export default function AccountPhoto(){
 const {user,refreshToken}=useAuth(),{language,t}=useLocale(),cache=useQueryClient();
 const tr=(en:string,ar:string)=>language==='ar'?ar:en;
 const key=['/api/auth/avatar',user?.userId],query=useQuery<Photo>({queryKey:key,queryFn:()=>apiJson('/api/auth/avatar')});
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[version,setVersion]=useState(''),[preparing,setPreparing]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const selection=useRef(0),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>()=>{selection.current++;},[]);
 const save=useMutation({mutationFn:async(remove:boolean)=>{
  if(remove)return apiJson<Photo>('/api/auth/avatar',{method:'DELETE',body:{version:query.data!.version}});
  const body=new FormData();body.append('photo',file!);body.append('version',version);
  return apiJson<Photo>('/api/auth/avatar',{method:'PUT',body});
 },onSuccess:async data=>{cache.setQueryData(key,data);setFile(null);setSaved(true);await refreshToken();}});
 const busy=preparing||save.isPending;
 async function choose(value:File){const current=++selection.current;setPreparing(true);setError('');setSaved(false);save.reset();setVersion(query.data!.version);
  try{const photo=await preparePhoto(value);if(current===selection.current)setFile(photo);}catch(e){if(current===selection.current){setFile(null);setError(e instanceof Error?e.message:'Unable to read this image.');}}finally{if(current===selection.current)setPreparing(false);}
 }
 return <section className="mb-6 rounded-xl border p-4" aria-label={tr('Profile photo','الصورة الشخصية')}>
  <h3 className="font-semibold">{tr('Profile photo','الصورة الشخصية')}</h3>
  <p className="mt-1 text-sm text-muted-foreground">{tr('Add a photo to your personal account. Your official employee photo is managed separately by HR.','أضف صورة إلى حسابك الشخصي. تدير الموارد البشرية صورة الموظف الرسمية بشكل منفصل.')}</p>
  <div className="mt-4 flex flex-wrap items-center gap-4"><Avatar className="h-24 w-24"><AvatarImage src={preview||query.data?.url||undefined} alt={tr('Your profile photo','صورتك الشخصية')}/><AvatarFallback>{user?.firstName?.[0]}{user?.lastName?.[0]}</AvatarFallback></Avatar>
  <div className="space-y-2"><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={tr('Choose profile photo','اختر صورة شخصية')} disabled={busy||!query.data} onChange={e=>{const value=e.target.files?.[0];e.target.value='';if(value)void choose(value);}}/>
   <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||!query.data} onClick={()=>input.current?.click()}>{t(query.data?.url?'Change photo':'Upload photo')}</Button>
   {file&&<><Button type="button" disabled={busy} onClick={()=>save.mutate(false)}>{t('Save photo')}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>{setFile(null);setError('');save.reset();}}>{t('Cancel')}</Button></>}
   {query.data?.url&&!file&&<Button type="button" variant="ghost" disabled={busy} onClick={()=>{setSaved(false);save.mutate(true);}}>{tr('Remove photo','إزالة الصورة')}</Button>}</div>
   <p className="text-xs text-muted-foreground">{t('JPG, PNG or WebP · up to 10 MB')}</p></div></div>
  {query.isLoading&&<p role="status">{tr('Loading profile photo…','جارٍ تحميل الصورة الشخصية…')}</p>}
  {query.error&&<p role="alert">{tr('Unable to load your photo.','تعذر تحميل صورتك.')} <Button type="button" variant="link" onClick={()=>query.refetch()}>{t('Retry')}</Button></p>}
  {busy&&<p role="status">{t(preparing?'Preparing preview…':'Saving…')}</p>}
  {(error||save.error)&&<p role="alert" className="mt-2 text-sm text-destructive">{t(error||save.error?.message||'')} <Button type="button" variant="link" onClick={()=>{setFile(null);save.reset();setError('');query.refetch();}}>{t('Reload profile')}</Button></p>}
  {saved&&<p role="status" className="mt-2 text-sm">{tr('Profile photo updated.','تم تحديث الصورة الشخصية.')}</p>}
 </section>;
}
