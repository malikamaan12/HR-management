import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Section, Table, QueryError, fieldClass } from './Operations';
import { Input, Note, text, useSave } from './EmployeeServiceUI';

const base = '/api/review-cycles';
type Cycle = { id: number; version: number; periodEnd: string; dueDate: string; selfRequired: boolean };
type Person = { id: number; name: string; employeeId: string };
type Reviewer = { id: number; name: string; role: string };
type Directory = { employees: Person[]; reviewers: Reviewer[] };
type Entry = Person & { reviewerId: number; dueDate: string; selfRequired: boolean };
type Result = { added: { id: number; employeeId: number }[]; skipped: { employeeId: number; reason: string }[]; cycleVersion: number };

export function BulkParticipants({ cycle }: { cycle: Cycle }) {
  const [search, setSearch] = useState(''), [entries, setEntries] = useState<Entry[]>([]), [reviewer, setReviewer] = useState('');
  const [due, setDue] = useState(cycle.dueDate), [self, setSelf] = useState(cycle.selfRequired), [version, setVersion] = useState(cycle.version), [result, setResult] = useState<Result | null>(null);
  const directory = useQuery<Directory>({ queryKey: [base + '/directory', { q: search }] });
  const reviewers = useQuery<Directory>({ queryKey: [base + '/directory'] });
  const save = useSave<Result>(value => { setResult(value); setVersion(value.cycleVersion); setEntries([]); });
  function select(person: Person, chosen: boolean) {
    setResult(null);
    setEntries(current => chosen ? current.length < 200 && !current.some(r => r.id === person.id) ? [...current, { ...person, reviewerId: Number(reviewer), dueDate: due, selfRequired: self }] : current : current.filter(r => r.id !== person.id));
  }
  function patch(index: number, changes: Partial<Entry>) { setEntries(current => current.map((e, i) => i === index ? { ...e, ...changes } : e)); }
  return <Section title="Assign employees in a batch"><p className="text-sm text-muted-foreground">Select up to 200 employees, set their reviewers and deadlines, then submit the whole batch. Every new assignment must be valid before any are saved.</p>
    {result && <div role="status" className="rounded bg-muted p-4 space-y-2"><p className="font-medium">{result.added.length} employees assigned · {result.skipped.length} skipped</p>{result.skipped.length > 0 && <Table headers={['Employee', 'Why skipped']} rows={result.skipped.map(r => ['#' + r.employeeId, r.reason])}/>}</div>}
    <div className="grid gap-4 md:grid-cols-3"><ReviewerPicker value={reviewer} onChange={setReviewer}/><Input label="Default deadline" type="date" value={due} min={cycle.periodEnd} onChange={e => setDue(e.target.value)}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={self} onChange={e => setSelf(e.target.checked)}/>Self-assessment required</label></div>
    <Button variant="outline" disabled={!entries.length || !reviewer || !due} onClick={() => setEntries(entries.map(e => ({ ...e, reviewerId: Number(reviewer), dueDate: due, selfRequired: self })))}>Apply these defaults to selected employees</Button>
    <Input label="Find employees to add" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee name or ID"/><QueryError error={directory.error}/>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { const candidates = directory.data?.employees || []; setResult(null); setEntries(current => [...current, ...candidates.filter(p => !current.some(e => e.id === p.id)).map(p => ({ ...p, reviewerId: Number(reviewer), dueDate: due, selfRequired: self }))].slice(0, 200)); }}>Select search results</Button><Button variant="ghost" disabled={!entries.length} onClick={() => setEntries([])}>Clear selection</Button><span className="self-center text-sm">{entries.length} / 200 selected</span></div>
    <div className="max-h-60 overflow-auto rounded border p-3 grid gap-2 md:grid-cols-2">{directory.data?.employees.map(p => <label key={p.id} className="flex gap-2 items-center text-sm"><input type="checkbox" checked={entries.some(e => e.id === p.id)} disabled={entries.length === 200 && !entries.some(e => e.id === p.id)} onChange={e => select(p, e.target.checked)}/>{p.name} · {p.employeeId}</label>)}{directory.data && !directory.data.employees.length && <p className="text-sm text-muted-foreground">No matching eligible employees.</p>}</div>
    {entries.length > 0 && <form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ url: `${base}/${cycle.id}/participants/bulk`, body: { version, participants: entries.map(p => ({ employeeId: p.id, reviewerId: p.reviewerId, dueDate: p.dueDate, selfRequired: p.selfRequired })), duplicatePolicy: text(f, 'duplicatePolicy'), reason: text(f, 'reason') } }); }}>
      {version !== cycle.version && <div role="alert" className="rounded border p-3 text-sm space-y-2"><p>The cycle changed while this batch was being prepared. Review the employee list before using the current cycle version.</p><Button type="button" variant="outline" onClick={() => setVersion(cycle.version)}>Use current cycle version {cycle.version}</Button></div>}
      <Table headers={['Employee', 'Reviewer', 'Deadline', 'Self-review', '']} rows={entries.map((p, i) => [<span>{p.name}<br/><small>{p.employeeId}</small></span>, <select aria-label={'Reviewer for ' + p.name} className={fieldClass} value={p.reviewerId || ''} onChange={e => patch(i, { reviewerId: Number(e.target.value) })} required><option value="">Select reviewer</option>{p.reviewerId > 0 && !reviewers.data?.reviewers.some(r => r.id === p.reviewerId) && <option value={p.reviewerId}>User #{p.reviewerId}</option>}{reviewers.data?.reviewers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>, <input aria-label={'Deadline for ' + p.name} className={fieldClass} type="date" min={cycle.periodEnd} value={p.dueDate} onChange={e => patch(i, { dueDate: e.target.value })} required/>, <input aria-label={'Self-assessment for ' + p.name} type="checkbox" checked={p.selfRequired} onChange={e => patch(i, { selfRequired: e.target.checked })}/>, <Button type="button" variant="ghost" onClick={() => select(p, false)}>Remove</Button>])}/>
      <Field label="If an employee is already assigned"><select name="duplicatePolicy" className={fieldClass} defaultValue="reject"><option value="reject">Reject the entire batch and identify the duplicate</option><option value="skip">Skip duplicates and report them</option></select></Field><Note label="Reason for this assignment batch"/><Button disabled={save.isPending || version !== cycle.version || entries.some(p => !p.reviewerId || !p.dueDate)}>Assign {entries.length} employees</Button>
    </form>}
  </Section>;
}

function ReviewerPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [q, setQ] = useState(''), query = useQuery<Directory>({ queryKey: [base + '/directory', { q }] });
  return <div className="space-y-2"><Input label="Find reviewer" value={q} onChange={e => setQ(e.target.value)}/><Field label="Reviewer"><select className={fieldClass} value={value} onChange={e => onChange(e.target.value)}><option value="">Choose reviewer</option>{value && !query.data?.reviewers.some(p => String(p.id) === value) && <option value={value}>User #{value}</option>}{query.data?.reviewers.map(p => <option value={p.id} key={p.id}>{p.name} · {p.role.replaceAll('_', ' ')}</option>)}</select></Field><QueryError error={query.error}/></div>;
}

export function ParticipationControls({ cycle, review, withdrawn, reason: recordedReason }: { cycle: Cycle; review: { id: number; version: number; reviewerId: number; dueDate: string }; withdrawn: boolean; reason: string | null }) {
  const [reviewer, setReviewer] = useState(String(review.reviewerId)), [due, setDue] = useState(review.dueDate), save = useSave();
  return <Section title={withdrawn ? 'Reinstate participant' : 'Withdraw participant'}><p className="text-sm text-muted-foreground">{withdrawn ? 'Reinstatement resumes the saved review stage. A changed reviewer must submit a fresh manager assessment.' : 'Withdrawal preserves assessment history and pauses submissions and objectives. The employee is excluded from cycle totals until reinstated.'}</p>{recordedReason && <p className="text-sm whitespace-pre-wrap">Latest participation decision: {recordedReason}</p>}
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save.mutate({ url: `${base}/assessments/${review.id}/participation`, body: { version: review.version, cycleVersion: cycle.version, action: withdrawn ? 'reinstate' : 'withdraw', reason: text(f, 'reason'), ...(withdrawn ? { reviewerId: Number(reviewer), dueDate: due } : {}) } }); }}>
      {withdrawn && <div className="grid gap-4 md:grid-cols-2"><ReviewerPicker value={reviewer} onChange={setReviewer}/><Input label="Review deadline" type="date" min={cycle.periodEnd} value={due} onChange={e => setDue(e.target.value)} required/></div>}<Note label={withdrawn ? 'Reason for reinstating this employee' : 'Reason for withdrawing this employee'}/><Button variant={withdrawn ? 'default' : 'outline'} disabled={save.isPending || withdrawn && (!reviewer || !due)}>{withdrawn ? 'Reinstate participant' : 'Withdraw participant'}</Button>
    </form>
  </Section>;
}
