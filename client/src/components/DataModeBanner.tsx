import {useQuery} from '@tanstack/react-query';
import {useLocale} from '@/contexts/LocaleContext';
export default function DataModeBanner(){
 const {language}=useLocale();
 const status=useQuery<{dataMode:'demo'|'operational'|'unconfirmed'}>({queryKey:['/api/environment'],staleTime:30000});
 if(status.data?.dataMode==='operational')return null;
 const ar=language==='ar';
 const message=status.isLoading?(ar?'جارٍ التحقق من وضع البيانات…':'Checking data mode…'):status.error?(ar?'تعذّر التحقق من وضع البيانات. أعد المحاولة قبل الاستخدام التشغيلي.':'Data mode could not be verified. Retry before operational use.'):status.data?.dataMode==='demo'?(ar?'بيئة تجريبية — البيانات والأرصدة ليست سجلات تشغيلية. تصدير الملفات البنكية وتسجيل المدفوعات معطّلان.':'DEMO WORKSPACE — Data and totals are for demonstration. Bank exports and payment recording are disabled.'):(ar?'لم يتم تأكيد وضع البيانات. تحقّق من فصل البيانات التجريبية قبل الاستخدام التشغيلي.':'Data mode is unconfirmed. Verify sample-data separation before operational use.');
 return <div role="status" className="border-b border-amber-400/50 bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-950">{message}</div>;
}
