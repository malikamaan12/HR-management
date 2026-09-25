import EmployeePhoto from './EmployeePhoto';
import {useAuth} from '@/contexts/AuthContext';
import {useLocale} from '@/contexts/LocaleContext';
import EmployeeCompensation from '@/components/employees/EmployeeCompensation';
import {compensationDetailedReaders} from '@shared/compensation';
import {Corrections} from './Corrections';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiEmployeeRecord, ApiEmployeeHistory, ApiDocument } from '@/lib/api-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate as formatStoredDate } from '@/lib/utils';
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
  const {t}=useLocale();
  return <Card><CardHeader><CardTitle className="text-lg">{t(title)}</CardTitle></CardHeader><CardContent><dl className="grid gap-5 sm:grid-cols-2">
    {fields.map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{t(label)}</dt><dd className="mt-1 break-words">{value == null || value === '' ? t('Not recorded') : typeof value === 'boolean' ? value ? t('Yes') : t('No') : String(value)}</dd></div>)}
  </dl></CardContent></Card>;
}
export default function EmployeeProfile({ employeeId, onClose }: { employeeId: number; onClose: () => void }) {
  const {t,language}=useLocale();
  const formatDate=(value:Date|string)=>formatStoredDate(value,language==='ar'?'ar-QA':'en-US');
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
    toast({ title: t('Lifecycle event recorded') });
  }, onError: (error: Error) => toast({ title: t('Unable to record lifecycle event'), description: error.message, variant: 'destructive' }) });
  if (isLoading) return <p className="p-8">{t("Loading employee…")}</p>;
  if (error || !employee) return <div role="alert" className="space-y-4"><p>{t("Employee unavailable, or you no longer have access.")}</p><Button onClick={onClose} variant="outline">{t("Back to employees")}</Button> <Button onClick={() => refetch()}>{t("Retry")}</Button></div>;
  const e = employee;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="w-full"><Button variant="ghost" onClick={onClose}>{t("← Back to employees")}</Button><div className="employee-profile-identity"><div className="employee-profile-portrait"><EmployeePhoto employee={e}/></div><div className="min-w-0"><span className="profile-id-chip">{e.employeeId}</span><h1 className="mt-3 text-2xl font-semibold">{e.firstName} {e.lastName}</h1><p className="mt-2 text-muted-foreground">{e.position} · {e.department}</p></div></div></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => refetch()}>{t("Reload profile")}</Button>{e.access.canEdit && <Button onClick={() => setEdit(true)}>{t("Edit Employee")}</Button>}</div>
    </div>
    <Tabs dir={language==='ar'?'rtl':'ltr'} value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="employment">{t("Employment")}</TabsTrigger>
        {e.access.personal && <TabsTrigger value="personal">{t("Personal & emergency")}</TabsTrigger>}
        {e.access.banking && <TabsTrigger value="banking">{t("Banking")}</TabsTrigger>}
        {(e.userId===user?.userId||compensationDetailedReaders(user?.role||'')) && <TabsTrigger value="compensation">{t('Salary & benefits')}</TabsTrigger>}
        {e.access.documents && <TabsTrigger value="documents">{t("Documents")}</TabsTrigger>}
        {e.access.history && <TabsTrigger value="lifecycle">{t("Lifecycle")}</TabsTrigger>}
        {e.access.history && <TabsTrigger value="activity">{t("Activity")}</TabsTrigger>}
      </TabsList>
      <TabsContent value="employment" className="space-y-4">
        <Info title="Employment details" fields={[
          ['Employee ID', e.employeeId], ['Type', e.type ? t(e.type.replaceAll('_', ' ')) : null], ['Status', e.status ? t(e.status.replaceAll('_', ' ')) : null], ['Event staff eligible', e.eventStaffEligible],
          ['Work schedule', e.workSchedule==='management_office' ? t('Management office') : e.workSchedule==='shift_based' ? t('Assigned shifts') : t('Not assigned')],
          ['Department', e.department], ['Position', e.position], ['Location', e.location], ['Work location', e.workLocation],
          ['Joining date', formatDate(e.joiningDate)], ['Work email', e.workEmail], ['Work phone', e.workPhone],
          ['Primary manager', e.managers?.primary ? `${e.managers.primary.firstName} ${e.managers.primary.lastName} (${e.managers.primary.employeeId})` : e.reportingManagerId ? t('Manager details outside your directory access') : null],
          ['Secondary manager', e.managers?.secondary ? `${e.managers.secondary.firstName} ${e.managers.secondary.lastName} (${e.managers.secondary.employeeId})` : e.secondaryManagerId ? t('Manager details outside your directory access') : null],
          ...(e.access.personal ? [['Contract end', e.contractEndDate ? formatDate(e.contractEndDate) : null], ['Category', e.employeeCategory], ['Cost center', e.costCenter], ['Job grade', e.jobGrade], ['Probation (months)', e.probationPeriod], ['Notice (days)', e.noticePeriod]] as [string, unknown][] : []),
        ]} />
        {e.workSchedule==='management_office' && policy && <p className="rounded-md bg-muted p-3 text-sm">{t("Office schedule:")}{" "}{officeScheduleSummary(policy.managementOfficeSchedule)}</p>}
        <p className="text-sm text-muted-foreground">{t("FEC, mall activation and event team assignments are managed in Workforce Operations.")}</p>
      </TabsContent>
      {e.access.personal && <TabsContent value="personal" className="space-y-4">
        {(e.access.canEdit||e.userId===user?.userId)&&<Corrections employeeId={e.id} version={e.recordVersion!}/>}
        <Info title="Personal details" fields={[
          ['Arabic name', e.fullNameArabic], ['Date of birth', e.dateOfBirth ? formatDate(e.dateOfBirth) : null], ['Gender', e.gender ? t(e.gender.replaceAll('_', ' ')) : null], ['Nationality', e.nationality],
          ['QID / identification', e.qidNumber], ['Marital status', e.maritalStatus ? t(e.maritalStatus.replaceAll('_', ' ')) : null], ['Religion', e.religion], ['Blood group', e.bloodGroup],
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
      {e.access.documents && <TabsContent value="documents"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>{t("Employee documents")}</CardTitle>{e.access.uploadDocuments && <Button onClick={() => setUpload(true)}>{t("Add Document")}</Button>}</CardHeader><CardContent>
        {docs.isLoading ? <p>{t("Loading documents…")}</p> : docs.error ? <div role="alert"><p>{t("Unable to load documents.")}</p><Button variant="outline" onClick={() => docs.refetch()}>{t("Retry")}</Button></div> : !docs.data?.length ? <p>{t("No documents recorded for this employee.")}</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-start"><th className="p-3">{t("Document")}</th><th className="p-3">{t("Number")}</th><th className="p-3">{t("Expires")}</th><th className="p-3">{t("File")}</th></tr></thead><tbody>{docs.data.map(document => <tr className="border-t" key={document.id}>
            <td className="p-3">{document.documentType}</td><td className="p-3">{document.documentNumber}</td><td className="p-3">{formatDate(document.expiryDate)}</td><td className="p-3">{document.documentFile ? <a className="text-primary underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">{t("Open document")}<span className="sr-only"> {document.documentType}</span></a> : t('No file attached')}</td>
          </tr>)}</tbody></table></div>}
      </CardContent></Card></TabsContent>}
      {e.access.history && <TabsContent value="lifecycle" className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("Events preserve an employment history. Update department, position and contract details using Edit Employee. Termination deactivates the employee and linked account immediately. Reactivation restores employment; an administrator must restore account access in User Management.")}</p>
        {e.access.canEdit && <Card><CardHeader><CardTitle>{t("Record lifecycle event")}</CardTitle></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event: FormEvent) => { event.preventDefault(); lifecycleMutation.mutate(lifecycleForm); }}>
          <label className="grid gap-1.5 text-sm font-medium">{t("Event type")}<select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={lifecycleForm.eventType} onChange={event => setLifecycleForm({ ...lifecycleForm, eventType: event.target.value })}>{lifecycleTypes.map(type => <option key={type} value={type}>{t(type.replaceAll('_', ' '))}</option>)}</select></label>
          <label className="grid gap-1.5 text-sm font-medium">{t("Effective date")}<Input type="date" value={lifecycleForm.effectiveDate} onChange={event => setLifecycleForm({ ...lifecycleForm, effectiveDate: event.target.value })} required /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">{t("Reason")}<Input value={lifecycleForm.reason} onChange={event => setLifecycleForm({ ...lifecycleForm, reason: event.target.value })} minLength={5} maxLength={500} required /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">{t("Notes")}<Textarea value={lifecycleForm.notes} onChange={event => setLifecycleForm({ ...lifecycleForm, notes: event.target.value })} maxLength={2000} /></label>
          <div className="sm:col-span-2"><Button disabled={lifecycleMutation.isPending}>{lifecycleMutation.isPending ? t('Saving…') : t('Record event')}</Button></div>
        </form></CardContent></Card>}
        <Card><CardHeader><CardTitle>{t("Lifecycle history")}</CardTitle></CardHeader><CardContent>{lifecycle.isLoading ? <p>{t("Loading lifecycle history…")}</p> : lifecycle.error ? <div role="alert"><p>{t("Unable to load lifecycle history.")}</p><Button variant="outline" onClick={() => lifecycle.refetch()}>{t("Retry")}</Button></div> : !lifecycle.data?.history.length ? <p className="text-muted-foreground">{t("No lifecycle events recorded yet.")}</p> : <ol className="space-y-4">{lifecycle.data.history.map(item => <li className="border-b pb-4 last:border-0" key={item.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{t(item.eventType.replaceAll('_', ' '))}</p><time className="text-sm text-muted-foreground">{t("Effective")}{" "}{formatDate(item.effectiveDate)}</time></div><p className="mt-1 text-sm">{item.reason}</p>{item.notes && <p className="mt-1 text-sm text-muted-foreground">{item.notes}</p>}<p className="mt-1 text-xs text-muted-foreground">{t("Recorded by")}{" "}{item.actor || t('System')} · {new Date(item.createdAt).toLocaleString(language==='ar'?'ar-QA':'en-QA')}</p></li>)}</ol>}</CardContent></Card>
      </TabsContent>}
      {e.access.history && <TabsContent value="activity"><Card><CardHeader><CardTitle>{t("Record history")}</CardTitle></CardHeader><CardContent>
        {activity.isLoading ? <p>{t("Loading history…")}</p> : activity.error ? <div role="alert"><p>{t("Unable to load history.")}</p><Button variant="outline" onClick={() => activity.refetch()}>{t("Retry")}</Button></div> : !activity.data?.history.length ? <p>{t("No recorded changes yet.")}</p> :
          <ol className="space-y-4">{activity.data.history.map(item => <li className="border-b pb-4" key={item.id}><p className="font-medium">{item.details || item.action}</p><p className="mt-1 text-sm text-muted-foreground">{item.actor || t('System')} · {new Date(item.createdAt).toLocaleString(language==='ar'?'ar-QA':'en-QA')}</p></li>)}</ol>}
        <div className="mt-5 flex items-center gap-3"><Button variant="outline" disabled={historyPage === 1 || activity.isLoading} onClick={() => setHistoryPage(historyPage - 1)}>{t("Previous")}</Button><span className="text-sm">{t("Page")}{" "}{historyPage}</span><Button variant="outline" disabled={activity.isLoading || !activity.data || historyPage * 20 >= activity.data.total} onClick={() => setHistoryPage(historyPage + 1)}>{t("Next")}</Button></div>
      </CardContent></Card></TabsContent>}
    </Tabs>
    {e.access.canEdit && <AddEditEmployeeModal open={edit} onOpenChange={setEdit} employee={e} onSuccess={() => { refetch(); activity.refetch(); }} />}
    {e.access.uploadDocuments && <UploadDocumentModal isOpen={upload} onClose={() => setUpload(false)} employee={{ id: e.id, firstName: e.firstName, lastName: e.lastName }} />}
  </div>;
}
