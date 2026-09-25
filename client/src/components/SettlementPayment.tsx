import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {useLocale} from '@/contexts/LocaleContext';
import {apiJson} from '@/lib/queryClient';
import {Button} from '@/components/ui/button';
import {Field,Section,QueryError,fieldClass} from '@/components/hr/Operations';

type Debit={type:string;year:number;days:number};
type Payment={version:number;status:'pending'|'recorded'|'rejected';reference:string;paid_on:string;amount_cents:string;currency:string;leave_debits:Debit[];reason:string};
type Data={history:{version:number;reason:string;created_at:string;status:string;reference:string;actor:string}[];payment:Payment|null;payrollIds:number[];netCents:number;currency:string;unpaidSalary:string;leaveDays:number;leaveYear:number;today:string;canReview:boolean;modeError:string|null;current:{payroll:{id:number;status:string;net:string;currency:string|null}[];leave:{type:string;year:number;availableDays:number}[]}};
export default function SettlementPayment({id}:{id:number}){
 const {user}=useAuth();
 return user&&['admin','super_admin'].includes(user.role)?<PaymentReview id={id}/>:null;
}
function PaymentReview({id}:{id:number}){
 const {language}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
 const cache=useQueryClient(),path=`/api/separations/${id}/payment`;
 const query=useQuery<Data>({queryKey:[path]});
 const [reference,setReference]=useState(''),[paidOn,setPaidOn]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [payrollIds,setPayrollIds]=useState<number[]>([]),[debits,setDebits]=useState<Record<string,string>>({});
 const data=query.data,payment=data?.payment;
 const save=useMutation({mutationFn:(action:'propose'|'record'|'reject')=>apiJson(`${path}/${action}`,{method:'POST',body:action==='propose'?{version:payment?.version||0,reference,paidOn,amount,payrollIds,leaveDebits:(data?.current.leave||[]).filter(l=>l.year===data?.leaveYear&&Number(debits[l.type]||0)>0).map(l=>({type:l.type,year:l.year,days:Number(debits[l.type])})),reason,confirmed}:{version:payment?.version,reason,confirmed}}),onSuccess:()=>{setConfirmed(false);setReason('');void cache.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/separations')||String(q.queryKey[0]).startsWith('/api/payroll')});}});
 const proposing=!payment||payment.status==='rejected';
 return <Section title={L('Settlement payment reconciliation','مطابقة دفعة التسوية')}>
  <QueryError error={query.error||save.error}/>
  {query.isLoading&&<p role="status">{L('Loading payment review…','جارٍ تحميل مراجعة الدفعة…')}</p>}
  {data&&<div className="space-y-4">
   <p>{L('Record evidence of an external payment after checking the recipient, amount, and bank reference. This action does not transfer money. A second administrator must review it.','سجّل إثبات دفعة خارجية بعد التحقق من المستفيد والمبلغ والمرجع البنكي. لا يُحوّل هذا الإجراء أموالًا. يجب أن يراجعها مسؤول آخر.')}</p>
   <p>{L('Reviewed net settlement','صافي التسوية المعتمد')}: {(data.netCents/100).toFixed(2)} {data.currency}. {L('Outstanding salary','الراتب المستحق')}: {data.unpaidSalary}. {L('Encashed leave days','أيام الإجازة المصروفة')}: {data.leaveDays}.</p>
   {data.modeError&&<p role="alert" className="text-destructive">{L('Payment recording is disabled for this workspace. An administrator must confirm operational data mode.','تسجيل المدفوعات معطّل في هذه البيئة. يجب أن يؤكد المسؤول أن وضع البيانات تشغيلي.')}</p>}
   {payment&&<div className="rounded border p-3 space-y-2">
    <p>{L('Status','الحالة')}: {payment.status==='pending'?L('Awaiting independent review','بانتظار مراجعة مستقلة'):payment.status==='recorded'?L('Payment recorded','تم تسجيل الدفعة'):L('Rejected — prepare a new proposal','مرفوض — أعدّ مقترحًا جديدًا')}</p>
    <p>{payment.reference} · {payment.paid_on} · {(Number(payment.amount_cents)/100).toFixed(2)} {payment.currency}</p>
    <p>{payment.reason}</p>
    <p>{L('Linked payroll','الرواتب المرتبطة')}: {data.payrollIds.map(v=>'#'+v).join(', ')||L('None','لا يوجد')}</p>
    {payment.leave_debits.map(d=><p key={d.type+':'+d.year}>{d.type} / {d.year}: {d.days} {L('days debited on recording','أيام تُخصم عند التسجيل')}</p>)}
   </div>}
   {(proposing||data.canReview)&&<form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate(proposing?'propose':'record');}}>
    {proposing&&<>
     <div className="grid gap-4 md:grid-cols-3">
      <Field label={L('Bank payment reference','مرجع الدفعة البنكية')}><input className={fieldClass} value={reference} onChange={e=>setReference(e.target.value)} required minLength={3} maxLength={100}/></Field>
      <Field label={L('Payment date','تاريخ الدفع')}><input className={fieldClass} type="date" max={data.today} value={paidOn} onChange={e=>setPaidOn(e.target.value)} required/></Field>
      <Field label={L('Actual payment amount','مبلغ الدفعة الفعلي')}><input className={fieldClass} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required pattern="[0-9]+(\.[0-9]{1,2})?"/></Field>
     </div>
     <fieldset className="space-y-2"><legend className="font-medium">{L('Payroll included in this settlement','الرواتب المشمولة في التسوية')}</legend>
      {data.current.payroll.filter(p=>p.status==='approved'&&p.currency===data.currency).map(p=><label className="flex items-center gap-2" key={p.id}><input type="checkbox" checked={payrollIds.includes(p.id)} onChange={e=>setPayrollIds(ids=>e.target.checked?[...ids,p.id]:ids.filter(v=>v!==p.id))}/>#{p.id}: {p.net} {p.currency}</label>)}
      <p className="text-sm">{L('The selected total must equal the reviewed outstanding salary. The reviewer must also be the designated pay approver for every selected payroll. Previously exported WPS payroll requires bank reconciliation first.','يجب أن يساوي المجموع المختار الراتب المستحق المعتمد. ويجب أن يكون المراجع معتمد الدفع المحدد لكل راتب مختار. تتطلب الرواتب المصدّرة سابقًا لنظام حماية الأجور مطابقة بنكية أولًا.')}</p>
     </fieldset>
     <fieldset className="space-y-2"><legend className="font-medium">{L('Leave days to debit','أيام الإجازة المطلوب خصمها')}</legend>
      {data.current.leave.filter(l=>l.year===data.leaveYear).map(l=><Field key={l.type} label={`${l.type} (${l.year}) — ${L('available','المتاح')}: ${l.availableDays}`}><input className={fieldClass} type="number" min="0" max={Math.max(0,l.availableDays)} step="0.5" value={debits[l.type]||''} onChange={e=>setDebits(v=>({...v,[l.type]:e.target.value}))}/></Field>)}
      <p className="text-sm">{L('Enter the reviewed encashed days only. Reconcile prior-year carryover into the leaving year before proposing payment.','أدخل أيام الإجازة المصروفة المعتمدة فقط. طابق الرصيد المرحّل إلى سنة المغادرة قبل اقتراح الدفعة.')}</p>
     </fieldset>
    </>}
    <Field label={L('Evidence and review notes','الإثبات وملاحظات المراجعة')}><textarea className={fieldClass} required minLength={5} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
    <label className="flex items-start gap-2"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{L('I checked the payment evidence and linked balances.','تحققت من إثبات الدفع والأرصدة المرتبطة.')}</label>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={save.isPending||!confirmed||!!data.modeError}>{proposing?L('Submit payment for review','إرسال الدفعة للمراجعة'):L('Confirm and record payment','تأكيد الدفعة وتسجيلها')}</Button>
     {data.canReview&&<Button type="button" variant="outline" disabled={save.isPending||!confirmed||reason.trim().length<5} onClick={()=>save.mutate('reject')}>{L('Reject proposal','رفض المقترح')}</Button>}
    </div>
   </form>}
   {!!data.history.length&&<details><summary className="cursor-pointer font-medium">{L('Payment review history (latest 100 events)','سجل مراجعة الدفعة (آخر 100 إجراء)')}</summary><ol className="space-y-3 py-3">{data.history.map(h=><li key={h.version} className="rounded border p-3"><p>{h.actor} · {new Date(h.created_at).toLocaleString(language==='ar'?'ar-QA':'en-GB')} · {h.status==='recorded'?L('Recorded','مسجّل'):h.status==='rejected'?L('Rejected','مرفوض'):L('Proposed','مقترح')}</p><p>{h.reference} · {h.reason}</p></li>)}</ol></details>}
   {payment?.status==='pending'&&!data.canReview&&<p role="status">{L('Waiting for a different administrator to review.','بانتظار مراجعة مسؤول آخر.')}</p>}
  </div>}
 </Section>;
}
