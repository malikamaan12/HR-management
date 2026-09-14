import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ApiEmployeeRecord, ApiEmployeeHistory, ApiDocument } from '@/lib/api-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDate } from '@/lib/utils';
import AddEditEmployeeModal from './AddEditEmployeeModal';
import { UploadDocumentModal } from '@/components/documents/UploadDocumentModal';

function Info({ title, fields }: { title: string; fields: [string, unknown][] }) {
  return <Card><CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent><dl className="grid gap-5 sm:grid-cols-2">
    {fields.map(([label, value]) => <div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value == null || value === '' ? 'Not recorded' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value).replaceAll('_', ' ')}</dd></div>)}
  </dl></CardContent></Card>;
}
export default function EmployeeProfile({ employeeId, onClose }: { employeeId: number; onClose: () => void }) {
  const [edit, setEdit] = useState(false);
  const [upload, setUpload] = useState(false);
  const [tab, setTab] = useState('employment');
  const [historyPage, setHistoryPage] = useState(1);
  const { data: employee, isLoading, error, refetch } = useQuery<ApiEmployeeRecord>({ queryKey: [`/api/employees/${employeeId}`] });
  const docs = useQuery<ApiDocument[]>({ queryKey: [`/api/employees/${employeeId}/documents`], enabled: !!employee?.access.documents && tab === 'documents' });
  const activity = useQuery<{ history: ApiEmployeeHistory[]; total: number }>({ queryKey: [`/api/employees/${employeeId}/activity`, { page: historyPage, limit: 20 }], enabled: !!employee?.access.history && tab === 'activity' });
  if (isLoading) return <p className="p-8">Loading employee…</p>;
  if (error || !employee) return <div role="alert" className="space-y-4"><p>Employee unavailable, or you no longer have access.</p><Button onClick={onClose} variant="outline">Back to employees</Button> <Button onClick={() => refetch()}>Retry</Button></div>;
  const e = employee;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><Button variant="ghost" onClick={onClose}>← Back to employees</Button><h1 className="mt-3 text-2xl font-semibold">{e.firstName} {e.lastName}</h1><p className="text-muted-foreground">{e.employeeId} · {e.position} · {e.department}</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => refetch()}>Reload profile</Button>{e.access.canEdit && <Button onClick={() => setEdit(true)}>Edit Employee</Button>}</div>
    </div>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="employment">Employment</TabsTrigger>
        {e.access.personal && <TabsTrigger value="personal">Personal & emergency</TabsTrigger>}
        {e.access.banking && <TabsTrigger value="banking">Banking</TabsTrigger>}
        {e.access.documents && <TabsTrigger value="documents">Documents</TabsTrigger>}
        {e.access.history && <TabsTrigger value="activity">Activity</TabsTrigger>}
      </TabsList>
      <TabsContent value="employment" className="space-y-4">
        <Info title="Employment details" fields={[
          ['Employee ID', e.employeeId], ['Type', e.type], ['Status', e.status], ['Event staff eligible', e.eventStaffEligible],
          ['Department', e.department], ['Position', e.position], ['Location', e.location], ['Work location', e.workLocation],
          ['Joining date', formatDate(e.joiningDate)], ['Work email', e.workEmail], ['Work phone', e.workPhone],
          ['Primary manager', e.reportingManagerId ? `Employee record #${e.reportingManagerId}` : null], ['Secondary manager', e.secondaryManagerId ? `Employee record #${e.secondaryManagerId}` : null],
          ...(e.access.personal ? [['Contract end', e.contractEndDate ? formatDate(e.contractEndDate) : null], ['Category', e.employeeCategory], ['Cost center', e.costCenter], ['Job grade', e.jobGrade], ['Probation (months)', e.probationPeriod], ['Notice (days)', e.noticePeriod]] as [string, unknown][] : []),
        ]} />
        <p className="text-sm text-muted-foreground">FEC, mall activation and event team assignments are managed in Workforce Operations.</p>
      </TabsContent>
      {e.access.personal && <TabsContent value="personal" className="space-y-4">
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
      {e.access.documents && <TabsContent value="documents"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Employee documents</CardTitle>{e.access.uploadDocuments && <Button onClick={() => setUpload(true)}>Add Document</Button>}</CardHeader><CardContent>
        {docs.isLoading ? <p>Loading documents…</p> : docs.error ? <div role="alert"><p>Unable to load documents.</p><Button variant="outline" onClick={() => docs.refetch()}>Retry</Button></div> : !docs.data?.length ? <p>No documents recorded for this employee.</p> :
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="p-3">Document</th><th className="p-3">Number</th><th className="p-3">Expires</th><th className="p-3">File</th></tr></thead><tbody>{docs.data.map(document => <tr className="border-t" key={document.id}>
            <td className="p-3">{document.documentType}</td><td className="p-3">{document.documentNumber}</td><td className="p-3">{formatDate(document.expiryDate)}</td><td className="p-3">{document.documentFile ? <a className="text-primary underline" href={`/api/documents/${document.id}/download`} target="_blank" rel="noopener noreferrer">Open document<span className="sr-only"> {document.documentType}</span></a> : 'No file attached'}</td>
          </tr>)}</tbody></table></div>}
      </CardContent></Card></TabsContent>}
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
