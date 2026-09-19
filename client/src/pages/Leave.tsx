import {useAuth} from '@/contexts/AuthContext';
import {hasPermission} from '@shared/permissions';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {MetricCard,StatusPill,ActionLink} from '@/components/ux/ModuleVisuals';
import {CalendarDays,Clock,CheckCircle2} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Section, Table, fieldClass, useAction, QueryError } from '@/components/hr/Operations';
import { apiJson } from '@/lib/queryClient';
type Row = {
    id: number;
    employeeId: number;
    employee: {
        firstName: string;
        lastName: string;
    };
    leaveType: {
        name: string;
    };
    startDate: string;
    endDate: string;
    totalDays: number;
    status: string;
    reason: string;
    canDecide: boolean;
    canCancel: boolean;
    reviewVersion:number;
    approvalStage:number;
    approvalStageCount:number;
    dayPortion:string;
};
export default function Leave() {
    const {user}=useAuth();
    const canReview=!!user&&hasPermission(user.role,'leave_absence_management','approve');
    const [workspaceTab,setWorkspaceTab]=useState('requests');
    const [dayPortion,setDayPortion]=useState('full'),[historyId,setHistoryId]=useState<number|null>(null),[historyOffset,setHistoryOffset]=useState(0);
    const history=useQuery<any>({queryKey:[`/api/leaves/${historyId}/history`,{offset:historyOffset}],enabled:!!historyId});
    const today = new Date().toISOString().slice(0, 10), [employee, setEmployee] = useState(''), [type, setType] = useState(''), [start, setStart] = useState(today), [end, setEnd] = useState(today), [reason, setReason] = useState(''), [tab, setTab] = useState('pending'), [month, setMonth] = useState(today.slice(0, 7)), [year, setYear] = useState(Number(today.slice(0, 4))), [decision, setDecision] = useState<{
        row: Row;
        status: string;
    } | null>(null), [note, setNote] = useState(''), [days, setDays] = useState(''), [adjustReason, setAdjustReason] = useState('');
    const options = useQuery<{
        employees: {
            id: number;
            name: string;
            own: boolean;
        }[];
        types: string[];
        canConfigure: boolean;
    }>({ queryKey: ['/api/leaves/options'] });
    useEffect(() => { if (!employee && options.data)
        setEmployee(String(options.data.employees.find(e => e.own)?.id || options.data.employees[0]?.id || '')); }, [options.data, employee]);
    const requests = useQuery<Row[]>({ queryKey: ['/api/leaves'] }), balances = useQuery<{
        balances: {
            type: string;
            balance: number;
            reserved: number;
            available: number;
            balanceRequired: boolean;
        }[];
        history: {
            id: number;
            units: number;
            leaveType: string;
            reason: string;
            createdAt: string;
        }[];
    }>({ queryKey: [`/api/leaves/balances/${employee}/${year}`], enabled: !!employee });
    const preview = useQuery<{
        totalDays: number;
        daysByYear: Record<string, number>;
    }>({ queryKey: ['leave-preview', employee, type, start, end,dayPortion], queryFn: () => apiJson('/api/leaves/preview', { method: 'POST', body: { employeeId: Number(employee), leaveType: type, startDate: start, endDate: end,dayPortion } }), enabled: !!employee && !!type && !!start && !!end, retry: false });
    const action = useAction(() => { setDecision(null); setReason(''); setAdjustReason(''); setDays(''); });
    const list = (requests.data || []).filter(r => tab === 'all' || r.status === tab);
    const startOfMonth = month + '-01', monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
    return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Leave and absence</h1>{options.data?.canConfigure && <ActionLink href="/hr-rules">Leave rules & holidays</ActionLink>}</div><QueryError error={options.error || requests.error}/><div className="grid grid-cols-2 gap-3 [&>div:last-child]:col-span-2 sm:grid-cols-3 sm:[&>div:last-child]:col-span-1"><MetricCard label="Pending requests" value={requests.isLoading?'…':requests.error?'—':(requests.data||[]).filter(r=>r.status==='pending').length} icon={Clock} tone="attention"/><MetricCard label="Approved requests" value={requests.isLoading?'…':requests.error?'—':(requests.data||[]).filter(r=>r.status==='approved').length} icon={CheckCircle2} tone="positive"/><MetricCard label={canReview?'Awaiting your decision':'Total requests'} value={requests.isLoading?'…':requests.error?'—':(requests.data||[]).filter(r=>!canReview||r.status==='pending'&&r.canDecide).length} icon={CalendarDays}/></div><Tabs value={workspaceTab} onValueChange={setWorkspaceTab}><TabsList aria-label="Leave workspace"><TabsTrigger value="requests">Requests & approvals</TabsTrigger><TabsTrigger value="balances">Balances</TabsTrigger><TabsTrigger value="request">Request leave</TabsTrigger><TabsTrigger value="calendar">Calendar</TabsTrigger></TabsList><TabsContent value="requests" className="space-y-4 pt-3"> <Section title="Approvals and history"><div className="flex flex-wrap gap-2">{['pending', 'approved', 'rejected', 'cancelled', 'all'].map(t => <Button key={t} variant={t === tab ? 'default' : 'outline'} onClick={() => setTab(t)}>{t}</Button>)}</div><Table headers={['Employee', 'Leave', 'Dates', 'Days', 'Status', 'Reason', 'Actions']} rows={list.map(r => [r.employee.firstName + ' ' + r.employee.lastName, r.leaveType.name, r.startDate + ' → ' + r.endDate, r.totalDays, <><StatusPill value={r.status}/><p className="mt-1 text-xs text-muted-foreground">{r.dayPortion.replaceAll('_',' ')}</p>{r.status==='pending'&&<p>Stage {r.approvalStage+1} / {r.approvalStageCount}</p>}</>, r.reason, <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>{setHistoryId(r.id);setHistoryOffset(0);}}>History</Button>{r.canDecide && r.status === 'pending' && ['approved', 'rejected'].map(s => <Button key={s} variant="outline" onClick={() => { setDecision({ row: r, status: s }); setNote(''); }}>{s === 'approved' ? 'Approve' : 'Reject'}</Button>)}{(r.canCancel || r.canDecide && r.status === 'approved') && <Button variant="outline" onClick={() => { setDecision({ row: r, status: 'cancelled' }); setNote(''); }}>Cancel</Button>}</div>])}/>{decision && <form className="space-y-3 border rounded p-4" onSubmit={e => { e.preventDefault(); action.mutate({ url: `/api/leaves/${decision.row.id}/status`, method: 'PATCH', body: { status: decision.status,version:decision.row.reviewVersion, reason: note } }); }}><p>Set request #{decision.row.id} to {decision.status}</p><Field label="Decision reason"><input className={fieldClass} required minLength={5} value={note} onChange={e => setNote(e.target.value)}/></Field><Button disabled={action.isPending}>Save decision</Button> <Button type="button" variant="outline" onClick={() => setDecision(null)}>Close</Button></form>}</Section>
 {historyId&&<Section title="Leave decision history"><QueryError error={history.error}/><Table headers={['Version','Status','Reason','Recorded']} rows={(history.data?.items||[]).map((h:any)=>[h.version,h.status,h.reason,new Date(h.created_at).toLocaleString()])}/><Button variant="outline" disabled={!historyOffset} onClick={()=>setHistoryOffset(historyOffset-25)}>Newer</Button> <Button variant="outline" disabled={!history.data?.hasMore} onClick={()=>setHistoryOffset(historyOffset+25)}>Older</Button> <Button variant="outline" onClick={()=>setHistoryId(null)}>Close history</Button></Section>}</TabsContent><TabsContent value="balances" className="pt-3"><Section title="Employee balances"><div className="flex flex-wrap gap-4"><Field label="Employee"><select className={fieldClass} value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Select employee</option>{options.data?.employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Year"><input className={fieldClass} type="number" min={2000} max={2200} value={year} onChange={e => setYear(Number(e.target.value))}/></Field></div><QueryError error={balances.error}/><Table headers={['Leave type', 'Credited less used', 'Reserved pending', 'Available']} rows={(balances.data?.balances || []).map(b => [b.type, b.balanceRequired ? b.balance : 'No balance required', b.balanceRequired ? b.reserved : '—', b.balanceRequired ? b.available : '—'])}/><details><summary className="cursor-pointer text-sm">Balance history</summary><Table headers={['Type', 'Days', 'Reason', 'Recorded']} rows={(balances.data?.history || []).map(h => [h.leaveType, h.units / 100, h.reason, new Date(h.createdAt).toLocaleString()])}/></details>
 {options.data?.canConfigure && <details><summary className="cursor-pointer">Opening balance or adjustment</summary><form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={e => { e.preventDefault(); action.mutate({ url: '/api/leaves/adjustment', body: { employeeId: Number(employee), leaveType: type, year, days: Number(days), reason: adjustReason, key: crypto.randomUUID() } }); }}><Field label="Leave type"><select className={fieldClass} required value={type} onChange={e => setType(e.target.value)}><option value="">Select type</option>{options.data.types.map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Days to add or subtract"><input className={fieldClass} required type="number" step="0.01" value={days} onChange={e => setDays(e.target.value)}/></Field><Field label="Reason"><input className={fieldClass} required minLength={5} value={adjustReason} onChange={e => setAdjustReason(e.target.value)}/></Field><Button disabled={action.isPending || !employee}>Record adjustment</Button></form></details>}</Section>
</TabsContent><TabsContent value="request" className="pt-3"><div className="mb-4"><Field label="Employee"><select className={fieldClass} value={employee} onChange={e=>setEmployee(e.target.value)}>{options.data?.employees.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div> <Section title="Request leave"><form className="space-y-3" onSubmit={e => { e.preventDefault(); action.mutate({ url: '/api/leaves', body: { employeeId: Number(employee), leaveType: type, startDate: start, endDate: end, dayPortion, reason } }); }}><div className="grid gap-4 md:grid-cols-3"><Field label="Leave type"><select className={fieldClass} required value={type} onChange={e => setType(e.target.value)}><option value="">Select type</option>{options.data?.types.map(t => <option key={t}>{t}</option>)}</select></Field><Field label="First day"><input className={fieldClass} type="date" required value={start} onChange={e => setStart(e.target.value)}/></Field><Field label="Last day"><input className={fieldClass} type="date" required min={start} value={end} onChange={e => setEnd(e.target.value)}/></Field></div><Field label="Portion of day"><select className={fieldClass} value={dayPortion} onChange={e=>{setDayPortion(e.target.value);if(e.target.value!=='full')setEnd(start);}}><option value="full">Full day(s)</option><option value="first_half">First half of office workday</option><option value="second_half">Second half of office workday</option></select></Field><p className="text-sm text-muted-foreground">Half-days require an enabled leave rule and one office work date. The saved work schedule determines the midpoint.</p><Field label="Reason"><textarea className={fieldClass} minLength={5} required value={reason} onChange={e => setReason(e.target.value)}/></Field><QueryError error={preview.error}/>{preview.data && <p>{preview.data.totalDays} scheduled working days, after holidays.</p>}<Button disabled={action.isPending || !preview.data || !!preview.error}>Submit for approval</Button></form></Section>
</TabsContent><TabsContent value="calendar" className="pt-3"><Section title="Leave calendar"><Field label="Month"><input className={fieldClass} type="month" value={month} onChange={e => setMonth(e.target.value)}/></Field><div className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:grid-cols-7">{Array.from({ length: monthEnd }, (_, i) => { const day = month + '-' + String(i + 1).padStart(2, '0'); const entries = (requests.data || []).filter(r => r.status === 'approved' && r.startDate <= day && r.endDate >= day); return <div className="min-h-20 rounded border p-2" key={day}><p className="font-medium text-sm">{new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</p>{entries.map(r => <p className="mt-1 rounded bg-primary/10 p-1 text-xs" key={r.id}>{r.employee.firstName} {r.employee.lastName} · {r.leaveType.name} · {r.dayPortion.replaceAll('_',' ')}</p>)}</div>; })}</div></Section></TabsContent></Tabs></div>;
}
