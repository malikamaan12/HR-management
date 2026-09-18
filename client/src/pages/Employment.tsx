import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Field, Section, Table, QueryError, fieldClass } from '@/components/hr/Operations';
import { ActionForm, Input, Note, Pager, Toggle, text, number, today, useSave } from '@/components/hr/EmployeeServiceUI';
import type { EmploymentChange, EmploymentPatch, EmploymentPolicy, ServicePeriod, ServicePeriodRequest } from '@shared/employment';

const base = '/api/employment';
type Person = {
  id: number; employeeId: string; name: string; recordVersion: number; department: string; position: string; location: string;
  workLocation: string | null; costCenter: string | null; jobGrade: string | null; reportingManagerId: number | null;
  secondaryManagerId: number | null; type: 'permanent' | 'temporary' | 'contract'; workSchedule: string; eventStaffEligible: boolean;
  contractEndDate: string | null; joiningDate: string; terminationDate: string | null; status: string;
};
type Context = { employees: Pick<Person, 'id' | 'employeeId' | 'name' | 'department' | 'position' | 'status'>[]; canManage: boolean; canConfigure: boolean };
type Policy = EmploymentPolicy & { version: number };
type HistoryRow = { kind?: string; record_id?: number; version: number; reason: string; actor_id: number; created_at: string; snapshot?: unknown };
const label = (value: string) => value.replaceAll('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const show = (value: unknown) => value == null || value === '' ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);

export default function Employment() {
  const [tab, setTab] = useState('changes'), [selected, setSelected] = useState<number | null>(null), [creating, setCreating] = useState(false), [employeeId, setEmployeeId] = useState('');
  const context = useQuery<Context>({ queryKey: [base + '/context'] });
  return <div className="space-y-6"><Helmet><title>Employment & service | E3 HR</title></Helmet>
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">Employment & service</h1><p className="mt-1 text-muted-foreground">Manage transfers, promotions, renewals and reviewed service history.</p></div>
      {context.data?.canManage && <Button onClick={() => { setTab('changes'); setSelected(null); setCreating(true); }}>Prepare employment change</Button>}</header>
    <QueryError error={context.error}/><div className="flex flex-wrap gap-2">
      {['changes', 'service', ...(context.data?.canConfigure ? ['rules'] : [])].map(value => <Button key={value} variant={tab === value ? 'default' : 'outline'} onClick={() => { setTab(value); setSelected(null); setCreating(false); }}>{value === 'changes' ? 'Changes & approvals' : value === 'service' ? 'Service periods & continuity' : 'Admin rules'}</Button>)}
    </div>
    {tab === 'changes' && (selected ? <><Button variant="outline" onClick={() => setSelected(null)}>Back to changes</Button><ChangeDetail id={selected}/></> : creating ? <Section title="Prepare employment change"><EmployeeSelect value={employeeId} onChange={setEmployeeId}/>{employeeId && <ChangeEditor key={employeeId} employeeId={Number(employeeId)} done={id => { setCreating(false); setSelected(id); }}/>}<Button variant="ghost" onClick={() => setCreating(false)}>Cancel preparation</Button></Section> : <ChangeList open={setSelected}/>)}
    {tab === 'service' && <><Section title="Employee service record"><EmployeeSelect value={employeeId} onChange={setEmployeeId}/></Section>{employeeId && <ServiceRecord key={employeeId} employeeId={Number(employeeId)}/>}<PeriodQueue open={id => setEmployeeId(String(id))}/></>}
    {tab === 'rules' && context.data?.canConfigure && <PolicyEditor/>}
  </div>;
}

function EmployeeSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState('');
  const data = useQuery<Context>({ queryKey: [base + '/context', { q: search }] });
  return <div className="grid gap-3 md:grid-cols-2"><Input label="Search employee" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or employee ID"/><Field label="Employee"><select className={fieldClass} value={value} onChange={e => onChange(e.target.value)}><option value="">Select an employee</option>{value && !data.data?.employees.some(e => String(e.id) === value) && <option value={value}>Employee #{value}</option>}{data.data?.employees.map(e => <option key={e.id} value={e.id}>{e.name} · {e.employeeId}</option>)}</select></Field><QueryError error={data.error}/></div>;
}

