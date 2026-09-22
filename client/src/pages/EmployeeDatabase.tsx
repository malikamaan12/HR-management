import {PageHeading} from '@/components/ux/WorkspaceUI';
import {StatusPill} from '@/components/ux/ModuleVisuals';
import {Users,LayoutGrid,List,Briefcase,MapPin} from 'lucide-react';
import {CorrectionInbox} from '@/components/employee/Corrections';
import type { ApiEmployeeDirectory } from '@/lib/api-types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, getStatusClass } from '@/lib/utils';
import AddEditEmployeeModal from '@/components/employee/AddEditEmployeeModal';
import EmployeeProfile from '@/components/employee/EmployeeProfile';

export default function EmployeeDatabase() {
  const [view,setView]=useState<'table'|'cards'>('cards');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const { data, isLoading, error, refetch } = useQuery<ApiEmployeeDirectory>({
    queryKey: ['/api/employees/directory', { q: query, type, status, page, limit: 25 }],
  });
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 25));
  useEffect(() => { if (data && page > pages) setPage(pages); }, [data, pages, page]);
  if (selected) return <EmployeeProfile employeeId={selected} onClose={() => setSelected(null)} />;
  return <div className="space-y-5"><PageHeading title="People" description="Your employee directory." icon={Users} actions={data?.canCreate&&<Button onClick={()=>setShowAdd(true)}>Add employee</Button>}/><Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{data?`${data.total} employees`:'Employee directory'}</h2><div className="flex rounded-lg border p-1" role="group" aria-label="Directory display"><Button size="sm" variant={view==='table'?'secondary':'ghost'} aria-pressed={view==='table'} onClick={()=>setView('table')}><List className="h-4 w-4"/>Table</Button><Button size="sm" variant={view==='cards'?'secondary':'ghost'} aria-pressed={view==='cards'} onClick={()=>setView('cards')}><LayoutGrid className="h-4 w-4"/>Cards</Button></div></div></CardHeader>
    <CardContent>{data?.canCreate&&<CorrectionInbox select={setSelected}/>}
      <div className="grid gap-3 md:grid-cols-[1fr_180px_180px] mb-5">
        <Input aria-label="Search employees" placeholder="Search name, ID, department, role or location" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Employee type" className="h-10 rounded-md border bg-background px-3" value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option><option value="permanent">Permanent</option><option value="temporary">Temporary / event</option><option value="contract">Contract</option>
        </select>
        <select aria-label="Employee status" className="h-10 rounded-md border bg-background px-3" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option><option value="active">Active</option><option value="on_leave">On leave</option><option value="inactive">Inactive</option>
        </select>
      </div>
      {error ? <div role="alert" className="py-8 text-center"><p>Unable to load employees.</p><Button variant="outline" className="mt-3" onClick={() => refetch()}>Retry</Button></div> :
        view==='cards'?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{isLoading?<p role="status">Loading employees…</p>:!data?.employees.length?<p className="p-5 text-sm text-muted-foreground">No employees match these filters.</p>:data.employees.map(employee=><button key={employee.id} onClick={()=>setSelected(employee.id)} className="person-card group rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><div className="flex items-start justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">{employee.firstName[0]}{employee.lastName[0]}</span><StatusPill value={employee.status}/></div><h3 className="mt-3 font-semibold">{employee.firstName} {employee.lastName}</h3><p className="mt-1 text-xs text-muted-foreground">{employee.employeeId} · {employee.type}</p><p className="mt-4 flex items-center gap-2 text-sm"><Briefcase aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground"/>{employee.position}</p><p className="mt-2 text-xs text-muted-foreground">{employee.department}</p></button>)}</div>:
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground">{['Employee', 'Position', 'Department', 'Type', 'Status', 'Joined', ''].map((label, i) => <th key={i} className="p-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{isLoading ? <tr><td className="p-8 text-center" colSpan={7}>Loading employees…</td></tr> : !data?.employees.length ?
            <tr><td className="p-8 text-center" colSpan={7}>{query || type || status ? 'No employees match these filters.' : 'No employee records yet.'}</td></tr> : data.employees.map(employee =>
              <tr key={employee.id} className="border-b hover:bg-muted/40">
                <td className="p-3"><button className="text-left font-medium text-primary hover:underline" onClick={() => setSelected(employee.id)}>{employee.firstName} {employee.lastName}</button><div className="text-xs text-muted-foreground">{employee.employeeId}</div></td>
                <td className="p-3">{employee.position}</td><td className="p-3">{employee.department}</td><td className="p-3 capitalize">{employee.type}</td>
                <td className="p-3"><StatusPill value={employee.status}/></td>
                <td className="p-3 whitespace-nowrap">{formatDate(employee.joiningDate)}</td>
                <td className="p-3"><Button variant="ghost" size="sm" aria-label={`View ${employee.firstName} ${employee.lastName}`} onClick={() => setSelected(employee.id)}>View</Button></td>
              </tr>)}</tbody>
        </table></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">{data ? `${data.total} employee${data.total === 1 ? '' : 's'} · Page ${page} of ${pages}` : ''}</p>
        <div className="flex gap-2"><Button variant="outline" disabled={isLoading || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={isLoading || !data || page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
      </div>
    </CardContent>
  </Card><AddEditEmployeeModal open={showAdd} onOpenChange={setShowAdd} onSuccess={() => { setPage(1); refetch(); }} /></div>;
}
