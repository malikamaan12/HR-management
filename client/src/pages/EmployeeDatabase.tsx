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
  return <div className="space-y-6"><Card>
    <CardHeader className="flex flex-row flex-wrap gap-3 items-center justify-between">
      <div><CardTitle>Employee Database</CardTitle><p className="mt-2 text-sm text-muted-foreground">Permanent, temporary and contract staff across your organization.</p></div>
      {data?.canCreate && <Button onClick={() => setShowAdd(true)}>Add Employee</Button>}
    </CardHeader>
    <CardContent>
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
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground">{['Employee', 'Position', 'Department', 'Type', 'Status', 'Joined', ''].map((label, i) => <th key={i} className="p-3 font-medium">{label}</th>)}</tr></thead>
          <tbody>{isLoading ? <tr><td className="p-8 text-center" colSpan={7}>Loading employees…</td></tr> : !data?.employees.length ?
            <tr><td className="p-8 text-center" colSpan={7}>{query || type || status ? 'No employees match these filters.' : 'No employee records yet.'}</td></tr> : data.employees.map(employee =>
              <tr key={employee.id} className="border-b hover:bg-muted/40">
                <td className="p-3"><button className="text-left font-medium text-primary hover:underline" onClick={() => setSelected(employee.id)}>{employee.firstName} {employee.lastName}</button><div className="text-xs text-muted-foreground">{employee.employeeId}</div></td>
                <td className="p-3">{employee.position}</td><td className="p-3">{employee.department}</td><td className="p-3 capitalize">{employee.type}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${getStatusClass(employee.status)}`}>{employee.status.replace('_', ' ')}</span></td>
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
