import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { siteTimeToIso } from '@shared/workforce';
import type { TimesheetRow } from '@shared/timesheets';
import type { PresenceView } from '@shared/workforce-operations';
import type { LocationEvidence } from '@shared/attendance-location';
import { Field, QueryError, fieldClass, useAction } from './Operations';

function stamp(value: string, zone: string) { return new Date(value).toLocaleString([], { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }); }
function wall(value: string, zone: string) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
function LocationSummary({ label, evidence }: { label: string; evidence?: LocationEvidence | null }) {
  return <div className="rounded-md border p-3 text-sm"><p className="font-medium">{label}</p>{!evidence ? <p className="mt-1 text-muted-foreground">No location evidence recorded.</p> : evidence.status === 'verified' ? <><p className="mt-1">Verified within {evidence.fence?.name || 'the assigned geofence'}.</p><p className="mt-1 text-xs text-muted-foreground">{evidence.distanceMeters !== undefined ? `${Math.round(evidence.distanceMeters)} m from centre · ` : ''}{evidence.fix ? `GPS accuracy ${Math.round(evidence.fix.accuracy)} m · ` : ''}Policy v{evidence.policyVersion}</p></> : evidence.status === 'exception' ? <><p className="mt-1">Supervisor exception</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{evidence.reason || 'See attendance review reason.'}</p></> : <p className="mt-1 text-muted-foreground">Location was not required by the saved policy.</p>}</div>;
}
function MissingAttendance({ row }: { row: TimesheetRow }) {
  const [start, setStart] = useState(() => wall(row.actualStartAt, row.timezone)), [end, setEnd] = useState(() => wall(row.actualEndAt, row.timezone));
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const save = useAction(() => { setReason(''); setConfirmed(false); });
  return <form className="space-y-3 rounded-md border p-4" onSubmit={event => { event.preventDefault(); setError(''); try { const startAt = siteTimeToIso(start, row.timezone), endAt = siteTimeToIso(end, row.timezone); if (!confirmed) throw new Error('Confirm the completed attendance before saving an exception'); if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error('Finish time must follow start time'); save.mutate({ url: `/api/workforce/assignments/${row.assignmentId}/attendance-exception`, body: { startAt, endAt, reason } }); } catch (e) { setError(e instanceof Error ? e.message : 'Check the attendance times'); } }}>
    <h3 className="font-medium">Record missing attendance exception</h3><p className="text-sm text-muted-foreground">No arrival or departure was recorded for this assignment. Confirm the actual attendance and explain the missing clock-in. Saving records supervisor-approved attendance with an exception, without GPS verification.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label={`Actual arrival (${row.timezone})`}><input className={fieldClass} required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></Field><Field label={`Actual departure (${row.timezone})`}><input className={fieldClass} required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></Field></div>
    <Field label="Reason and supporting facts"><textarea className={fieldClass} required minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why attendance was missing and how you verified the employee's presence." /></Field>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" required type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I independently verified this employee's completed attendance and approve the exception.</label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<QueryError error={save.error} /><Button disabled={!confirmed || save.isPending}>Approve attendance exception</Button>
  </form>;
}
function RecordedAttendance({ presence, zone }: { presence: PresenceView; zone: string }) {
  const [reason, setReason] = useState(''), save = useAction(() => setReason(''));
  const status = presence.approvalStatus || 'pending';
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">Arrived {stamp(presence.arrivedAt, zone)} → {presence.departedAt ? stamp(presence.departedAt, zone) : 'Visit still open'}</p><Badge variant={status === 'rejected' ? 'destructive' : 'secondary'}>Attendance {status}</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2"><LocationSummary label="Arrival location" evidence={presence.locationIn} /><LocationSummary label="Departure location" evidence={presence.locationOut} /></div>
    {!!presence.flags.length && <p className="text-sm">Review flags: {presence.flags.join('; ')}</p>}{presence.departureReason && <p className="text-sm">Departure note: {presence.departureReason}</p>}{presence.reviewedAt && <p className="rounded-md bg-muted p-3 text-sm">Reviewed {stamp(presence.reviewedAt, zone)}: {presence.reviewNote}</p>}
    {!presence.departedAt ? <p className="text-sm text-muted-foreground">The employee or an authorized scheduling supervisor must close this visit before attendance can be approved. Open the assignment in <Link href="/event-staff" className="text-primary underline">Workforce Operations</Link>.</p> : !presence.reviewedAt && status === 'pending' && <form className="space-y-3" onSubmit={event => { event.preventDefault(); const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value'); if (action !== 'approve' && action !== 'reject') return; save.mutate({ url: `/api/workforce/presence/${presence.id}/review`, body: { version: presence.version, action, reason } }); }}>
      <Field label="Supervisor attendance decision reason"><textarea className={fieldClass} required minLength={5} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field><div className="flex flex-wrap gap-2"><Button value="approve" disabled={save.isPending}>Approve attendance</Button><Button variant="outline" value="reject" disabled={save.isPending}>Reject attendance</Button></div><QueryError error={save.error} />
    </form>}
  </div>;
}
export default function TimesheetAttendanceReview({ row }: { row: TimesheetRow }) {
  const query = useQuery<{ presence: PresenceView | null }>({ queryKey: [`/api/workforce/assignments/${row.assignmentId}/attendance-review`] });
  return <Card><CardHeader><CardTitle>Supervisor attendance approval</CardTitle><p className="text-sm text-muted-foreground">Review attendance and location evidence before approving payable hours.</p></CardHeader><CardContent className="space-y-4">{query.isLoading ? <p>Loading attendance…</p> : query.error || !query.data ? <><p role="alert" className="text-sm">Attendance review requires a current, independent supervisor with team time-review access.</p><Button variant="outline" onClick={() => query.refetch()}>Reload attendance</Button></> : query.data.presence ? <RecordedAttendance key={`${query.data.presence.id}-${query.data.presence.version}-${query.data.presence.approvalStatus}`} presence={query.data.presence} zone={row.timezone} /> : <MissingAttendance row={row} />}</CardContent></Card>;
}
