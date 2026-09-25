import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiJson } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { compensationCategories, compensationLabels, compensationFrequencies, compensationProvisions, compensationRevisionInput, compensationTotals, emptyCompensation, type CompensationDefinition, type CompensationItem, type CompensationRevision } from '@shared/compensation';
import type { PayrollRule } from '@shared/hr-rules';
import {useLocale} from '@/contexts/LocaleContext';

type PackageData = {
  employee: { id: number; name: string; joiningDate: string; type: string }; date: string; current: CompensationRevision | null;
  items: CompensationRevision[]; latestVersion: number; canManage: boolean; canSyncPayroll: boolean;
  links: { packageId: number; ruleId: number; createdAt: string }[];
  payrollPolicy: { id: number; config: PayrollRule } | null;
  approvers: { id: number; firstName: string; lastName: string }[];
};
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const labelClass = 'grid gap-1 text-sm';
const words = (value: string) => value.replaceAll('_', ' ');
const itemLabel=(item:CompensationItem,t:(text:string)=>string)=>item.label===compensationLabels[item.category]?t(item.label):item.label;
const localizedError=(message:string,t:(text:string)=>string)=>message.split('; ').map(part=>{const prefix=part.match(/^(\d{3}: |[a-zA-Z.0-9]+: )/);return (prefix?.[0]||'')+t(part.slice(prefix?.[0].length||0));}).join('; ');
const baseUrl = (id: number) => `/api/compensation/employees/${id}`;

function PackageSummary({ definition }: { definition: CompensationDefinition }) {
  const {t,language}=useLocale();
  const totals = compensationTotals(definition);
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3 rounded-md bg-muted p-3 text-sm"><strong>{t("Monthly cash:")} {definition.currency} {totals.monthly}</strong>{compensationFrequencies.filter(f => f !== 'monthly' && totals[f] !== '0.00').map(f => <span key={f}>{t(words(f))} {t("cash:")} {definition.currency} {totals[f]}</span>)}</div>
    <p className="text-xs text-muted-foreground">{t("Amounts are grouped by payment frequency. Annual tickets, one-time payments, provided benefits and reimbursement ceilings are excluded from monthly cash.")}</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Component', 'Provision', 'Frequency', `${t('Amount / value')} (${definition.currency})`, 'Terms'].map(text => <th key={text} className="p-2 text-start">{t(text)}</th>)}</tr></thead><tbody>{definition.items.map((item, index) => <tr className="border-t" key={index}><td className="p-2">{itemLabel(item,t)}</td><td className="p-2">{t(words(item.provision))}</td><td className="p-2">{item.provision === 'not_applicable' ? '—' : t(words(item.frequency))}</td><td className="p-2">{item.provision === 'not_applicable' ? '—' : item.amount}</td><td className="max-w-xs whitespace-pre-wrap p-2">{item.terms || '—'}</td></tr>)}</tbody></table></div>
    {!!definition.notes && <p className="whitespace-pre-wrap text-sm">{definition.notes}</p>}
  </div>;
}

