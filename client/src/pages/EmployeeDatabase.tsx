import {useLocale} from '@/contexts/LocaleContext';
import {EmployeeAvatar} from '@/components/employee/EmployeePhoto';
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
 const {t,language}=useLocale();
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
  return <div className="space-y-5"><PageHeading title="People" description={t("Your employee directory.")} icon={Users} actions={data?.canCreate&&<Button onClick={()=>setShowAdd(true)}>{t("Add employee")}</Button>}/><Card>
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{data?`${t('Employees')}: ${data.total}`:t('Employee directory')}</h2><div className="flex rounded-lg border p-1" role="group" aria-label={t("Directory display")}><Button size="sm" variant={view==='table'?'secondary':'ghost'} aria-pressed={view==='table'} onClick={()=>setView('table')}><List className="h-4 w-4"/>{t("Table")}</Button><Button size="sm" variant={view==='cards'?'secondary':'ghost'} aria-pressed={view==='cards'} onClick={()=>setView('cards')}><LayoutGrid className="h-4 w-4"/>{t("Cards")}</Button></div></div></CardHeader>
    <CardContent>{data?.canCreate&&<CorrectionInbox select={setSelected}/>}
      <div className="grid gap-3 md:grid-cols-[1fr_180px_180px] mb-5">
        <Input aria-label={t("Search employees")} placeholder={t("Search name, ID, department, role or location")} value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label={t("Employee type")} className="h-10 rounded-md border bg-background px-3" value={type} onChange={e => { setType(e.target.value); setPage(1); }}>
          <option value="">{t("All types")}</option><option value="permanent">{t("Permanent")}</option><option value="temporary">{t("Temporary / event")}</option><option value="contract">{t("Contract")}</option>
        </select>
        <select aria-label={t("Employee status")} className="h-10 rounded-md border bg-background px-3" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t("All statuses")}</option><option value="active">{t("Active")}</option><option value="on_leave">{t("On leave")}</option><option value="inactive">{t("Inactive")}</option>
        </select>
      </div>
      {error ? <div role="alert" className="py-8 text-center"><p>{t("Unable to load employees.")}</p><Button variant="outline" className="mt-3" onClick={() => refetch()}>{t("Retry")}</Button></div> :
        view==='cards'?<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{isLoading?<p role="status">{t("Loading employees…")}</p>:!data?.employees.length?<p className="p-5 text-sm text-muted-foreground">{t("No employees match these filters.")}</p>:data.employees.map(employee=><button key={employee.id} onClick={()=>setSelected(employee.id)} className="person-card group rounded-xl border p-4 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><div className="flex items-start justify-between gap-3"><EmployeeAvatar employee={employee} className="h-14 w-14"/><StatusPill value={employee.status} label={t(employee.status.replaceAll('_',' '))}/></div><h3 className="mt-3 font-semibold">{employee.firstName} {employee.lastName}</h3><p className="mt-1 text-xs text-muted-foreground">{employee.employeeId} · {t(employee.type)}</p><p className="mt-4 flex items-center gap-2 text-sm"><Briefcase aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground"/>{employee.position}</p><p className="mt-2 text-xs text-muted-foreground">{employee.department}</p></button>)}</div>:
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b text-start text-muted-foreground">{['Employee', 'Position', 'Department', 'Type', 'Status', 'Joined', ''].map((label, i) => <th key={i} className="p-3 font-medium">{t(label)}</th>)}</tr></thead>
          <tbody>{isLoading ? <tr><td className="p-8 text-center" colSpan={7}>{t("Loading employees…")}</td></tr> : !data?.employees.length ?
            <tr><td className="p-8 text-center" colSpan={7}>{query || type || status ? t('No employees match these filters.') : t('No employee records yet.')}</td></tr> : data.employees.map(employee =>
              <tr key={employee.id} className="border-b hover:bg-muted/40">
                <td className="p-3"><div className="flex items-center gap-3"><EmployeeAvatar employee={employee}/><div><button className="text-start font-medium text-primary hover:underline" onClick={() => setSelected(employee.id)}>{employee.firstName} {employee.lastName}</button><div className="text-xs text-muted-foreground">{employee.employeeId}</div></div></div></td>
                <td className="p-3">{employee.position}</td><td className="p-3">{employee.department}</td><td className="p-3 capitalize">{t(employee.type)}</td>
                <td className="p-3"><StatusPill value={employee.status} label={t(employee.status.replaceAll('_',' '))}/></td>
                <td className="p-3 whitespace-nowrap">{formatDate(employee.joiningDate,language==='ar'?'ar-QA':'en-US')}</td>
                <td className="p-3"><Button variant="ghost" size="sm" aria-label={`${t('View')} ${employee.firstName} ${employee.lastName}`} onClick={() => setSelected(employee.id)}>{t("View")}</Button></td>
              </tr>)}</tbody>
        </table></div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">{data ? `${t('Employees')}: ${data.total} · ${t('Page')} ${page} ${t('of')} ${pages}` : ''}</p>
        <div className="flex gap-2"><Button variant="outline" disabled={isLoading || page <= 1} onClick={() => setPage(page - 1)}>{t("Previous")}</Button><Button variant="outline" disabled={isLoading || !data || page >= pages} onClick={() => setPage(page + 1)}>{t("Next")}</Button></div>
      </div>
    </CardContent>
  </Card><AddEditEmployeeModal open={showAdd} onOpenChange={setShowAdd} onSuccess={(id) => { setPage(1); refetch(); if(id)setSelected(id); }} /></div>;
}
