import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, FileEdit, Users, Eye, Save, CalendarClock, ClipboardCheck, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, QueryError, fieldClass } from '@/components/hr/Operations';
import { roleLabel } from '@shared/navigation';
import { bulletinInput, type BulletinView, type HubContext } from '@shared/communications';
import { hub, useHubAction, useDebounced, localDate, dateLabel, Pager, type Page } from './HubControls';

const starters = [
  { label: 'Company update', title: 'Company update', body: 'What is changing:\n\nWhat the team needs to do:\n\nWho to contact with questions:\n' },
  { label: 'Shift briefing', title: 'Shift briefing', body: 'Today’s priorities:\n\nTeam assignments:\n\nGuest service reminders:\n\nHandover notes:\n' },
  { label: 'Safety reminder', title: 'Safety reminder', body: 'Safety reminder:\n\nRequired actions:\n\nWhere to get support:\n' },
];
export default function AnnouncementEditor({ context, value, onDone, onCancel }: { context: HubContext; value?: BulletinView; onDone: (id: number) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0), [title, setTitle] = useState(value?.title || ''), [body, setBody] = useState(value?.body || '');
  const [audience, setAudience] = useState(value?.audience || (context.canPublishCompany ? 'all' : context.canPublishDepartment ? 'department' : 'channel'));
  const [target, setTarget] = useState(value?.target || (!context.canPublishCompany && context.canPublishDepartment ? context.department || '' : ''));
  const [selectedAudience, setSelectedAudience] = useState(value ? { kind: value.audience, id: value.target, name: value.audience_label } : null);
  const [scheduled, setScheduled] = useState(!!value && new Date(value.publish_at) > new Date());
  const [publish, setPublish] = useState(localDate(value?.publish_at)), [expiry, setExpiry] = useState(value?.expires_at ? localDate(value.expires_at) : '');
  const [ack, setAck] = useState(value?.requires_acknowledgement || false), [pin, setPin] = useState(value?.pinned || false), [why, setWhy] = useState(''), [error, setError] = useState('');
  const [q, setQ] = useState(''), [offset, setOffset] = useState(0), search = useDebounced(q);
  const options = useQuery<Page<{ id: string; name: string }>>({ queryKey: [`${hub}/bulletins/audience-options?kind=${audience}&q=${encodeURIComponent(search)}&offset=${offset}`], enabled: step > 0 && ['department', 'channel'].includes(audience) });
  const estimate = useQuery<{ eligible: number }>({ queryKey: [`${hub}/bulletins/audience-preview?audience=${audience}&target=${encodeURIComponent(target)}`], enabled: step > 0 && (audience === 'all' || !!target), staleTime: 0 });
  const save = useHubAction(r => onDone(r.id));
  const audienceName = audience === 'all' ? 'Whole company' : audience === 'role' ? roleLabel(target) : options.data?.items.find(item => item.id === target)?.name || (selectedAudience?.kind === audience && selectedAudience.id === target ? selectedAudience.name : target);
  function definition() {
    const start = scheduled ? new Date(publish) : new Date(), end = expiry ? new Date(expiry) : null;
    return { title, body, audience, target, publishAt: Number.isFinite(+start) ? start.toISOString() : '', expiresAt: end && Number.isFinite(+end) ? end.toISOString() : expiry ? '' : null, requiresAcknowledgement: ack, pinned: pin, reason: why };
  }
  function next() {
    if (step === 0 && (title.trim().length < 3 || body.trim().length < 3)) { setError('Add a title and message with at least three characters each.'); return; }
    if (step === 1) {
      const check = bulletinInput.safeParse({ ...definition(), reason: 'Preview announcement draft' });
      if (!check.success) { setError(check.error.issues.map(issue => issue.message).join('; ')); return; }
      if (estimate.error || estimate.isPending) { setError('Wait for the audience check or choose an available audience.'); return; }
    }
    setError(''); setStep(step + 1);
  }
  function submit() {
    const parsed = bulletinInput.safeParse(definition());
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join('; ')); return; }
    setError(''); save.mutate({ path: value ? `/bulletins/${value.id}` : '/bulletins', method: value ? 'PATCH' : 'POST', body: value ? { version: value.version, definition: parsed.data } : parsed.data });
  }
  return <section className="space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{value ? 'Edit draft' : 'Create an announcement'}</h2><p className="mt-1 text-sm text-muted-foreground">Write, choose recipients and review. You publish separately after saving.</p></div><Button variant="ghost" onClick={onCancel} disabled={save.isPending}>Cancel draft</Button></div>
    <ol className="grid grid-cols-3 gap-2" aria-label="Draft progress">{[{ label: 'Message', Icon: FileEdit }, { label: 'Audience & timing', Icon: Users }, { label: 'Review', Icon: Eye }].map((item, i) => <li key={item.label} aria-current={step === i ? 'step' : undefined} className={`flex items-center gap-2 rounded-xl border p-3 text-xs sm:text-sm ${step === i ? 'border-primary bg-primary/5 font-semibold text-primary' : 'text-muted-foreground'}`}><item.Icon className="hidden h-4 w-4 shrink-0 sm:block"/><span>{i + 1}. {item.label}</span></li>)}</ol>
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); step < 2 ? next() : submit(); }}><fieldset disabled={save.isPending} className="space-y-5">
      {step === 0 && <>
        {!value && !title && !body && <div className="rounded-xl bg-muted/40 p-4"><p className="mb-3 text-sm font-medium">Start with a blank notice or a simple outline</p><div className="flex flex-wrap gap-2">{starters.map(starter => <Button key={starter.label} type="button" size="sm" variant="outline" onClick={() => { setTitle(starter.title); setBody(starter.body); }}>{starter.label}</Button>)}</div></div>}
        <Field label="Announcement title"><input autoFocus required minLength={3} maxLength={180} className={fieldClass} value={title} placeholder="Give your team a clear headline" onChange={e => setTitle(e.target.value)}/></Field>
        <Field label="Message"><textarea required rows={9} minLength={3} maxLength={20000} className={fieldClass + ' leading-relaxed'} value={body} placeholder="Explain what the team needs to know and what to do next…" onChange={e => setBody(e.target.value)}/></Field><p className="text-right text-xs text-muted-foreground">{body.length.toLocaleString()} / 20,000 characters</p>
      </>}
      {step === 1 && <>
        <div className="grid gap-4 md:grid-cols-2"><Field label="Who should see this?"><select className={fieldClass} value={audience} onChange={e => { setAudience(e.target.value); setTarget(e.target.value === 'department' && !context.canPublishCompany ? context.department || '' : ''); setQ(''); setOffset(0); }}>
          {context.canPublishCompany && <option value="all">Whole company</option>}{context.canPublishDepartment && <option value="department">A department</option>}{context.canPublishCompany && <option value="role">A role</option>}<option value="channel">A team / event channel</option>
        </select></Field>
        {audience === 'role' && <Field label="Recipient role"><select required className={fieldClass} value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose a role…</option>{context.roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></Field>}
        {['department', 'channel'].includes(audience) && <div className="space-y-2"><input className={fieldClass} aria-label="Find audience" placeholder={audience === 'channel' ? 'Find a channel you manage…' : 'Find a department…'} maxLength={100} value={q} onChange={e => { setQ(e.target.value); setOffset(0); }}/><Field label={audience === 'channel' ? 'Team / event channel' : 'Department'}><select required className={fieldClass} value={target} onChange={e => { const id = e.target.value; setTarget(id); const choice = options.data?.items.find(item => item.id === id); if (choice) setSelectedAudience({ kind: audience, id, name: choice.name }); }}><option value="">Choose…</option>{target && !options.data?.items.some(item => item.id === target) && <option value={target}>{audienceName}</option>}{!options.error && options.data?.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Pager offset={offset} hasMore={!options.error && options.data?.hasMore} onChange={setOffset}/><QueryError error={options.error}/></div>}</div>
        <div className="flex gap-3 rounded-xl bg-primary/5 p-4"><Users className="mt-1 h-5 w-5 shrink-0 text-primary"/><div><p className="text-sm font-semibold">{estimate.error ? 'Audience check unavailable' : estimate.data ? `${estimate.data.eligible} eligible accounts now` : 'Choose an audience to check recipients'}</p><p className="mt-1 text-xs text-muted-foreground">Includes active accounts that can currently access the Hub. Account setup, employment and team access affect this count; it can change before publication.</p><QueryError error={estimate.error}/></div></div>
        <div className="grid gap-4 md:grid-cols-2"><div className="space-y-3"><Field label="When should it become visible?"><select className={fieldClass} value={scheduled ? 'later' : 'now'} onChange={e => setScheduled(e.target.value === 'later')}><option value="now">When I publish it</option><option value="later">At a scheduled time</option></select></Field>{scheduled && <Field label="Visible from (device timezone)"><input required type="datetime-local" className={fieldClass} value={publish} onChange={e => setPublish(e.target.value)}/></Field>}</div><Field label="Expires at (optional, device timezone)"><input type="datetime-local" className={fieldClass} value={expiry} onChange={e => setExpiry(e.target.value)}/></Field></div>
        <div className="grid gap-3 sm:grid-cols-2">{[{ checked: ack, change: setAck, Icon: ClipboardCheck, title: 'Require acknowledgement', text: 'Track an explicit confirmation from each recipient.' }, { checked: pin, change: setPin, Icon: Pin, title: 'Pin this notice', text: 'Keep the notice near the top of the announcement list.' }].map(item => <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4" key={item.title}><input type="checkbox" className="mt-1" checked={item.checked} onChange={e => item.change(e.target.checked)}/><span><strong className="flex items-center gap-2 text-sm"><item.Icon className="h-4 w-4"/>{item.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{item.text}</span></span></label>)}</div>
      </>}
      {step === 2 && <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]"><article className="rounded-xl border p-5"><p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recipient preview</p><h3 className="break-words text-xl font-semibold">{title}</h3><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">{body}</p></article><aside className="space-y-4 rounded-xl bg-muted/40 p-4 text-sm"><p className="flex gap-2"><Users className="h-4 w-4 shrink-0"/>{audienceName}</p><p>{estimate.data?.eligible ?? '—'} eligible accounts now</p><p className="flex gap-2"><CalendarClock className="h-4 w-4 shrink-0"/>{scheduled ? dateLabel(publish) : 'Visible after you publish'}</p>{expiry && <p>Expires {dateLabel(expiry)}</p>}<p>{ack ? 'Acknowledgement required' : 'For information'}</p><p>{pin ? 'Pinned notice' : 'Standard placement'}</p></aside></div>
        <Field label="Reason for this draft"><input required minLength={5} maxLength={2000} className={fieldClass} value={why} placeholder="For example: Share the updated shift briefing" onChange={e => setWhy(e.target.value)}/></Field><p className="text-xs text-muted-foreground">Saving creates a draft. Recipients will see it only after an authorized publisher confirms publication.</p>
      </>}
      <QueryError error={save.error || error}/><div className="flex flex-wrap justify-between gap-3 border-t pt-4"><Button type="button" variant="outline" disabled={step === 0 || save.isPending} onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft className="mr-2 h-4 w-4"/>Back</Button><Button type="submit" disabled={save.isPending} className="gap-2">{step < 2 ? <>Continue<ArrowRight className="h-4 w-4"/></> : <><Save className="h-4 w-4"/>{save.isPending ? 'Saving…' : 'Save draft'}</>}</Button></div>
    </fieldset></form>
  </section>;
}