type SignedSource={id:number;reference:string;contentHash:string;startDate:string;endDate:string;terms:string;termsAr:string};
function PackageEditor({ data, onClose,source }: { data: PackageData; onClose: () => void;source?:SignedSource }) {
  const {language,t}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
  const [submissionKey]=useState(()=>crypto.randomUUID()),[confirmed,setConfirmed]=useState(false);
  const queryClient = useQueryClient(), { toast } = useToast();
  const [definition, setDefinition] = useState<CompensationDefinition>(() => structuredClone(data.current?.definition || data.items[0]?.definition || emptyCompensation()));
  const [effectiveFrom, setEffectiveFrom] = useState(source?.startDate || (data.items.length ? data.date < data.employee.joiningDate ? data.employee.joiningDate : data.date : data.employee.joiningDate));
  const [expectedVersion] = useState(data.latestVersion), [reason, setReason] = useState(''), [error, setError] = useState('');
  const save = useMutation({ mutationFn: (body: object) => apiJson(baseUrl(data.employee.id)+(source?'/contract-mappings':''), { method: 'POST', body:source?{...body,contractId:source.id,contractHash:source.contentHash,submissionKey,confirmed}:body }), onSuccess: async () => { await queryClient.invalidateQueries(); toast({ title: source?L('Contract mapping submitted for independent review','تم إرسال مطابقة العقد للمراجعة المستقلة'):t('Salary and benefit package recorded') }); onClose(); }, onError: (error: Error) => setError(error.message) });
  const change = (index: number, patch: Partial<CompensationItem>) => setDefinition(previous => ({ ...previous, items: previous.items.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  return <form className="space-y-5 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); setError(''); const parsed = compensationRevisionInput.safeParse({ expectedVersion, effectiveFrom, definition, reason }); if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; } save.mutate(parsed.data); }}>
    <div><h3 className="font-semibold">{data.items.length ? t('New dated compensation revision') : t('Onboarding salary and benefit breakdown')}</h3><p className="text-sm text-muted-foreground">{t("Record every category. Use not applicable where no entitlement exists. Specify amounts per payment period and describe benefit conditions.")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>{t("Effective from")}<Input required type="date" min={data.employee.joiningDate} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} /></label><label className={labelClass}>{t("Currency")}<Input required maxLength={3} pattern="[A-Z]{3}" value={definition.currency} onChange={e => setDefinition({ ...definition, currency: e.target.value.toUpperCase() })} /></label></div>
    <div className="space-y-4">{definition.items.map((item, index) => <fieldset className="rounded-md border p-3" key={index}><legend className="px-2 text-sm font-medium">{t(compensationLabels[item.category])}</legend><div className="grid gap-3 md:grid-cols-4">
      <label className={labelClass}>{t("Item label")}<Input required maxLength={100} value={item.label} onChange={e => change(index, { label: e.target.value })} /></label>
      <label className={labelClass}>{t("Provision")}<select className={selectClass} value={item.provision} onChange={e => change(index, { provision: e.target.value as CompensationItem['provision'], ...(e.target.value === 'not_applicable' ? { amount: '0.00' } : {}) })}>{compensationProvisions.map(value => <option key={value} value={value}>{t(words(value))}</option>)}</select></label>
      <label className={labelClass}>{t("Payment frequency")}<select disabled={item.provision === 'not_applicable'} className={selectClass} value={item.frequency} onChange={e => change(index, { frequency: e.target.value as CompensationItem['frequency'] })}>{compensationFrequencies.map(value => <option key={value} value={value}>{t(words(value))}</option>)}</select></label>
      <label className={labelClass}>{item.provision === 'provided' ? t('Estimated provided value') : item.provision === 'reimbursement' ? t('Reimbursement ceiling') : t('Amount per period')}<Input required disabled={item.provision === 'not_applicable'} type="number" min="0" max="999999999.99" step="0.01" value={item.amount} onChange={e => change(index, { amount: e.target.value })} /></label>
      <label className={`${labelClass} md:col-span-4`}>{t("Terms / eligibility / entitlement details")}<Textarea maxLength={2000} value={item.terms} onChange={e => change(index, { terms: e.target.value })} placeholder={item.category === 'flight_tickets' ? t('For example: ticket eligibility, frequency, route and dependent coverage') : item.category === 'vehicle' ? t('For example: company vehicle, fuel, maintenance and private-use conditions') : t('Describe the entitlement and conditions')} /></label>
    </div>{index >= compensationCategories.length && <Button type="button" className="mt-2" variant="outline" onClick={() => setDefinition({ ...definition, items: definition.items.filter((_, i) => i !== index) })}>{t("Remove additional item")}</Button>}</fieldset>)}</div>
    <Button type="button" variant="outline" disabled={definition.items.length >= 40} onClick={() => setDefinition({ ...definition, items: [...definition.items, { category: 'other', label: '', provision: 'cash', frequency: 'monthly', amount: '0.00', terms: '' }] })}>{t("Add another allowance or benefit")}</Button>
    <label className={labelClass}>{t("Package notes")}<Textarea maxLength={4000} value={definition.notes} onChange={e => setDefinition({ ...definition, notes: e.target.value })} /></label>
    <label className={labelClass}>{t("Reason for this revision")}<Textarea required minLength={5} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {source&&<label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{L('I compared this complete breakdown with both language versions of the signed contract. It will take effect only after independent approval.','قارنت هذا التفصيل الكامل بنسختي العقد الموقّع. لن يُطبّق إلا بعد موافقة مستقلة.')}</label>}
    <p className="text-sm text-muted-foreground">{t("Saving preserves previous revisions. An administrator can separately publish monthly, hourly, daily or per-event cash base pay to payroll after reviewing the package. Per-event base pay covers one assigned event shift.")}</p>
    {error && <p role="alert" className="text-sm text-destructive">{localizedError(error,t)}</p>}
    <div className="flex gap-2"><Button disabled={save.isPending||!!source&&!confirmed}>{source?L('Submit contract mapping','إرسال مطابقة العقد'):t('Save compensation revision')}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t("Cancel")}</Button></div>
  </form>;
}

function PayrollSync({ employeeId, revision, onClose }: { employeeId: number; revision: CompensationRevision; onClose: () => void }) {
  const {t,language}=useLocale();
  const query = useQuery<PackageData>({ queryKey: [baseUrl(employeeId), { date: revision.effectiveFrom }] });
  if (query.isLoading) return <p>{t("Loading effective payroll settings…")}</p>;
  if (query.error || !query.data) return <p role="alert">{t("Unable to load effective payroll settings.")}</p>;
  return <PayrollSyncForm key={`${revision.id}-${query.data.payrollPolicy?.id || 0}`} data={query.data} revision={revision} onClose={onClose} />;
}
function PayrollSyncForm({ data, revision, onClose }: { data: PackageData; revision: CompensationRevision; onClose: () => void }) {
  const {t,language}=useLocale();
  const queryClient = useQueryClient(), { toast } = useToast(), previous = data.payrollPolicy?.config;
  const [form, setForm] = useState({ cycleStartDay: previous?.cycleStartDay || 1, payDay: previous?.payDay || 1, regularMinutesPerDay: previous?.regularMinutesPerDay || 480, overtimeMultiplier: previous?.overtimeMultiplier || 1, hourlyRate: previous?.hourlyRate || '0.00', dailyPayMethod: previous?.dailyPayMethod || 'full_day', overtimeEnabled: previous?.overtimeEnabled ?? true, unpaidLeave: { enabled: false, deductionBase: 'basic', divisor: 'calendar_days', fixedDays: 30, ...previous?.unpaidLeave } as PayrollRule['unpaidLeave'], approverId: previous?.approverId || 0, reason: '', confirmed: false });
  const [error, setError] = useState('');
  const base = revision.definition.items.find(item => item.category === 'base')!;
  const eligible = base.provision === 'cash' && ['monthly', 'hourly', 'daily', 'per_event'].includes(base.frequency);
  const allowances = revision.definition.items.filter(item => item.category !== 'base' && item.provision === 'cash' && item.frequency === 'monthly');
  const save = useMutation({ mutationFn: () => apiJson(`${baseUrl(data.employee.id)}/packages/${revision.id}/payroll-rule`, { method: 'POST', body: { ...form, expectedVersion: revision.version, expectedRuleId: data.payrollPolicy?.id || null } }), onSuccess: async () => { await queryClient.invalidateQueries(); toast({ title: t('Dated payroll rule published') }); onClose(); }, onError: (error: Error) => setError(error.message) });
  return <form className="space-y-4 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); setError(''); save.mutate(); }}><h3 className="font-semibold">{t("Publish payroll rule from package v")}{revision.version}</h3>
    <p className="text-sm">{t("Effective")} {revision.effectiveFrom}: {itemLabel(base,t)} {revision.definition.currency} {base.amount} / {base.frequency === 'per_event' ? t('assigned event shift') : t(words(base.frequency))}{t(". Monthly cash allowances:")} {allowances.map(item => `${itemLabel(item,t)}: ${item.amount}`).join(', ') || t('none')}.</p>
    <p className="text-sm text-muted-foreground">{t("This replaces the effective base pay and monthly allowance list for future payroll generation. Existing recurring deductions are retained; the unpaid-leave settings below start from the current rule. Annual or one-time cash, reimbursements and provided benefits stay in the package. Saved payroll runs keep their recorded amounts; cancel and regenerate eligible drafts explicitly if needed.")}</p>
    {!eligible && <p role="alert">{t("Payroll mapping requires monthly, hourly, daily or per-event cash base pay.")}</p>}
    {data.payrollPolicy && <p className="text-sm">{t("Replaces payroll rule #")}{data.payrollPolicy.id}{t(". Current basis:")} {t(words(previous!.basis))}{t(". Overtime currently")} {(previous!.overtimeEnabled ?? true) ? t('enabled') : t('disabled')}{t(". Unpaid-leave deduction currently")} {previous!.unpaidLeave?.enabled ? t('enabled for monthly salary') : t('disabled')}.</p>}
    {previous && Object.keys(previous.deductions).length > 0 && <p className="text-sm">{t("Retained deductions:")} {Object.entries(previous.deductions).map(([label, amount]) => `${label}: ${previous.currency} ${amount}`).join(', ')}</p>}
    {base.frequency === 'daily' && <><label className={labelClass}>{t("Daily payment method")}<select className={selectClass} value={form.dailyPayMethod} onChange={e => setForm({ ...form, dailyPayMethod: e.target.value as PayrollRule['dailyPayMethod'] })}><option value="full_day">{t("Full day for any approved worked time")}</option><option value="prorated">{t("Prorate by approved regular minutes")}</option></select></label><p className="text-sm text-muted-foreground">{t("Daily pay is capped at one day per work date across approved timesheets. Prorated pay divides approved regular minutes by the regular daily minutes below, capped at one day.")}</p></>}
    {base.frequency === 'per_event' && <p className="rounded-md bg-muted p-3 text-sm">{t("One payment covers one assigned event shift with approved worked time. Each assignment is paid once, even when the shift crosses midnight.")}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{([{ key: 'cycleStartDay', label: 'Cycle start day', min: 1, max: 28, step: 1 }, { key: 'payDay', label: 'Payment day', min: 1, max: 28, step: 1 }, { key: 'regularMinutesPerDay', label: 'Regular minutes per day', min: 1, max: 1440, step: 1 }, { key: 'overtimeMultiplier', label: 'Overtime multiplier', min: 1, max: 5, step: 0.01 }] as const).map(field => <label key={field.key} className={labelClass}>{t(field.label)}<Input required type="number" min={field.min} max={field.max} step={field.step} value={form[field.key]} onChange={e => setForm({ ...form, [field.key]: Number(e.target.value) })} /></label>)}
      {base.frequency !== 'hourly' && <label className={labelClass}>{t("Overtime hourly rate (")}{revision.definition.currency})<Input required type="number" min="0" max="999999999.99" step="0.01" value={form.hourlyRate} onChange={e => setForm({ ...form, hourlyRate: e.target.value })}/></label>}
      <label className={`${labelClass} sm:col-span-2`}>{t("Independent payroll approver")}<select className={selectClass} required value={form.approverId || ''} onChange={e => setForm({ ...form, approverId: Number(e.target.value) })}><option value="">{t("Choose approver")}</option>{data.approvers.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>)}</select></label>
    </div>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.overtimeEnabled} onChange={e => setForm({ ...form, overtimeEnabled: e.target.checked })}/>{t("Pay approved overtime at the")} {base.frequency === 'hourly' ? `${revision.definition.currency} ${base.amount} ${t('base hourly rate')}` : t('overtime hourly rate')} {t("and multiplier above.")}</label>
    <fieldset className="space-y-3 rounded-md border p-3"><legend className="px-2 text-sm font-medium">{t("Unpaid-leave deduction rule")}</legend>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.unpaidLeave.enabled} onChange={e => setForm({ ...form, unpaidLeave: { ...form.unpaidLeave, enabled: e.target.checked } })}/>{t("Deduct approved unpaid leave from monthly salaries")}</label>
      <div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>{t("Deduction base")}<select className={selectClass} value={form.unpaidLeave.deductionBase} onChange={e => setForm({ ...form, unpaidLeave: { ...form.unpaidLeave, deductionBase: e.target.value as PayrollRule['unpaidLeave']['deductionBase'] } })}><option value="basic">{t("Basic salary only")}</option><option value="basic_and_allowances">{t("Basic salary and recurring allowances")}</option></select></label><label className={labelClass}>{t("Daily divisor")}<select className={selectClass} value={form.unpaidLeave.divisor} onChange={e => setForm({ ...form, unpaidLeave: { ...form.unpaidLeave, divisor: e.target.value as PayrollRule['unpaidLeave']['divisor'] } })}><option value="calendar_days">{t("Calendar days in the pay period")}</option><option value="working_days">{t("Scheduled working days in the pay period")}</option><option value="fixed">{t("Fixed number of days")}</option></select></label>{form.unpaidLeave.divisor === 'fixed' && <label className={labelClass}>{t("Fixed divisor (days)")}<Input required type="number" min="1" max="366" step="1" value={form.unpaidLeave.fixedDays} onChange={e => setForm({ ...form, unpaidLeave: { ...form.unpaidLeave, fixedDays: Number(e.target.value) } })}/></label>}</div>
      <p className="text-xs text-muted-foreground">{t("Only approved unpaid leave is deducted, including approved half-days. This setting is inactive for hourly, daily and per-event bases, and does not reduce their monthly allowances. Leave deductions are disabled by default; review the retained settings before publishing.")}</p>
    </fieldset>
    <label className={labelClass}>{t("Reason")}<Textarea required minLength={5} maxLength={2000} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" required checked={form.confirmed} onChange={e => setForm({ ...form, confirmed: e.target.checked })} />{t("I reviewed the base pay rate and unit, allowance list, retained deductions, unpaid-leave method, overtime settings and effective date.")}</label>
    {error && <p role="alert" className="text-sm text-destructive">{localizedError(error,t)}</p>}<div className="flex gap-2"><Button disabled={!eligible || save.isPending}>{t("Publish dated payroll rule")}</Button><Button variant="outline" type="button" onClick={onClose}>{t("Cancel")}</Button></div>
  </form>;
}

