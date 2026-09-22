import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {MetricCard} from '@/components/ux/ModuleVisuals';
import {DistributionCard} from '@/components/ux/WorkspaceUI';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Section, Table, fieldClass, useAction, QueryError, downloadCsv } from '@/components/hr/Operations';
import { siteTimeToIso } from '@shared/workforce';
import { useAuth } from '@/contexts/AuthContext';
import {AttendanceLocationManagement,AttendanceSupervisorQueue,type AttendanceLocationContext} from '@/components/hr/AttendanceLocations';
import {readAttendancePosition} from '@/lib/attendance-location';
type Correction = {
    id: number;
    name: string;
    date: string;
    reason: string;
    status: string;
    reviewNote: string;
    canDecide: boolean;
    proposal: {
        checkIn: string;
        checkOut: string;
        breakMinutes: number;
    };
};
export default function AttendanceOperations() {
    const { user } = useAuth(), [employee, setEmployee] = useState(''), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [start, setStart] = useState(''), [end, setEnd] = useState(''), [breaks, setBreaks] = useState(0), [reason, setReason] = useState(''), [review, setReview] = useState<{
        id: number;
        decision: string;
    } | null>(null), [note, setNote] = useState(''), [error, setError] = useState(''), [from, setFrom] = useState(date.slice(0, 7) + '-01'), [to, setTo] = useState(date);
    const options = useQuery<{
        id: number;
        name: string;
        own: boolean;
    }[]>({ queryKey: ['/api/attendance-operations/options'] });
    useEffect(() => { if (!employee && options.data)
        setEmployee(String(options.data.find(e => e.own)?.id || options.data[0]?.id || '')); }, [options.data, employee]);
    const current = useQuery<any>({ queryKey: ['/api/attendance/today'] });
    const day = useQuery<any>({ queryKey: [`/api/attendance-operations/day/${employee}/${date}`], enabled: !!employee && !!date });
    const corrections = useQuery<Correction[]>({ queryKey: ['/api/attendance-operations/corrections'] });
    const reports = useQuery<{
        details: any[];
    }>({ queryKey: [`/api/attendance/reports/monthly?start=${from}&end=${to}`], enabled: !!from && !!to });
    const action = useAction(() => { setReview(null); setReason(''); });
    const location=useQuery<AttendanceLocationContext>({queryKey:['/api/attendance/location/context']});
    const [locating,setLocating]=useState(false),[clockError,setClockError]=useState<unknown>(null);
    async function clock(key:string){setClockError(null);setLocating(true);try{const position=['in','out'].includes(key)&&location.data?.policy.config.required?await readAttendancePosition():undefined;await action.mutateAsync({url:'/api/attendance/clock-'+key,body:position?{position}:{}});}catch(e){setClockError(e);}finally{setLocating(false);}}
    const [tab,setTab]=useState('records');
    const ownEmployee = options.data?.find(employee => employee.own);
    const clockStatus = options.isLoading || current.isLoading ? 'Checking your time clock…' : options.error || current.error ? 'Time clock unavailable. Reload to try again.' : !ownEmployee ? 'Your account is not linked to an employee record. Ask HR to link it in User Management before using the time clock.' : null;
    const clocked = current.data?.checkIn && !current.data?.checkOut, onBreak = clocked && current.data?.breakStartTime && !current.data?.breakEndTime;
    return <div className="space-y-6"><div className="flex flex-wrap justify-between gap-3"><h1 className="text-2xl font-bold">Attendance</h1>{['admin', 'super_admin'].includes(user?.role || '') && <a href="/hr-rules" className="underline text-primary">Configure employee calendars</a>}</div><Tabs value={tab} onValueChange={setTab}><TabsList aria-label="Attendance workspace"><TabsTrigger value="records">Records & reports</TabsTrigger><TabsTrigger value="clock">My time clock</TabsTrigger><TabsTrigger value="corrections">Corrections</TabsTrigger><TabsTrigger value="approvals">Approvals</TabsTrigger>{location.data?.canManage&&<TabsTrigger value="locations">Locations</TabsTrigger>}</TabsList><TabsContent value="clock" className="space-y-4"><Section title="My time clock"><QueryError error={current.error || location.error || clockError}/><p className="text-sm">{location.data?.policy.config.required ? 'Location is checked at clock-in and clock-out. Allow location access on this device.' : 'GPS enforcement is awaiting location setup or is disabled by an administrator.'} {locating ? 'Reading location…' : ''}</p><p>{clockStatus || (clocked ? 'Clocked in since ' + new Date(current.data.checkIn).toLocaleString() : current.data?.checkOut ? 'Completed at ' + new Date(current.data.checkOut).toLocaleString() : 'Ready to clock in')}</p><div className="flex flex-wrap gap-3">{[['in', 'Clock in', !clocked && !current.data?.checkOut], ['break_start', 'Start break', clocked && !onBreak], ['break_end', 'End break', onBreak], ['out', 'Clock out', clocked]].map(([key, label, enabled]) => <Button key={String(key)} disabled={!ownEmployee || options.isLoading || current.isLoading || !!options.error || !!current.error || !enabled || action.isPending || locating || !location.data} onClick={() => clock(String(key))}>{label}</Button>)}</div></Section>
 </TabsContent><TabsContent value="locations"><AttendanceLocationManagement/></TabsContent><TabsContent value="approvals"><div className="mb-4 flex flex-wrap gap-3"><Field label="From"><input className={fieldClass} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></Field><Field label="To"><input className={fieldClass} type="date" value={to} onChange={e=>setTo(e.target.value)}/></Field></div><AttendanceSupervisorQueue from={from} to={to}/></TabsContent><TabsContent value="corrections" className="space-y-4"><Section title="Schedule and recorded time"><div className="grid gap-4 md:grid-cols-2"><Field label="Employee"><select className={fieldClass} value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Select employee</option>{options.data?.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field><Field label="Attendance date"><input className={fieldClass} type="date" value={date} onChange={e => setDate(e.target.value)}/></Field></div><QueryError error={options.error || day.error}/>{day.data && <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label="Scheduled minutes" value={day.data.plannedMinutes}/><MetricCard label="Recorded minutes" value={day.data.record?.totalWorkHours??'—'}/><MetricCard label="Difference (min)" value={day.data.varianceMinutes??'—'}/><MetricCard label="Approval" value={day.data.record?.approvalStatus||'Not required'}/></div><p className="text-xs text-muted-foreground">{day.data.policy.timezone}{day.data.holiday?` · ${day.data.holiday}`:''}</p><Table headers={['Team', 'Role', 'Start', 'End']} rows={day.data.roster.map((r: any) => [r.team, r.role, new Date(r.startAt).toLocaleString(undefined, { timeZone: r.timezone }), new Date(r.endAt).toLocaleString(undefined, { timeZone: r.timezone })])}/><a className="text-primary underline" href="/workforce">View workforce assignments</a></>}</Section>
 <Section title="Request an attendance correction"><p className="text-sm">Enter the full corrected work interval in {day.data?.policy.timezone || 'the employee timezone'}. An independent approver reviews it before the recorded hours change.</p><form className="space-y-3" onSubmit={e => { e.preventDefault(); try {
        setError('');
        action.mutate({ url: '/api/attendance-operations/corrections', body: { employeeId: Number(employee), date, expectedVersion: day.data?.record?.version || 0, checkIn: siteTimeToIso(start, day.data.policy.timezone), checkOut: siteTimeToIso(end, day.data.policy.timezone), breakMinutes: breaks, reason } });
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Check the times');
    } }}><div className="grid gap-4 md:grid-cols-3"><Field label="Actual check-in"><input className={fieldClass} type="datetime-local" value={start} required onChange={e => setStart(e.target.value)}/></Field><Field label="Actual check-out"><input className={fieldClass} type="datetime-local" value={end} required onChange={e => setEnd(e.target.value)}/></Field><Field label="Total break minutes"><input className={fieldClass} type="number" min={0} value={breaks} required onChange={e => setBreaks(Number(e.target.value))}/></Field></div><Field label="Reason for correction"><textarea className={fieldClass} minLength={5} required value={reason} onChange={e => setReason(e.target.value)}/></Field>{error && <p role="alert">{error}</p>}<Button disabled={!day.data || action.isPending}>Submit correction</Button></form></Section>
 <Section title="Correction approvals and history"><QueryError error={corrections.error}/><Table headers={['Employee', 'Date', 'Proposed work', 'Reason', 'Status', 'Review', 'Actions']} rows={(corrections.data || []).map(c => [c.name, c.date, new Date(c.proposal.checkIn).toLocaleString() + ' → ' + new Date(c.proposal.checkOut).toLocaleString() + ' / break ' + c.proposal.breakMinutes + ' min', c.reason, c.status, c.reviewNote || '—', c.canDecide && c.status === 'pending' ? <div className="flex gap-2">{['approved', 'rejected'].map(d => <Button variant="outline" key={d} onClick={() => { setReview({ id: c.id, decision: d }); setNote(''); }}>{d === 'approved' ? 'Approve' : 'Reject'}</Button>)}</div> : null])}/>{review && <form className="space-y-3 rounded border p-4" onSubmit={e => { e.preventDefault(); action.mutate({ url: `/api/attendance-operations/corrections/${review.id}/review`, body: { decision: review.decision, reason: note } }); }}><p>Correction #{review.id}: {review.decision}</p><Field label="Review reason"><input className={fieldClass} minLength={5} required value={note} onChange={e => setNote(e.target.value)}/></Field><Button disabled={action.isPending}>Save decision</Button> <Button variant="outline" type="button" onClick={() => setReview(null)}>Close</Button></form>}</Section>
 </TabsContent><TabsContent value="records" className="space-y-4"><Section title="Attendance report"><div className="flex flex-wrap gap-3"><Field label="From"><input className={fieldClass} type="date" value={from} onChange={e => setFrom(e.target.value)}/></Field><Field label="To"><input className={fieldClass} type="date" value={to} onChange={e => setTo(e.target.value)}/></Field><Button variant="outline" disabled={!reports.data?.details.length} onClick={() => downloadCsv('attendance.csv', [['Employee', 'Date', 'Status', 'Work minutes', 'Break minutes', 'Supervisor approval'], ...(reports.data?.details || []).map(r => [r.employeeName, r.date, r.status, r.totalWorkHours, r.totalBreakMinutes, r.approvalStatus])])}>Export CSV</Button></div><QueryError error={reports.error}/><>{reports.data&&!reports.error&&<DistributionCard title="Attendance mix" description="Records in the selected period" items={Object.entries(reports.data.details.reduce((counts:Record<string,number>,r:any)=>{counts[r.status]=(counts[r.status]||0)+1;return counts;},{})).map(([label,value])=>({label:label.replaceAll('_',' '),value:Number(value)}))}/>}</><Table key={`${from}:${to}`} pageSize={12} headers={['Employee', 'Date', 'Status', 'Work minutes', 'Break minutes', 'Supervisor approval']} rows={(reports.data?.details || []).map(r => [r.employeeName, r.date, r.status, r.totalWorkHours ?? '—', r.totalBreakMinutes, r.approvalStatus])}/></Section></TabsContent></Tabs></div>;
}