function ChangeList({ open }: { open: (id: number) => void }) {
  const [page, setPage] = useState(1), [status, setStatus] = useState('');
  const query = useQuery<{ items: EmploymentChange[]; total: number }>({ queryKey: [base + '/changes', { page, ...(status ? { status } : {}) }] });
  return <Section title="Employment changes"><Field label="Status"><select className={fieldClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{['requested', 'approved', 'applied', 'rejected', 'cancelled'].map(v => <option key={v}>{v}</option>)}</select></Field><QueryError error={query.error}/>{query.isLoading && <p>Loading changes…</p>}<Table headers={['Employee', 'Change', 'Effective', 'Status', '']} rows={(query.data?.items || []).map(r => [<span>{r.employee_name}<br/><small>{r.employee_code}</small></span>, label(r.kind), r.effective_date, label(r.status), <Button variant="outline" onClick={() => open(r.id)}>Open</Button>])}/><Pager page={page} total={query.data?.total || 0} onChange={setPage}/></Section>;
}

function ChangeEditor({ employeeId, done }: { employeeId: number; done: (id: number) => void }) {
  const query = useQuery<Person>({ queryKey: [base + '/employees/' + employeeId] });
  if (!query.data) return <><QueryError error={query.error}/>{query.isLoading && <p>Loading employee…</p>}</>;
  return <ChangeForm key={employeeId} employee={query.data} done={done}/>;
}
function ManagerSelect({ name, value, subjectId, caption }: { name: string; value: number | null; subjectId: number; caption: string }) {
  const [q, setQ] = useState(''), [selected, setSelected] = useState(String(value || ''));
  const query = useQuery<Context>({ queryKey: [base + '/context', { q }] });
  return <div className="space-y-2"><Input label={'Find ' + caption.toLowerCase()} value={q} onChange={e => setQ(e.target.value)}/><Field label={caption}><select className={fieldClass} name={name} value={selected} onChange={e => setSelected(e.target.value)}><option value="">No manager</option>{selected && !query.data?.employees.some(e => String(e.id) === selected && e.id !== subjectId && e.status !== 'inactive') && <option value={selected}>Employee #{selected}</option>}{query.data?.employees.filter(e => e.id !== subjectId && e.status !== 'inactive').map(e => <option key={e.id} value={e.id}>{e.name} · {e.employeeId}</option>)}</select></Field><QueryError error={query.error}/></div>;
}
function ChangeForm({ employee, done }: { employee: Person; done: (id: number) => void }) {
  // Keep the profile version that populated this form even if background data refreshes.
  const [initial] = useState(employee), save = useSave<{ id: number }>(r => done(r.id));
  const rules = useQuery<Policy>({ queryKey: [base + '/policy'] });
  return <form className="mt-5 space-y-4" onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget), values: EmploymentPatch = {
      department: text(form, 'department'), position: text(form, 'position'), location: text(form, 'location'),
      workLocation: text(form, 'workLocation') || null, costCenter: text(form, 'costCenter') || null, jobGrade: text(form, 'jobGrade') || null,
      reportingManagerId: number(form, 'reportingManagerId') || null, secondaryManagerId: number(form, 'secondaryManagerId') || null,
      type: text(form, 'type') as EmploymentPatch['type'], workSchedule: text(form, 'workSchedule') as EmploymentPatch['workSchedule'],
      eventStaffEligible: form.has('eventStaffEligible'), contractEndDate: text(form, 'contractEndDate') || null,
    };
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== initial[key as keyof Person]));
    save.mutate({ url: base + '/changes', body: { employeeId: initial.id, expectedEmployeeVersion: initial.recordVersion, kind: text(form, 'kind'), effectiveDate: text(form, 'effectiveDate'), changes, reason: text(form, 'reason') } });
  }}>
    <p className="text-sm">Changes are independently reviewed, then applied on or after their effective date. Existing payroll records and approved pay runs retain their original values.</p>
    {employee.recordVersion !== initial.recordVersion && <p role="alert" className="text-destructive text-sm">This employee changed while you were editing. Close and reopen the preparation form to use the current profile.</p>}
    {rules.data && <p className="text-sm text-muted-foreground">Rule version {rules.data.version} · Schedule up to {rules.data.maxFutureDays} days ahead · Backdating up to {rules.data.maxBackdatedDays} days · {rules.data.requireDirectorApproval ? 'Director or administrator review' : 'Independent HR review'}</p>}
    <div className="grid gap-4 md:grid-cols-2"><Field label="Change type"><select className={fieldClass} name="kind" required>{['transfer', 'promotion', 'contract_renewal', 'assignment_change'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></Field><Input label="Effective date" name="effectiveDate" type="date" defaultValue={today()} required/>
      {(['department', 'position', 'location', 'workLocation', 'costCenter', 'jobGrade'] as const).map(name => <Input key={name} label={label(name)} name={name} defaultValue={initial[name] || ''} required={['department', 'position', 'location'].includes(name)} maxLength={250}/>)}
      <Field label="Employment type"><select className={fieldClass} name="type" defaultValue={initial.type}>{['permanent', 'temporary', 'contract'].map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field label="Work schedule"><select className={fieldClass} name="workSchedule" defaultValue={initial.workSchedule}>{['unassigned', 'management_office', 'shift_based'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></Field>
      <Input label="Contract end date (blank clears it)" name="contractEndDate" type="date" defaultValue={initial.contractEndDate || ''}/><Toggle label="Eligible for event or activation staffing" name="eventStaffEligible" checked={initial.eventStaffEligible}/>
      <ManagerSelect name="reportingManagerId" value={initial.reportingManagerId} subjectId={initial.id} caption="Reporting manager"/><ManagerSelect name="secondaryManagerId" value={initial.secondaryManagerId} subjectId={initial.id} caption="Secondary manager"/>
    </div><p className="text-sm text-muted-foreground">Assign FEC and event teams, shifts and sites in <Link className="text-primary underline" href="/workforce">Workforce</Link>.</p><Note label="Business reason for this change"/><Button disabled={save.isPending || employee.recordVersion !== initial.recordVersion || initial.status === 'inactive'}>Submit for independent review</Button>
    {initial.status === 'inactive' && <p className="text-sm text-destructive">Reactivate employment through the employee profile before preparing a change.</p>}
  </form>;
}

function ChangeDetail({ id }: { id: number }) {
  const query = useQuery<{ row: EmploymentChange; employee: Person; canReview: boolean; canCancel: boolean; canApply: boolean; history: HistoryRow[] }>({ queryKey: [base + '/changes/' + id] });
  if (!query.data) return <><QueryError error={query.error}/>{query.isLoading && <p>Loading change…</p>}</>;
  const d = query.data, r = d.row, actions: { key: string; label: string }[] = [];
  if (r.status === 'requested' && d.canReview) actions.push({ key: 'approve', label: 'Approve change' }, { key: 'reject', label: 'Reject change' });
  if (['requested', 'approved'].includes(r.status) && d.canCancel) actions.push({ key: 'cancel', label: 'Cancel request' });
  if (r.status === 'approved' && d.canApply && r.effective_date <= today()) actions.push({ key: 'apply', label: 'Apply approved change' });
  return <div className="space-y-5"><Section title={d.employee.name + ' · ' + label(r.kind)}><div className="grid gap-2 text-sm md:grid-cols-2"><p>Status: <strong>{label(r.status)}</strong></p><p>Effective: <strong>{r.effective_date}</strong></p><p>Prepared by user #{r.requested_by} · Profile version {r.employee_version}</p><p>Saved rule version: {r.policy_snapshot.version}</p></div><p className="whitespace-pre-wrap">{r.reason}</p><Table headers={['Field', 'Current at preparation', 'Proposed']} rows={Object.entries(r.after_values).map(([key, value]) => [label(key), show(r.before_values[key as keyof EmploymentPatch]), show(value)])}/>
      {r.decision_reason && <p className="text-sm whitespace-pre-wrap">Latest decision: {r.decision_reason}</p>}{r.status === 'approved' && r.effective_date > today() && <p className="text-sm">Scheduled for {r.effective_date}. HR can apply this change from that date.</p>}
      {['requested', 'approved'].includes(r.status) && d.employee.recordVersion !== r.employee_version && <p role="alert" className="text-sm text-destructive">The employee profile has changed. Cancel this request and prepare a new proposal before approval or application.</p>}
      {r.applied_at && <p className="text-sm">Applied {new Date(r.applied_at).toLocaleString()} by user #{r.applied_by}.</p>}
    </Section><ActionForm key={r.version} base={base + '/changes'} id={id} version={r.version} actions={actions}/><DecisionHistory rows={d.history}/></div>;
}

type ServiceData = { employee: Person; periods: ServicePeriod[]; requests: (ServicePeriodRequest & { canReview: boolean; canCancel: boolean })[]; requestTotal: number; canManage: boolean; policy: Policy; summary: {
  source: string; asOf: string; policyVersion: number; totalQualifyingDays: number; continuityStartDate: string | null; latestServiceDate: string | null;
  continuousServiceDays: number; bridgedGapDays: number; qualifyingPeriods: number; needsClosure: boolean; gaps: { startDate: string; endDate: string; days: number; bridged: boolean }[];
} };
function ServiceRecord({ employeeId }: { employeeId: number }) {
  const [page, setPage] = useState(1);
  const query = useQuery<ServiceData>({ queryKey: [base + '/service/' + employeeId, { page }] });
  const [edit, setEdit] = useState<ServicePeriod | null | undefined>(), [voiding, setVoiding] = useState<ServicePeriod | null>(null);
  const save = useSave(() => setVoiding(null));
  if (!query.data) return <><QueryError error={query.error}/>{query.isLoading && <p>Loading service history…</p>}</>;
  const d = query.data, s = d.summary;
  return <div className="space-y-5"><Section title={d.employee.name + ' · Service continuity'}>
    <div className="grid gap-3 sm:grid-cols-3"><Summary title="Qualifying service days" value={s.totalQualifyingDays}/><Summary title="Latest continuous period" value={s.continuousServiceDays + ' days'}/><Summary title="Continuous since" value={s.continuityStartDate || 'No service'}/></div>
    <p className="text-sm">As of {s.asOf} · Latest service {s.latestServiceDate || '—'} · Rule version {s.policyVersion} · Gaps up to {d.policy.continuityGapDays} days retain continuity; {d.policy.includeBridgedGaps ? 'bridged gap days count' : 'only worked days count'}.</p>
    {s.needsClosure && <p role="alert" className="text-sm text-destructive">This inactive employee has an open service period. Submit a reviewed correction to close it. Totals use the profile termination date when available.</p>}
    {s.source === 'employee_profile' ? <p className="rounded bg-muted p-3 text-sm">This is an estimate from the employee profile. Record and approve every service period, including the current employment period, to replace the estimate with reviewed history.</p> : <p className="text-sm text-muted-foreground">Calculated from the service ledger, including preserved profile dates, lifecycle changes and reviewed corrections. These figures do not change payroll, leave accrual or settlements.</p>}
    {s.gaps.length > 0 && <Table headers={['Gap from', 'Gap to', 'Days', 'Continuity']} rows={s.gaps.map(g => [g.startDate, g.endDate, g.days, g.bridged ? 'Bridged' : 'New period starts'])}/>}
  </Section><Section title="Service periods"><div className="flex flex-wrap justify-between gap-3"><p className="text-sm text-muted-foreground">Changes to service history require independent HR approval. Voided records remain in history.</p>{d.canManage && <Button onClick={() => { setEdit(null); setVoiding(null); }}>Record service period</Button>}</div>
    <Table headers={['From', 'To', 'Type', 'Qualifies', 'Source', 'Status', '']} rows={d.periods.map(p => [p.start_date, p.end_date || 'Open', p.service_type, p.qualifies ? 'Yes' : 'No', label(p.source), p.status, d.canManage && p.status === 'active' ? <div className="flex gap-2"><Button variant="outline" onClick={() => { setEdit(p); setVoiding(null); }}>Correct</Button><Button variant="ghost" onClick={() => { setVoiding(p); setEdit(undefined); }}>Request void</Button></div> : '—'])}/>
    {edit !== undefined && <PeriodForm key={edit ? `${edit.id}:${edit.version}` : 'new'} employee={d.employee} period={edit} done={() => setEdit(undefined)}/>} {edit !== undefined && <Button variant="ghost" onClick={() => setEdit(undefined)}>Close service form</Button>}
    {voiding && <form className="space-y-3 rounded border p-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ url: `${base}/service/${employeeId}/requests`, body: { action: 'void', targetPeriodId: voiding.id, expectedPeriodVersion: voiding.version, period: null, reason: text(f, 'reason') } }); }}><p className="font-medium">Request to void {voiding.start_date} – {voiding.end_date || 'open'}</p><Note/><Button disabled={save.isPending}>Submit void request</Button><Button type="button" variant="ghost" onClick={() => setVoiding(null)}>Cancel</Button></form>}
  </Section><Section title="Service record requests"><div className="space-y-4">{d.requests.length === 0 && <p className="text-sm text-muted-foreground">No service record requests yet.</p>}{d.requests.map(r => <article key={r.id} className="rounded border p-4 space-y-3"><div className="font-medium">#{r.id} · {label(r.action)} · {label(r.status)}</div>{r.period_data && <p className="text-sm">{r.period_data.startDate} – {r.period_data.endDate || 'open'} · {r.period_data.serviceType} · {r.period_data.qualifies ? 'Qualifying service' : 'Excluded service'}<br/>{r.period_data.note}</p>}<p className="text-sm whitespace-pre-wrap">{r.reason}</p><p className="text-xs text-muted-foreground">Requested by user #{r.requested_by} · {new Date(r.created_at).toLocaleString()} · Policy version {r.policy_snapshot.version}</p>{r.decision_reason && <p className="text-sm">Decision: {r.decision_reason}</p>}{r.status === 'requested' && <ActionForm key={r.version} base={base + '/period-requests'} id={r.id} version={r.version} actions={[...(r.canReview ? [{ key: 'approve', label: 'Approve service record' }, { key: 'reject', label: 'Reject' }] : []), ...(r.canCancel ? [{ key: 'cancel', label: 'Cancel request' }] : [])]}/>}</article>)}</div><Pager page={page} total={d.requestTotal} onChange={setPage}/></Section><ServiceHistory employeeId={employeeId}/></div>;
}
function Summary({ title, value }: { title: string; value: string | number }) { return <div className="rounded border p-4"><p className="text-sm text-muted-foreground">{title}</p><p className="text-xl font-semibold mt-1">{value}</p></div>; }
function PeriodForm({ employee, period, done }: { employee: Person; period: ServicePeriod | null; done: () => void }) {
  const save = useSave(done);
  return <form className="space-y-4 rounded border p-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ url: `${base}/service/${employee.id}/requests`, body: { action: period ? 'correct' : 'record', targetPeriodId: period?.id || null, expectedPeriodVersion: period?.version || null, period: { startDate: text(f, 'startDate'), endDate: text(f, 'endDate') || null, qualifies: f.has('qualifies'), serviceType: text(f, 'serviceType'), note: text(f, 'note') }, reason: text(f, 'reason') } }); }}>
    <h3 className="font-medium">{period ? 'Correct service period' : 'Record service period'}</h3><div className="grid gap-4 md:grid-cols-2"><Input label="Service start" name="startDate" type="date" max={today()} defaultValue={period?.start_date || employee.joiningDate} required/><Input label="Service end (blank for ongoing)" name="endDate" type="date" max={today()} defaultValue={period ? period.end_date || '' : employee.terminationDate || ''}/><Field label="Service type"><select className={fieldClass} name="serviceType" defaultValue={period?.service_type || employee.type}>{['permanent', 'temporary', 'contract'].map(v => <option key={v}>{v}</option>)}</select></Field><Toggle label="Counts as qualifying service" name="qualifies" checked={period?.qualifies ?? true}/></div><Field label="Service notes"><textarea className={fieldClass} name="note" maxLength={2000} defaultValue={period?.note || ''}/></Field><Note label="Reason and evidence reference for this service record"/><Button disabled={save.isPending}>Submit service record for review</Button>
  </form>;
}
function PeriodQueue({ open }: { open: (employeeId: number) => void }) {
  const [page, setPage] = useState(1), [status, setStatus] = useState('requested');
  const query = useQuery<{ items: (ServicePeriodRequest & { employee_name: string })[]; total: number }>({ queryKey: [base + '/period-requests', { page, status }] });
  return <Section title="Service approval queue"><Field label="Request status"><select className={fieldClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{['requested', 'approved', 'rejected', 'cancelled'].map(v => <option key={v}>{v}</option>)}</select></Field><QueryError error={query.error}/><Table headers={['Employee', 'Request', 'Status', '']} rows={(query.data?.items || []).map(r => [r.employee_name, label(r.action), r.status, <Button variant="outline" onClick={() => open(r.employee_id)}>Open service record</Button>])}/><Pager page={page} total={query.data?.total || 0} onChange={setPage}/></Section>;
}
function DecisionHistory({ rows }: { rows: HistoryRow[] }) { return <details className="rounded-lg border p-4"><summary className="cursor-pointer font-semibold">Decision history</summary><ol className="mt-4 space-y-4">{rows.map((r, i) => <li key={i} className="border-b pb-3 text-sm"><p className="font-medium">{r.kind ? label(r.kind) + ' #' + r.record_id + ' · ' : ''}Version {r.version}</p><p className="text-muted-foreground">{new Date(r.created_at).toLocaleString()} · User #{r.actor_id}</p><p className="whitespace-pre-wrap">{r.reason}</p>{r.snapshot != null && <details className="mt-2"><summary className="cursor-pointer">Saved record</summary><pre className="text-xs overflow-auto whitespace-pre-wrap mt-2">{JSON.stringify(r.snapshot, null, 2)}</pre></details>}</li>)}</ol></details>; }
function ServiceHistory({ employeeId }: { employeeId: number }) {
  const [page, setPage] = useState(1), query = useQuery<{ items: HistoryRow[]; hasMore: boolean }>({ queryKey: [`${base}/service/${employeeId}/history`, { page }] });
  return <div className="space-y-3"><QueryError error={query.error}/><DecisionHistory rows={query.data?.items || []}/><div className="flex gap-3"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous history</Button><Button variant="outline" disabled={!query.data?.hasMore} onClick={() => setPage(page + 1)}>More history</Button></div></div>;
}

function PolicyEditor() {
  const query = useQuery<Policy>({ queryKey: [base + '/policy'] }), history = useQuery<{ version: number; definition: EmploymentPolicy; reason: string; created_by: number; created_at: string }[]>({ queryKey: [base + '/policy/history'] });
  return <div className="space-y-5"><QueryError error={query.error}/>{query.data && <PolicyForm key={query.data.version} policy={query.data}/>}<Section title="Policy history"><QueryError error={history.error}/><Table headers={['Version', 'Saved', 'Reason', 'Rules']} rows={(history.data || []).map(r => [r.version, new Date(r.created_at).toLocaleString(), r.reason, <details><summary className="cursor-pointer">View saved rules</summary><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(r.definition, null, 2)}</pre></details>])}/></Section></div>;
}
function PolicyForm({ policy }: { policy: Policy }) {
  const save = useSave();
  return <Section title="Employment approval & continuity rules"><p className="text-sm text-muted-foreground">Approval rules are saved with each new request. Continuity summaries use the current rules and show the rule version used. Independent review and overlap prevention always apply.</p><form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ url: base + '/policy', body: { expectedVersion: policy.version, reason: text(f, 'reason'), definition: { requireDirectorApproval: f.has('requireDirectorApproval'), maxBackdatedDays: number(f, 'maxBackdatedDays'), maxFutureDays: number(f, 'maxFutureDays'), continuityGapDays: number(f, 'continuityGapDays'), includeBridgedGaps: f.has('includeBridgedGaps') } } }); }}>
    <Toggle label="Require HR director or administrator approval" name="requireDirectorApproval" checked={policy.requireDirectorApproval}/><div className="grid gap-4 md:grid-cols-3"><Input label="Allowed backdating (days)" name="maxBackdatedDays" type="number" min={0} max={3650} defaultValue={policy.maxBackdatedDays} required/><Input label="Maximum future scheduling (days)" name="maxFutureDays" type="number" min={1} max={3650} defaultValue={policy.maxFutureDays} required/><Input label="Maximum gap preserving continuity (days)" name="continuityGapDays" type="number" min={0} max={3650} defaultValue={policy.continuityGapDays} required/></div><Toggle label="Include bridged gap days in continuous service totals" name="includeBridgedGaps" checked={policy.includeBridgedGaps}/><Note label="Reason for changing the rules"/><Button disabled={save.isPending}>Save rule version</Button>
  </form></Section>;
}