export default function EmployeeCompensation({ employeeId }: { employeeId: number }) {
  const {t,language}=useLocale();
  const query = useQuery<PackageData>({ queryKey: [baseUrl(employeeId)] });
  const [editing, setEditing] = useState(false), [selected, setSelected] = useState<number | null>(null), [sync, setSync] = useState<number | null>(null);
  if (query.isLoading) return <p>{t("Loading salary and benefits…")}</p>;
  if (query.error || !query.data) return <Card><CardHeader><CardTitle>{t("Salary and benefits")}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{t("Compensation details are available to the employee and authorized HR or payroll users.")}</p><Button className="mt-3" variant="outline" onClick={() => query.refetch()}>{t("Reload compensation")}</Button></CardContent></Card>;
  const data = query.data, revision = selected ? data.items.find(item => item.id === selected) : data.current || data.items[0];
  return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>{t("Salary and benefits")}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t("Complete compensation breakdown for")} {data.employee.name}</p></div>{data.canManage && !editing && <Button onClick={() => setEditing(true)}>{data.items.length ? t('Revise package') : t('Record onboarding package')}</Button>}</div></CardHeader><CardContent className="space-y-4">
    {!data.current && <p className="rounded-md border p-3 text-sm">{data.items.length ? t('No package is effective today. Select a dated revision below.') : t('No package recorded. HR should complete the salary, allowance and benefit breakdown before finishing onboarding.')}</p>}
    {editing && <PackageEditor data={data} onClose={() => setEditing(false)} />}
    {data.canManage&&<ContractMappings data={data}/>}
    {!!data.items.length && <label className={`${labelClass} max-w-lg`}>{t("Package history")}<select className={selectClass} value={revision?.id || ''} onChange={e => { setSelected(Number(e.target.value)); setSync(null); }}>{data.items.map(item => <option key={item.id} value={item.id}>{t("Version")} {item.version} {t("· effective")} {item.effectiveFrom}{item.id === data.current?.id ? t(' · current') : ''}</option>)}</select></label>}
    {revision && <><div className="text-sm"><p>{t("Version")} {revision.version} {t("· effective")} {revision.effectiveFrom} {t("· recorded")} {new Date(revision.createdAt).toLocaleDateString(language==='ar'?'ar-QA':'en-QA')}</p><p className="text-muted-foreground">{revision.reason}</p></div><PackageSummary definition={revision.definition} />
      {data.links.some(link => Number(link.packageId) === revision.id) ? <p className="text-sm">{t("Published to payroll rule #")}{data.links.find(link => Number(link.packageId) === revision.id)?.ruleId}.</p> : data.canSyncPayroll && <Button variant="outline" onClick={() => setSync(revision.id)}>{t("Review payroll mapping")}</Button>}
      {sync === revision.id && data.canSyncPayroll && <PayrollSync employeeId={employeeId} revision={revision} onClose={() => setSync(null)} />}
    </>}
  </CardContent></Card>;
}


