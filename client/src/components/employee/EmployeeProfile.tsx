import EmployeePhoto from './EmployeePhoto';
import {useAuth} from '@/contexts/AuthContext';
import EmployeeCompensation from '@/components/employees/EmployeeCompensation';
import {compensationDetailedReaders} from '@shared/compensation';
import {Corrections} from './Corrections';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiEmployeeRecord, ApiEmployeeHistory, ApiDocument } from '@/lib/api-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/utils';
import AddEditEmployeeModal from './AddEditEmployeeModal';
import { UploadDocumentModal } from '@/components/documents/UploadDocumentModal';
import { officeScheduleSummary, type CompanySettings } from '@shared/settings';
import { apiJson } from '@/lib/queryClient';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

type LifecycleEvent = { id: number; eventType: string; effectiveDate: string; reason: string; notes: string | null; metadata: Record<string, unknown> | null; createdAt: string; actor: string | null };
const lifecycleTypes = ['hire', 'transfer', 'promotion', 'probation_started', 'probation_completed', 'contract_renewal', 'termination', 'reactivation', 'correction'] as const;

function Info({ title, fields }: { title: string; fields: [string, unknown][] }) {
  return <Card><CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent><dl className="grid gap-5 sm:grid-cols-2">
    {fields.map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value).replaceAll('_', ' ')}</dd></div>)}
  </dl></CardContent></Card>;
}
export default function EmployeeProfile({ employeeId, onClose }: { employeeId: number; onClose: () => void }) {
  const {user}=useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [upload, setUpload] = useState(false);
  const [tab, setTab] = useState('employment');
  const [historyPage, setHistoryPage] = useState(1);
  const [lifecycleForm, setLifecycleForm] = useState({ eventType: 'correction', effectiveDate: new Date().toISOString().slice(0, 10), reason: '', notes: '' });
  const { data: employee, isLoading, error, refetch } = useQuery<ApiEmployeeRecord>({ queryKey: [`/api/employees/${employeeId}`] });
  const {data:policy}=useQuery<CompanySettings>({queryKey:['/api/settings/company'],enabled:employee?.workSchedule==='management_office'});
  const docs = useQuery<ApiDocument[]>({ queryKey: [`/api/employees/${employeeId}/documents`], enabled: !!employee?.access.documents && tab === 'documents' });
  const activity = useQuery<{ history: ApiEmployeeHistory[]; total: number }>({ queryKey: [`/api/employees/${employeeId}/activity`, { page: historyPage, limit: 20 }], enabled: !!employee?.access.history && tab === 'activity' });
  const lifecycle = useQuery<{ history: LifecycleEvent[] }>({ queryKey: [`/api/employees/${employeeId}/lifecycle`], enabled: !!employee?.access.history && tab === 'lifecycle' });
  const lifecycleMutation = useMutation({ mutationFn: (body: typeof lifecycleForm) => apiJson(`/api/employees/${employeeId}/lifecycle`, { method: 'POST', body: { ...body, expectedVersion: employee?.recordVersion } }), onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}/lifecycle`] });
    queryClient.invalidateQueries({ queryKey: [`/api/employees/${employeeId}`] });
    queryClient.invalidateQueries({ queryKey: ['/api/employees/directory'] });
    setLifecycleForm(current => ({ ...current, reason: '', notes: '' }));
    toast({ title: 'Lifecycle event recorded' });
  }, onError: (error: Error) => toast({ title: 'Unable to record lifecycle event', description: error.message, variant: 'destructive' }) });
  if (isLoading) return <p className="p-8">Loading employee…</p>;
  if (error || !employee) return <div role="alert" className="space-y-4"><p>Employee unavailable, or you no longer have access.</p><Button onClick={onClose} variant="outline">Back to employees</Button> <Button onClick={() => refetch()}>Retry</Button></div>;
  const e = employee;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="w-full"><Button variant="ghost" onClick={onClose}>← Back to employees</Button><div className="employee-profile-identity"><div className="employee-profile-portrait"><EmployeePhoto employee={e}/></div><div className="min-w-0"><span className="profile-id-chip">{e.employeeId}</span><h1 className="mt-3 text-2xl font-semibold">{e.firstName} {e.lastName}</h1><p className="mt-2 text-muted-foreground">{e.position} · {e.department}</p></div></div></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => refetch()}>Reload profile</Button>{e.access.canEdit && <Button onClick={() => setEdit(true)}>Edit Employee</Button>}</div>
    </div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="employment">Employment</TabsTrigger>
        {e.access.personal && <TabsTrigger value="personal">Personal & emergency</TabsTrigger>}
        {e.access.banking && <TabsTrigger value="banking">Banking</TabsTrigger>}
        {(e.userId===user?.userId||compensationDetailedReaders(user?.role||'')) && <TabsTrigger value="compensation">Salary & benefits</TabsTrigger>}
        {e.access.documents && <TabsTrigger value="documents">Documents</TabsTrigger>}
        {e.access.history && <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>}
        {e.access.history && <TabsTrigger value="activity">Activity</TabsTrigger>}
      </TabsList>
      <TabsContent value="employment" className="space-y-4">
        <Info title="Employment details" fields={[
          ['Employee ID', e.employeeId], ['Type', e.type], ['Status', e.status], ['Event staff eligible', e.eventStaffEligible],
          ['Work schedule', e.workSchedule==='management_office' ? 'Management office' : e.workSchedule==='shift_based' ? 'Assigned shifts' : 'Not assigned'],
          ['Department', e.department], ['Position', e.position], ['Location', e.location], ['Work location', e.workLocation],
          ['Joining date', formatDate(e.joiningDate)], ['Work email', e.workEmail], ['Work phone', e.workPhone],
          ['Primary manager', e.managers?.primary ? `${e.managers.primary.firstName} ${e.managers.primary.lastName} (${e.managers.primary.employeeId})` : e.reportingManagerId ? 'Manager details outside your directory access' : null],
          ['Secondary manager', e.managers?.secondary ? `${e.managers.secondary.firstName} ${e.managers.secondary.lastName} (${e.managers.secondary.employeeId})` : e.secondaryManagerId ? 'Manager details outside your directory access' : null],
          ...(e.access.personal ? [['Contract end', e.contractEndDate ? formatDate(e.contractEndDate) : null], ['Category', e.employeeCategory], ['Cost center', e.costCenter], ['Job grade', e.jobGrade], ['Probation (months)', e.probationPeriod], ['Notice (days)', e.noticePeriod]] as [string, unknown][] : []),
        ]} />
        {e.workSchedule==='management_office' && policy && <p className="rounded-md bg-muted p-3 text-sm">Office schedule: {officeScheduleSummary(policy.managementOfficeSchedule)}</p>}
        <p className="text-sm text-muted-foreground">FEC, mall activation and event team assignments are managed in Workforce Operations.</p>
      </TabsContent>
      {e.access.personal && <TabsContent value="personal" className="space-y-4">
        {(e.access.canEdit||e.userId===user?.userId)&&<Corrections employeeId={e.id} version={e.recordVersion!}/>}
        <Info title="Personal details" fields={[
          ['Arabic name', e.fullNameArabic], ['Date of birth', e.dateOfBirth ? formatDate(e.dateOfBirth) : null], ['Gender', e.gender], ['Nationality', e.nationality],
          ['QID / identification', e.qidNumber], ['Marital status', e.maritalStatus], ['Religion', e.religion], ['Blood group', e.bloodGroup],
          ['Mobile', e.primaryMobile], ['Secondary contact', e.secondaryContact], ['Personal email', e.personalEmail], ['Residential address', e.residentialAddress], ['Home country address', e.homeCountryAddress],
        ]} />
        <Info title="Emergency contact" fields={[
          ['Name', e.emergencyContactName], ['Number', e.emergencyContactNumber], ['Relationship', e.emergencyContactRelation],
        ]} />
      </TabsContent>}
      {e.access.banking && <TabsContent value="banking"><Info title="Bank details" fields={[
        ['Bank', e.bankName], ['Account name', e.accountName], ['IBAN', e.ibanNumber], ['SWIFT code', e.swiftCode], ['Branch', e.bankBranch],
      ]} /></TabsContent>}
      {(e.userId===user?.userId||compensationDetailedReaders(user?.role||'')) && <TabsContent value="compensation"><EmployeeCompensation employeeId={e.id}/></TabsContent>}
      {e.access.documents && <TabsContent value="documents"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Employee documents</CardTitle>{e.access.uploadDocuments && <Button onClick={() => setUpload(true)}>Add Document</Button>}</CardHeader><CardContent>
        {docs.isLoading ? <p>Loading documents…</p> : docs.error ? <div role="alert"><p>Unable to load documents.</p><Button variant="outline" onClick={() => docs.refetch()}>Retry</Button></div> : !docs.data?.length ? <p>No documents recorded for this employee.</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-3">Document</th><th className="p-3">Number</th><th className="p-3">Expires</th><th className="p-3">File</th></tr></thead><tbody>{docs.data.map(document => <tr className="border-t" key={document.id}>
            <td className="p-3">{document.documentType}</td><td className="p-3">{document.documentNumber}</td><td className="p-3">{formatDate(document.expiryDate)}</td><td className="p-3">{document.documentFile ? <a className="text-primary underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">Open document<span className="sr-only"> {document.documentType}</span></a> : 'No file attached'}</td>
          </tr>)}</tbody></table></div>}
      </CardContent></Card></TabsContent>}
      {e.access.history && <TabsContent value="lifecycle" className="space-y-4">
        <p className="text-sm text-muted-foreground">Events preserve an employment history. Update department, position and contract details using Edit Employee. Termination deactivates the employee and linked account immediately. Reactivation restores employment; an administrator must restore account access in User Management.</p>
        {e.access.canEdit && <Card><CardHeader><CardTitle>Record lifecycle event</CardTitle></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event: FormEvent) => { event.preventDefault(); lifecycleMutation.mutate(lifecycleForm); }}>
          <label className="grid gap-1.5 text-sm font-medium">Event type<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={lifecycleForm.eventType} onChange={event => setLifecycleForm({ ...lifecycleForm, eventType: event.target.value })}>{lifecycleTypes.map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium">Effective date<Input type="date" value={lifecycleForm.effectiveDate} onChange={event => setLifecycleForm({ ...lifecycleForm, effectiveDate: event.target.value })} required /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Reason<Input value={lifecycleForm.reason} onChange={event => setLifecycleForm({ ...lifecycleForm, reason: event.target.value })} minLength={5} maxLength={500} required /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Notes<Textarea value={lifecycleForm.notes} onChange={event => setLifecycleForm({ ...lifecycleForm, notes: event.target.value })} maxLength={2000} /></label>
          <div className="sm:col-span-2"><Button disabled={lifecycleMutation.isPending}>{lifecycleMutation.isPending ? 'Saving…' : 'Record event'}</Button></div>
        </form></CardContent></Card>}
        <Card><CardHeader><CardTitle>Lifecycle history</CardTitle></CardHeader><CardContent>{lifecycle.isLoading ? <p>Loading lifecycle history…</p> : lifecycle.error ? <div role="alert"><p>Unable to load lifecycle history.</p><Button variant="outline" onClick={() => lifecycle.refetch()}>Retry</Button></div> : !lifecycle.data?.history.length ? <p className="text-muted-foreground">No lifecycle events recorded yet.</p> : <ol className="space-y-4">{lifecycle.data.history.map(item => <li className="border-b pb-4 last:border-0" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{item.eventType.replaceAll('_', ' ')}</p><time className="text-sm text-muted-foreground">Effective {formatDate(item.effectiveDate)}</time></div><p className="mt-1 text-sm">{item.reason}</p>{item.notes && <p className="mt-1 text-sm text-muted-foreground">{item.notes}</p>}<p className="mt-1 text-xs text-muted-foreground">Recorded by {item.actor || 'System'} · {new Date(item.createdAt).toLocaleString()}</p></li>)}</ol>}</CardContent></Card>
      </TabsContent>}
      {e.access.history && <TabsContent value="activity"><Card><CardHeader><CardTitle>Record history</CardTitle></CardHeader><CardContent>
        {activity.isLoading ? <p>Loading history…</p> : activity.error ? <div role="alert"><p>Unable to load history.</p><Button variant="outline" onClick={() => activity.refetch()}>Retry</Button></div> : !activity.data?.history.length ? <p>No recorded changes yet.</p> :
          <ol className="space-y-4">{activity.data.history.map(item => <li className="border-b pb-4" key={item.id}><p className="font-medium">{item.details || item.action}</p><p className="mt-1 text-sm text-muted-foreground">{item.actor || 'System'} · {new Date(item.createdAt).toLocaleString()}</p></li>)}</ol>}
        <div className="mt-5 flex items-center gap-3"><Button variant="outline" disabled={historyPage === 1 || activity.isLoading} onClick={() => setHistoryPage(historyPage - 1)}>Previous</Button><span className="text-sm">Page {historyPage}</span><Button variant="outline" disabled={activity.isLoading || !activity.data || historyPage * 20 >= activity.data.total} onClick={() => setHistoryPage(historyPage + 1)}>Next</Button></div>
      </CardContent></Card></TabsContent>}
    </Tabs>
    {e.access.canEdit && <AddEditEmployeeModal open={edit} onOpenChange={setEdit} employee={e} onSuccess={() => { refetch(); activity.refetch(); }} />}
    {e.access.uploadDocuments && <UploadDocumentModal isOpen={upload} onClose={() => setUpload(false)} employee={{ id: e.id, firstName: e.firstName, lastName: e.lastName }} />}
  </div>;
}
