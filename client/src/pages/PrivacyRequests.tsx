import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {ShieldCheck} from 'lucide-react';
import {PageHeading} from '@/components/ux/WorkspaceUI';
import {Field,Section,QueryError,fieldClass} from '@/components/hr/Operations';
import {Button} from '@/components/ui/button';
import {apiJson,apiRequest} from '@/lib/queryClient';
import {useLocale} from '@/contexts/LocaleContext';

type Request={id:number;version:number;employee_name:string;kind:string;details:string;status:string;due_date:string;response:string|null;canHandle:boolean;canReview:boolean;canWithdraw:boolean;canPrepareExport:boolean;canPrepareCorrection:boolean;proposed_correction:Record<string,string|null>|null;canDownloadExport:boolean;export_hash:string|null;overdue:boolean};
export default function PrivacyRequests(){
 const {language}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
 const cache=useQueryClient(),[page,setPage]=useState(1),[employee,setEmployee]=useState(''),[kind,setKind]=useState('access'),[details,setDetails]=useState(''),[key,setKey]=useState(()=>crypto.randomUUID()),[selected,setSelected]=useState<Request|null>(null),[action,setAction]=useState('prepare'),[response,setResponse]=useState('');
 const [correctionField,setCorrectionField]=useState('primaryMobile'),[correctionValue,setCorrectionValue]=useState('');
 const correctionLabels:Record<string,string>={primaryMobile:L('Primary mobile','الهاتف المحمول الأساسي'),personalEmail:L('Personal email','البريد الإلكتروني الشخصي'),residentialAddress:L('Residential address','عنوان السكن'),fullNameArabic:L('Full name in Arabic','الاسم الكامل بالعربية')};
 const options=useQuery<{canManage:boolean;responseDays:number;employees:{id:number;name:string}[]}>({queryKey:['/api/privacy-requests/options']});
 const list=useQuery<{items:Request[];hasMore:boolean}>({queryKey:['/api/privacy-requests',{page}]});
 const save=useMutation({mutationFn:({url,body}:{url:string;body:unknown})=>apiJson(url,{method:'POST',body}),onSuccess:()=>{void cache.invalidateQueries({queryKey:['/api/privacy-requests']});setSelected(null);setResponse('');setDetails('');setKey(crypto.randomUUID());}});
 const download=useMutation({mutationFn:async(requestId:number)=>{const result=await apiRequest(`/api/privacy-requests/${requestId}/export`);const url=URL.createObjectURL(await result.blob());const link=document.createElement('a');link.href=url;link.download=`personal-data-request-${requestId}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 const labels:Record<string,string>={access:L('Access to personal data','الوصول إلى البيانات الشخصية'),correction:L('Correct personal data','تصحيح البيانات الشخصية'),erasure:L('Erasure review','مراجعة محو البيانات'),restriction:L('Restrict processing','تقييد المعالجة'),submitted:L('Submitted','مقدّم'),in_review:L('Under review','قيد المراجعة'),fulfilled:L('Fulfilled','مكتمل'),rejected:L('Rejected','مرفوض'),withdrawn:L('Withdrawn','مسحوب'),prepare:L('Prepare response','إعداد الرد'),'prepare-export':L('Prepare core-record export','إعداد تصدير السجلات الأساسية'),fulfill:L('Verify fulfilment','التحقق من التنفيذ'),reject:L('Reject with reasons','الرفض مع بيان الأسباب'),withdraw:L('Withdraw','سحب الطلب')};
 labels['prepare-correction']=L('Prepare profile correction','إعداد تصحيح الملف');
 const choose=(r:Request,a:string)=>{setSelected(r);setAction(a);setResponse('');setCorrectionField('primaryMobile');setCorrectionValue('');save.reset();};
 return <div className="space-y-6">
  <PageHeading icon={ShieldCheck} title="Privacy requests" description={L('Request access, correction, erasure or restriction of your personal information.','اطلب الوصول إلى معلوماتك الشخصية أو تصحيحها أو محوها أو تقييد معالجتها.')}/>
  <QueryError error={options.error||list.error||save.error||download.error}/>
  <Section title="Submit a request">
   <p>{L(`Describe the information and outcome you need. HR reviews identity, retention duties and third-party privacy. The operational response target is ${options.data?.responseDays||30} days; the reviewer must check applicable legal deadlines.`,`وضّح المعلومات والنتيجة المطلوبة. تراجع الموارد البشرية الهوية والتزامات الاحتفاظ وخصوصية الأطراف الأخرى. المدة التشغيلية المستهدفة للرد ${options.data?.responseDays||30} يومًا؛ ويجب على المراجع التحقق من المهل القانونية المطبقة.`)}</p>
   <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({url:'/api/privacy-requests',body:{employeeId:Number(employee||options.data?.employees[0]?.id),kind,details,submissionKey:key}});}}>
    <Field label="Employee"><select className={fieldClass} required value={employee||String(options.data?.employees[0]?.id||'')} onChange={e=>{setEmployee(e.target.value);setKey(crypto.randomUUID());}}>{options.data?.employees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    {!options.isLoading&&!options.data?.employees.length&&<p role="status">{L('No linked employee record is available. Contact HR to verify your identity and register the request.','لا يوجد سجل موظف مرتبط. تواصل مع الموارد البشرية للتحقق من هويتك وتسجيل الطلب.')}</p>}
    <Field label="Request type"><select className={fieldClass} value={kind} onChange={e=>{setKind(e.target.value);setKey(crypto.randomUUID());}}>{['access','correction','erasure','restriction'].map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></Field>
    <Field label="Requested information and outcome"><textarea className={fieldClass} required minLength={20} maxLength={4000} value={details} onChange={e=>{setDetails(e.target.value);setKey(crypto.randomUUID());}}/></Field>
    <Button disabled={save.isPending||!options.data?.employees.length}>{L('Submit request','تقديم الطلب')}</Button>
   </form>
  </Section>
  {selected&&<Section title={`${L('Request','الطلب')} #${selected.id}: ${labels[action]}`}>
   <p>{action==='prepare-export'?L('Generate a snapshot of core profile, payroll, leave, attendance and document metadata for administrator review. It excludes files, messages, third-party details and case notes. Review additional requested information separately before release.','أنشئ نسخة من الملف الأساسي والرواتب والإجازات والحضور وبيانات المستندات لمراجعة المسؤول. لا تتضمن الملفات أو الرسائل أو بيانات الأطراف الأخرى أو ملاحظات الحالات. راجع أي معلومات إضافية مطلوبة قبل الإفراج.'):L('Record the response and evidence reference visible to the requester. Review the complete requested scope and preservation duties. Verifying fulfilment releases any prepared core-record export to the employee; it applies any prepared profile correction but does not restrict or erase other source records.','سجّل الرد ومرجع الإثبات اللذين يظهران لمقدم الطلب. راجع نطاق الطلب كاملًا والتزامات الحفظ. يؤدي التحقق من التنفيذ إلى إتاحة التصدير المُعد للموظف؛ ويطبّق تصحيح الملف المُعد، لكنه لا يقيّد السجلات المصدرية الأخرى أو يمحوها.')}</p>
   {action==='prepare-correction'&&<p>{L('Prepare a verified contact or Arabic-name correction. A different administrator will review and apply it atomically. Identity, banking and employment changes use their dedicated workflows.','أعدّ تصحيحًا موثّقًا لبيانات التواصل أو الاسم بالعربية. سيراجعه مسؤول آخر ويطبّقه مع إغلاق الطلب. تستخدم تغييرات الهوية والبنك والتوظيف إجراءاتها المخصصة.')}</p>}
   <form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate({url:`/api/privacy-requests/${selected.id}/${action}`,body:{version:selected.version,response,...(action==='prepare-correction'?{correction:{[correctionField]:correctionValue.trim()||null}}:{})}});}}>
    {action==='prepare-correction'&&<><Field label={L('Field to correct','الحقل المطلوب تصحيحه')}><select className={fieldClass} value={correctionField} onChange={e=>{setCorrectionField(e.target.value);setCorrectionValue('');}}>{Object.entries(correctionLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label={L('Verified replacement value','القيمة البديلة الموثّقة')}><input className={fieldClass} type={correctionField==='personalEmail'?'email':'text'} required={!['personalEmail','fullNameArabic'].includes(correctionField)} maxLength={correctionField==='residentialAddress'?1000:correctionField==='personalEmail'?254:correctionField==='primaryMobile'?30:200} value={correctionValue} onChange={e=>setCorrectionValue(e.target.value)}/></Field><p className="text-sm">{L('Leave optional email or Arabic name blank only to request clearing that field.','اترك البريد الإلكتروني الاختياري أو الاسم بالعربية فارغًا فقط لطلب مسح ذلك الحقل.')}</p></>}
    <Field label="Response and evidence reference"><textarea className={fieldClass} required minLength={20} maxLength={4000} value={response} onChange={e=>setResponse(e.target.value)}/></Field>
    <Button disabled={save.isPending}>{labels[action]}</Button><Button type="button" variant="ghost" onClick={()=>setSelected(null)}>{L('Cancel','إلغاء')}</Button>
   </form>
  </Section>}
  <Section title="Request history">
   {list.isLoading?<p role="status">{L('Loading requests…','جارٍ تحميل الطلبات…')}</p>:!list.data?.items.length?<p>{L('No requests yet.','لا توجد طلبات بعد.')}</p>:list.data.items.map(r=><article className="space-y-3 rounded-xl border p-4" key={r.id}>
    <h3 className="font-semibold">#{r.id} · {r.employee_name} · {labels[r.kind]||r.kind}</h3>
    <p>{labels[r.status]||r.status} · {L('Target','الموعد المستهدف')} <bdi>{r.due_date}</bdi>{r.overdue?L(' · overdue',' · متأخر'):''}</p>
    <p className="whitespace-pre-wrap" dir="auto">{r.details}</p>{r.response&&<p className="whitespace-pre-wrap rounded bg-muted p-3" dir="auto">{r.response}</p>}
    {r.export_hash&&<p className="break-all text-xs">{L('Core export fingerprint','بصمة التصدير الأساسي')}: <bdi>{r.export_hash}</bdi></p>}
    {r.proposed_correction&&<dl className="rounded border p-3">{Object.entries(r.proposed_correction).map(([key,value])=><div key={key}><dt className="font-semibold">{correctionLabels[key]||key}</dt><dd className="break-words" dir="auto">{value??L('Clear this optional field','مسح هذا الحقل الاختياري')}</dd></div>)}</dl>}
    <div className="flex flex-wrap gap-2">
     {r.canDownloadExport&&<Button variant="outline" disabled={download.isPending} onClick={()=>download.mutate(r.id)}>{L('Download core-record export','تنزيل تصدير السجلات الأساسية')}</Button>}
     {['submitted','in_review'].includes(r.status)&&<>
      {r.canPrepareExport&&<Button variant="outline" disabled={save.isPending} onClick={()=>choose(r,'prepare-export')}>{labels['prepare-export']}</Button>}
      {r.canPrepareCorrection&&<Button variant="outline" disabled={save.isPending} onClick={()=>choose(r,'prepare-correction')}>{labels['prepare-correction']}</Button>}
      {r.canHandle&&<Button variant="outline" onClick={()=>choose(r,'prepare')}>{labels.prepare}</Button>}
      {r.status==='in_review'&&r.canReview&&<><Button onClick={()=>choose(r,'fulfill')}>{labels.fulfill}</Button><Button variant="outline" onClick={()=>choose(r,'reject')}>{labels.reject}</Button></>}
      {r.canWithdraw&&<Button variant="ghost" onClick={()=>choose(r,'withdraw')}>{labels.withdraw}</Button>}
     </>}
    </div>
   </article>)}
   <div className="flex gap-3"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>{L('Previous','السابق')}</Button><Button variant="outline" disabled={!list.data?.hasMore} onClick={()=>setPage(page+1)}>{L('Next','التالي')}</Button></div>
  </Section>
 </div>;
}
