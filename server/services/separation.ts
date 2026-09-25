import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import type {Employee} from '@shared/schema';
import {defaultSeparationPolicy,separationPolicySchema,fillSeparationText,type SeparationInput,type SeparationPolicy,type SeparationSnapshot,type SettlementLine,type documentKinds} from '@shared/separation';
import type {ServicePeriod} from '@shared/employment';
import {moneyCents} from '@shared/money';
import {effectiveCompensation} from './compensation';
import {employmentPolicy,serviceContinuity,daysBetween,dateAfter} from './employment';
import {getCompanySettings} from './settings';
import {WorkflowError,qatarToday} from './workflowRecords';

export function separationFail(status:number,message:string):never{throw new WorkflowError(status,message);}
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function separationPolicy(tx:any):Promise<SeparationPolicy & {version:number}>{
  const row=(await tx.execute(sql`SELECT version,definition FROM separation_policies WHERE effective_from<=${qatarToday()}::date ORDER BY effective_from DESC,version DESC LIMIT 1`)).rows[0];
  return {...separationPolicySchema.parse(row?.definition||defaultSeparationPolicy),version:Number(row?.version||0)};
}
// Calendar months deliberately remain calendar months, including month-end and leap-day boundaries.
export function calendarAfter(date:string,months:number){
  const [y,m,d]=date.split('-').map(Number),target=new Date(Date.UTC(y,m-1+months,1));
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(d,last));return target.toISOString().slice(0,10);
}
export function anniversaryYears(start:string,endExclusive:string){
  let years=Math.max(0,Number(endExclusive.slice(0,4))-Number(start.slice(0,4)));
  if(calendarAfter(start,years*12)>endExclusive)years--;
  const anniversary=calendarAfter(start,years*12),next=calendarAfter(start,(years+1)*12);
  return years+daysBetween(anniversary,endExclusive)/daysBetween(anniversary,next);
}
export async function settlementSnapshot(tx:any,employee:Employee,input:SeparationInput,policy?:SeparationPolicy & {version:number}):Promise<SeparationSnapshot>{
  if(input.lastDay<employee.joiningDate||input.noticeDate<employee.joiningDate)separationFail(400,'Notice and leaving dates must be on or after joining');
  if(employee.status==='inactive'&&employee.terminationDate!==input.lastDay)separationFail(409,'Use the recorded leaving date for an employee who has already left');
  const rules=policy||await separationPolicy(tx),continuityRules=await employmentPolicy(tx);
  const periods=(await tx.execute(sql`SELECT * FROM employment_service_periods WHERE employee_id=${employee.id} ORDER BY start_date,id`)).rows as ServicePeriod[];
  if(periods.some(p=>p.status==='active'&&(p.start_date>input.lastDay||p.end_date&&p.end_date>input.lastDay)))separationFail(409,'The leaving date conflicts with recorded service. Review Employment history first.');
  if((await tx.execute(sql`SELECT id FROM employment_period_requests WHERE employee_id=${employee.id} AND status='requested' LIMIT 1`)).rows.length)separationFail(409,'Resolve pending service-history corrections before calculating');
  const service=serviceContinuity(periods,employee,continuityRules,input.lastDay);
  if(!service.continuityStartDate||service.latestServiceDate!==input.lastDay||service.needsClosure)separationFail(409,'Record qualifying service through the last employment date in Employment history');
  const endExclusive=dateAfter(input.lastDay,1),span=daysBetween(service.continuityStartDate,endExclusive);
  const years=rules.yearMethod==='actual_365'?service.continuousServiceDays/365:anniversaryYears(service.continuityStartDate,endExclusive)*service.continuousServiceDays/span;
  const eligible=endExclusive>=calendarAfter(service.continuityStartDate,rules.minimumYears*12)&&years>=rules.minimumYears;
  const pkg=await effectiveCompensation(tx,employee.id,input.lastDay),base=pkg?.definition.items.find(i=>i.category==='base');
  if(!pkg)separationFail(409,'Record a compensation package effective on the leaving date first');
  if(input.basicOverride===null&&(!base||base.provision!=='cash'||base.frequency!=='monthly'))separationFail(409,'Enter and explain an equivalent monthly basic wage for non-monthly pay');
  const basicCents=moneyCents(input.basicOverride??base!.amount);
  if(basicCents<=0)separationFail(400,'Last monthly basic wage must be greater than zero');
  const noticeService=serviceContinuity(periods,employee,continuityRules,input.noticeDate);
  const months=input.noticeDate<calendarAfter(noticeService.continuityStartDate||service.continuityStartDate,rules.shortServiceMonths)?rules.shortNoticeMonths:rules.longNoticeMonths;
  let dueDate=calendarAfter(input.noticeDate,months),noticeSource=`Policy · ${months} calendar month(s)`;
  if(input.noticeMode==='not_required'){dueDate=input.noticeDate;noticeSource='Reviewed notice exception';}
  else if(input.noticeMode==='custom'){dueDate=dateAfter(input.noticeDate,input.noticeDays!);noticeSource='Case-specific notice days';}
  else if(employee.noticePeriod!=null){dueDate=dateAfter(input.noticeDate,employee.noticePeriod);noticeSource='Employee record · notice days';}
  const days=daysBetween(input.noticeDate,dueDate),servedDays=Math.min(days,daysBetween(input.noticeDate,input.lastDay)),shortfallDays=Math.max(0,days-servedDays);
  const gratuityCents=input.gratuityMode==='manual'?moneyCents(input.gratuityOverride!):eligible?Math.round(basicCents/rules.monthlyDivisor*rules.daysPerYear*years):0;
  const lines:SettlementLine[]=[{label:'End-of-service gratuity',labelAr:'مكافأة نهاية الخدمة',cents:gratuityCents,direction:'earning',method:input.gratuityMode==='manual'?input.gratuityReason:eligible?`Basic wage ÷ ${rules.monthlyDivisor} × ${rules.daysPerYear} days × ${years.toFixed(6)} service years`:`Below ${rules.minimumYears} qualifying year(s)`},
    {label:'Outstanding salary',labelAr:'الأجر المستحق غير المدفوع',cents:moneyCents(input.unpaidSalary),direction:'earning',method:'HR reconciled unpaid amount; salary already paid excluded'},
    {label:'Unused leave settlement',labelAr:'مقابل رصيد الإجازة',cents:Math.round(moneyCents(input.leaveMonthlyBasis??String(basicCents/100))/rules.monthlyDivisor*input.leaveDays),direction:'earning',method:`${input.leaveDays} reviewed days × monthly leave basis ÷ ${rules.monthlyDivisor}`}];
  lines.push({label:'Notice compensation',labelAr:'تعويض مدة الإخطار',cents:input.noticeSettlement==='waived'?0:Math.round(basicCents/rules.monthlyDivisor*shortfallDays),direction:input.noticeSettlement==='employee_owes'?'deduction':'earning',method:input.noticeSettlement==='waived'?input.noticeReason:`${shortfallDays} unserved days × basic wage ÷ ${rules.monthlyDivisor}`});
  lines.push(...input.adjustments.map(a=>({label:a.label,labelAr:a.labelAr,cents:moneyCents(a.amount),direction:a.direction,method:a.reason})));
  const earningsCents=lines.filter(l=>l.direction==='earning').reduce((s,l)=>s+l.cents,0),deductionsCents=lines.filter(l=>l.direction==='deduction').reduce((s,l)=>s+l.cents,0);
  if(!Number.isSafeInteger(earningsCents+deductionsCents)||earningsCents+deductionsCents>999999999999)separationFail(400,'Settlement exceeds the supported amount');
  const company=await getCompanySettings(tx);
  const payLabels:Record<string,string>={base:'الأجر الأساسي',housing:'بدل السكن',transportation:'بدل النقل',food:'بدل الطعام',travel:'السفر',flight_tickets:'تذاكر السفر',vehicle:'المركبة',benefits:'المزايا',other:'أخرى'};
  return {employee:{id:employee.id,name:employee.firstName+' '+employee.lastName,reference:employee.employeeId,position:employee.position,joiningDate:employee.joiningDate,status:employee.status},company:{name:company.companyName,address:company.companyAddress},policy:rules,
    currency:pkg.definition.currency,basicCents,basicSource:input.basicOverride!==null?'Reviewed monthly equivalent / override':`Compensation package v${pkg.version}`,compensationId:pkg.id,
    remuneration:pkg.definition.items.filter(item=>item.provision==='cash').map(item=>({label:item.label,labelAr:payLabels[item.category]||'أجر',cents:moneyCents(item.amount),frequency:item.frequency})),
    service:{start:service.continuityStartDate,end:input.lastDay,days:service.continuousServiceDays,years,eligible,source:service.source,continuityPolicyVersion:continuityRules.version,bridgedDays:service.bridgedGapDays},
    notice:{days,servedDays,shortfallDays,dueDate,source:noticeSource},lines,earningsCents,deductionsCents,netCents:earningsCents-deductionsCents,
    sourceHash:fingerprint({employeeVersion:employee.recordVersion,noticePeriod:employee.noticePeriod,joining:employee.joiningDate,termination:employee.terminationDate,status:employee.status,compensation:pkg,periods,continuityRules})};
}
export function readyToReview(input:SeparationInput){
  if(!input.employeeNameAr||!input.companyNameAr||!input.positionAr||input.reasonAr.length<3)separationFail(400,'Complete the Arabic names, position and reason before review');
  if(input.reconciliationNote.length<3)separationFail(400,'Record how salary, leave and other amounts were reconciled');
  for(const template of [input.noticeText,input.serviceText,input.settlementText]){
    const unresolved=(template.body+' '+template.bodyAr).match(/\{\{[^}]*\}\}/g)||[];
    const permitted=['company_name','employee_name','employee_id','position','joining_date','last_day','notice_date','notice_due','reason','reference'];
    if(unresolved.some(token=>!permitted.includes(token.replace(/[{}\s]/g,'')))||/[{}]{2}/.test((template.body+' '+template.bodyAr).replace(/\{\{\s*[a-z_]+\s*\}\}/g,'')))separationFail(400,'Remove unsupported or incomplete document placeholders');
  }
}
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function printableSeparation(row:any,kind:typeof documentKinds[number]){
  const s=row.snapshot as SeparationSnapshot,i=row.input as SeparationInput;
  const template=kind==='notice'?i.noticeText:kind==='service'?i.serviceText:i.settlementText;
  const fields={company_name:s.company.name,employee_name:s.employee.name,employee_id:s.employee.reference,position:s.employee.position,joining_date:s.employee.joiningDate,last_day:i.lastDay,notice_date:i.noticeDate,notice_due:s.notice.dueDate,reason:i.reason,reference:row.reference};
  const isolate=(value:string)=>'\u2066'+value+'\u2069';
  const arFields={...fields,company_name:i.companyNameAr,employee_name:i.employeeNameAr,position:i.positionAr,reason:i.reasonAr,joining_date:isolate(fields.joining_date),last_day:isolate(fields.last_day),notice_date:isolate(fields.notice_date),notice_due:isolate(fields.notice_due),employee_id:isolate(fields.employee_id)};
  const titles={notice:['Separation / notice letter','خطاب انتهاء الخدمة والإخطار'],service:['Service certificate','شهادة خدمة'],settlement:['End-of-service statement','بيان مستحقات نهاية الخدمة']};
  const number=(cents:number)=>'<bdi dir="ltr">'+(cents/100).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+escape(s.currency)+'</bdi>';
  const frequency:Record<string,string>={monthly:'شهري',annual:'سنوي',one_time:'لمرة واحدة',hourly:'لكل ساعة',daily:'يومي',per_event:'لكل فعالية',on_request:'عند الطلب'};
  const approved=['approved','completed'].includes(row.status),title=titles[kind];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(row.reference)} · ${title[0]}</title><style>*{box-sizing:border-box}body{background:#f2f0f8;color:#221c35;font:14px/1.8 Arial,Tahoma,sans-serif;margin:0}main{max-width:1000px;margin:24px auto;padding:32px;background:white;border-radius:20px}header{border-bottom:3px solid #7950ca;padding-bottom:16px}h1{font-size:22px}p{white-space:pre-wrap;overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}.pair>div{min-width:0}[dir=rtl]{text-align:right}.status{font-weight:bold;color:#6a3cb1}table{width:100%;border-collapse:collapse;margin:24px 0;font-size:12px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:start}small,footer{color:#655d75;font-size:11px}.total{font-weight:bold;font-size:18px}footer{border-top:1px solid #ddd;margin-top:20px;padding-top:14px;overflow-wrap:anywhere}@media(max-width:600px){main{margin:8px;padding:18px}.pair{grid-template-columns:1fr}table{font-size:10px}th,td{padding:6px}}@media print{body{background:white}main{margin:0;padding:0}.pair{grid-template-columns:1fr 1fr}tr{break-inside:avoid}h1{break-after:avoid}@page{size:A4;margin:15mm}}</style></head><body><main><header><div class="status">${approved?'APPROVED · معتمد':'DRAFT / CANCELLED — NOT ISSUED · مسودة / ملغى — غير صادر'}</div><div class="pair"><div><h1>${title[0]}</h1><strong>${escape(s.company.name)}</strong><p>${escape(s.company.address)}</p></div><div lang="ar" dir="rtl"><h1>${title[1]}</h1><strong>${escape(i.companyNameAr)}</strong></div></div><small>${escape(row.reference)} · ${escape(s.employee.reference)} · ${escape(row.status)}</small></header><section class="pair"><div><p>${escape(fillSeparationText(template.body,fields))}</p></div><div lang="ar" dir="rtl"><p>${escape(fillSeparationText(template.bodyAr,arFields))}</p></div></section>
  ${kind==='service'?`<p>Monthly basic wage used / الأجر الأساسي الشهري المستخدم: ${number(s.basicCents)}</p><table><thead><tr><th>Recorded cash remuneration / الأجر النقدي المسجل</th><th>Frequency / دورية الدفع</th><th>Amount / المبلغ</th></tr></thead><tbody>${s.remuneration.map(p=>`<tr><td>${escape(p.label)}<br><span lang="ar" dir="rtl">${escape(p.labelAr)}</span></td><td>${escape(p.frequency)} / ${escape(frequency[p.frequency]||p.frequency)}</td><td>${number(p.cents)}</td></tr>`).join('')}</tbody></table><p>Qualifying continuous service / الخدمة المتصلة المحتسبة: <bdi dir="ltr">${escape(s.service.start)} → ${escape(s.service.end)}</bdi></p>`:''}
  ${kind==='notice'?`<p>Notice due / نهاية الإخطار: ${escape(s.notice.dueDate)} · Unserved days / الأيام غير المستوفاة: ${s.notice.shortfallDays}</p>`:''}
  ${kind==='settlement'?`<p>Qualifying service / مدة الخدمة المحتسبة: <bdi dir="ltr">${escape(s.service.start)} → ${escape(s.service.end)}</bdi> · <bdi dir="ltr">${s.service.days}</bdi> days / يوم · <bdi dir="ltr">${s.service.years.toFixed(6)}</bdi> years / سنة</p><p>Basic wage / الأجر الأساسي: ${number(s.basicCents)} · Policy / إصدار القواعد: ${s.policy.version}</p><table><thead><tr><th>Item / البند</th><th>Add / إضافة</th><th>Deduct / خصم</th></tr></thead><tbody>${s.lines.map(l=>`<tr><td>${escape(l.label)}<br><span lang="ar" dir="rtl">${escape(l.labelAr)}</span><br><small>${escape(l.method)}</small></td><td>${l.direction==='earning'?number(l.cents):'—'}</td><td>${l.direction==='deduction'?number(l.cents):'—'}</td></tr>`).join('')}</tbody></table><p class="total">${s.netCents>=0?'Net payable / صافي المستحق':'Net recovery for review / صافي الاسترداد للمراجعة'}: ${number(Math.abs(s.netCents))}</p><p>${escape(i.reconciliationNote)}</p>`:''}
  <footer>HR approval / اعتماد الموارد البشرية: ${escape(row.reviewed_at||'Pending / قيد الانتظار')} · Account / الحساب: ${escape(row.reviewed_by||'—')}<br>Document record SHA-256: ${fingerprint({input:i,snapshot:s})}<p>No payment receipt or employee signature is implied by this document. / لا يفيد هذا المستند إقراراً بالسداد أو توقيع الموظف.</p></footer></main></body></html>`;
}