type Mapping={id:number;contract_id:number;reference:string;version:number;status:'pending'|'applied'|'rejected';effective_from:string;definition:CompensationDefinition;reason:string;review_reason:string|null;preparer_name:string;terms:string;terms_ar:string;canReview:boolean;package_id:number|null};
function SignedTerms({id,terms,termsAr}:{id:number;terms:string;termsAr:string}){
 const {language,t}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
 return <div className="space-y-3 rounded border p-3"><a className="underline" href={'/api/contracts/'+id+'/download'} target="_blank" rel="noreferrer">{L('Open the complete signed contract','فتح العقد الموقّع كاملًا')}</a><div className="grid gap-3 md:grid-cols-2"><p lang="en" dir="ltr" className="whitespace-pre-wrap break-words">{terms}</p><p lang="ar" dir="rtl" className="whitespace-pre-wrap break-words">{termsAr}</p></div></div>;
}
function ContractMappings({data}:{data:PackageData}){
 const {language,t}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en;
 const path=baseUrl(data.employee.id)+'/contract-mappings';
 const query=useQuery<{contracts:SignedSource[];proposals:Mapping[];latestVersion:number}>({queryKey:[path]});
 const [sourceId,setSourceId]=useState(0),[editing,setEditing]=useState(false);
 const source=query.data?.contracts.find(c=>c.id===sourceId),available=query.data?.contracts.filter(c=>!query.data?.proposals.some(p=>p.contract_id===c.id&&p.status!=='rejected'))||[];
 return <section className="space-y-4 rounded-lg border p-4"><h3 className="font-semibold">{L('Signed contract to compensation','من العقد الموقّع إلى التعويضات')}</h3>
  <p className="text-sm">{L('Prepare a structured breakdown from the signed terms, then have a different HR reviewer approve it. Payroll publication remains a separate reviewed action. The latest 100 signed contracts and proposals are shown.','أعدّ تفصيلًا منظمًا من الشروط الموقّعة، ثم اطلب موافقة مراجع آخر من الموارد البشرية. يبقى نشر قواعد الرواتب إجراءً منفصلًا. تُعرض آخر 100 من العقود الموقّعة والمقترحات.')}</p>
  {query.isLoading&&<p role="status">{L('Loading signed contracts…','جارٍ تحميل العقود الموقّعة…')}</p>}
  {query.error&&<p role="alert">{L('Contract mappings require scoped HR access and cannot be managed for your own employee record.','تتطلب مطابقة العقود صلاحية الموارد البشرية، ولا يمكنك إدارة مطابقة سجلّك الوظيفي.')}</p>}
  {!!available.length&&<label className={labelClass}>{L('Signed source contract','العقد الموقّع المصدر')}<select className={selectClass} disabled={editing} value={sourceId||''} onChange={e=>setSourceId(Number(e.target.value))}><option value="">{L('Select a contract','اختر عقدًا')}</option>{available.map(c=><option key={c.id} value={c.id}>{c.reference} · {c.startDate}</option>)}</select></label>}
  {query.data&&!available.length&&<p>{L('No signed contract is available for a new mapping.','لا يوجد عقد موقّع متاح لمطابقة جديدة.')}</p>}
  {source&&<><SignedTerms id={source.id} terms={source.terms} termsAr={source.termsAr}/>{editing?<PackageEditor key={source.id} data={{...data,latestVersion:query.data!.latestVersion}} source={source} onClose={()=>{setEditing(false);setSourceId(0);}}/>:<Button variant="outline" onClick={()=>setEditing(true)}>{L('Prepare contract mapping','إعداد مطابقة العقد')}</Button>}</>}
  {query.data?.proposals.map(p=><MappingReview key={p.id+':'+p.version} path={path} proposal={p}/>)}
 </section>;
}
function MappingReview({path,proposal:p}:{path:string;proposal:Mapping}){
 const {language,t}=useLocale(),L=(en:string,ar:string)=>language==='ar'?ar:en,cache=useQueryClient();
 const [reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const save=useMutation({mutationFn:(action:'approve'|'reject')=>apiJson(path+'/'+p.id+'/'+action,{method:'POST',body:{version:p.version,reason,confirmed}}),onSuccess:()=>{void cache.invalidateQueries();}});
 return <details className="rounded border p-3"><summary className="cursor-pointer font-medium">{p.reference} · {p.status==='applied'?L('Applied','مطبّق'):p.status==='rejected'?L('Rejected','مرفوض'):L('Awaiting review','بانتظار المراجعة')} · {p.effective_from}</summary><div className="mt-3 space-y-4">
  <p>{L('Prepared by','أعدّه')}: {p.preparer_name}</p><p className="whitespace-pre-wrap">{p.reason}</p>
  <SignedTerms id={p.contract_id} terms={p.terms} termsAr={p.terms_ar}/><PackageSummary definition={p.definition}/>
  {p.package_id&&<p>{L('Applied compensation package','حزمة التعويضات المطبّقة')} #{p.package_id}</p>}
  {p.review_reason&&<p className="whitespace-pre-wrap">{L('Review decision','قرار المراجعة')}: {p.review_reason}</p>}
  {p.canReview&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();save.mutate('approve');}}><label className={labelClass}>{L('Review evidence and reason','إثبات المراجعة وسبب القرار')}<Textarea value={reason} onChange={e=>setReason(e.target.value)} minLength={5} maxLength={2000} required/></label>
   <label className="flex items-start gap-2"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{L('I reviewed the signed terms, amounts, benefit conditions and effective date.','راجعت الشروط الموقّعة والمبالغ وشروط المزايا وتاريخ السريان.')}</label>
   {save.error&&<p role="alert" className="text-destructive">{localizedError(save.error.message,t)}</p>}
   <div className="flex flex-wrap gap-2"><Button disabled={save.isPending||!confirmed}>{L('Approve and create package','الموافقة وإنشاء الحزمة')}</Button><Button type="button" variant="outline" disabled={save.isPending||!confirmed||reason.trim().length<5} onClick={()=>save.mutate('reject')}>{L('Reject mapping','رفض المطابقة')}</Button></div>
  </form>}
  {p.status==='pending'&&!p.canReview&&<p>{L('Waiting for a different eligible HR reviewer.','بانتظار مراجع آخر مؤهل من الموارد البشرية.')}</p>}
 </div></details>;
}
