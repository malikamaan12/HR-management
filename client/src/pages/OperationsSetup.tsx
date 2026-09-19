import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Helmet } from 'react-helmet';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Field, Section, QueryError, fieldClass, useAction } from '@/components/hr/Operations';
import { AttendanceLocationManagement } from '@/components/hr/AttendanceLocations';
import HrRules from '@/pages/HrRules';
import SystemReadiness from '@/components/hr/SystemReadiness';
import type { OperationsSetupResponse } from '@shared/operations-setup';
import { operationsTrainingUpdate, type OperationsTrainingSettings as TrainingSettings, type OperationsTrainingCourse as TrainingCourse } from '@shared/operations-training';

type ReadinessSection = OperationsSetupResponse['sections'][number];
const statusLabels: Record<ReadinessSection['status'], string> = {
  ready: 'Configured', action_required: 'Action required', not_started: 'Not started',
};
const employeeTypeLabels = { permanent: 'Permanent employees', temporary: 'Temporary / event employees', contract: 'Contract employees' };
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const safeIssueHref = (href: string) => href.startsWith('/') && !href.startsWith('//') ? href : '/operations-setup';
const initialTab = () => {
  const requested = new URLSearchParams(window.location.search).get('tab');
  return requested && ['overview', 'locations', 'supervisors', 'leave', 'induction', 'services'].includes(requested) ? requested : 'overview';
};

function ReadinessIssues({ section }: { section?: ReadinessSection }) {
  if (!section) return null;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><Badge variant={section.status === 'ready' ? 'secondary' : 'outline'}>{statusLabels[section.status]}</Badge><span className="text-sm">{section.issueCount} open {section.issueCount === 1 ? 'item' : 'items'}</span></div>
    <p className="text-sm text-muted-foreground">{section.summary}</p>
    {!!section.issues.length && <ul className="list-disc space-y-2 pl-5 text-sm">{section.issues.map(issue => <li key={issue.key}><a className="text-primary underline underline-offset-2" href={safeIssueHref(issue.href)}>{issue.message}</a></li>)}</ul>}
    {section.issueCount > section.issues.length && <p className="text-xs text-muted-foreground">Showing {section.issues.length} of {section.issueCount} items. Open the linked module to review the complete records.</p>}
  </div>;
}

function TrainingRequirementsForm({ course, onClose }: { course: TrainingCourse; onClose: () => void }) {
  const [settings, setSettings] = useState<TrainingSettings>(() => ({ ...course.settings, employeeTypes: [...course.settings.employeeTypes], departments: [...course.settings.departments] }));
  const [departments, setDepartments] = useState(course.settings.departments.join('\n'));
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  const save = useAction(onClose);
  const blocked = course.hasDraft || !course.canPublish || course.draftVersion === null;
  return <form className="space-y-4 rounded-lg border bg-muted/20 p-4" onSubmit={event => {
    event.preventDefault();
    const names = [...new Set(departments.split('\n').map(name => name.trim()).filter(Boolean))];
    if (!settings.employeeTypes.length) { setError('Choose at least one employee type.'); return; }
    if (names.length > 100 || names.some(name => name.length > 150)) { setError('Use up to 100 department names, with at most 150 characters each.'); return; }
    if (!Number.isInteger(settings.defaultDueDays) || settings.defaultDueDays < 0 || settings.defaultDueDays > 365) { setError('The due date must be a whole number from 0 to 365 days.'); return; }
    setError('');
    const parsed = operationsTrainingUpdate.safeParse({
      courseVersion: course.courseVersion, draftVersion: course.draftVersion, publishedReleaseId: course.publishedReleaseId,
      settings: { ...settings, departments: names }, reason: reason.trim(),
    });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join('; ')); return; }
    save.mutate({ url: `/api/operations-training/courses/${course.id}/requirements`, body: parsed.data });
  }}>
    <div><h3 className="font-semibold">Onboarding requirements · {course.title}</h3><p className="mt-1 text-xs text-muted-foreground">Based on published release {course.releaseNumber}. Publishing creates a new release with these requirements.</p></div>
    {blocked && <p role="alert" className="text-sm">{course.blockedReason || 'This course has pending authoring changes. Finish or resolve them in Learning & Training before changing its onboarding requirements.'}</p>}
    <fieldset className="space-y-4" disabled={blocked || save.isPending}>
      <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={settings.mandatoryForOnboarding} onChange={event => setSettings({ ...settings, mandatoryForOnboarding: event.target.checked })}/><span>Require this course for eligible employees during onboarding</span></label>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Eligible employee types</legend>{(['permanent', 'temporary', 'contract'] as const).map(type => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.employeeTypes.includes(type)} onChange={event => setSettings({ ...settings, employeeTypes: event.target.checked ? [...settings.employeeTypes, type] : settings.employeeTypes.filter(value => value !== type) })}/>{employeeTypeLabels[type]}</label>)}</fieldset>
      <Field label="Departments — one exact name per line; blank means all departments"><textarea className={fieldClass} rows={4} maxLength={15099} value={departments} onChange={event => setDepartments(event.target.value)} placeholder={'For example:\nOperations\nAdministration'}/></Field>
      <Field label="Deadline starts from"><select className={fieldClass} value={settings.dueDateBasis} onChange={event=>setSettings({...settings,dueDateBasis:event.target.value as 'enrollment'|'joining_date'})}><option value="enrollment">Enrollment or future joining date</option><option value="joining_date">Employee joining date</option></select></Field><p className="text-sm">Joining-date deadlines remain overdue when assigned late. Existing enrollments keep their saved due dates.</p><Field label="Default due period (days)"><input className={fieldClass} type="number" min={0} max={365} step={1} required value={settings.defaultDueDays} onChange={event => setSettings({ ...settings, defaultDueDays: Number(event.target.value) })}/></Field>
      <p className="text-xs text-muted-foreground">The default deadline starts from the later of enrollment and joining date; zero means due that day. Employee types and department names also control who is eligible for this course.</p>
      <Field label="Reason for publishing these requirements"><textarea className={fieldClass} required minLength={5} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)}/></Field>
      <p className="text-sm text-muted-foreground">New onboarding cases pick up applicable published requirements. Existing cases need an explicit refresh in Onboarding. Publishing here does not bulk-enroll employees or change their saved completion records.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <QueryError error={save.error}/>
      <div className="flex flex-wrap gap-2"><Button disabled={reason.trim().length < 5 || !settings.employeeTypes.length || save.isPending}>Publish onboarding requirements</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
    </fieldset>
  </form>;
}

function TrainingRequirements() {
  const [search, setSearch] = useState(''), [q, setQuery] = useState(''), [offset, setOffset] = useState(0), [selected, setSelected] = useState<TrainingCourse | null>(null);
  const courses = useQuery<{ items: TrainingCourse[]; total: number }>({ queryKey: ['/api/operations-training/courses', { q, offset }] });
  return <Section title="Required induction courses">
    <p className="text-sm text-muted-foreground">Choose which published courses are mandatory, who they apply to and when they are due. Course content, quizzes and assessments remain in <a href="/learning" className="text-primary underline">Learning & Training</a>.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setOffset(0); setSelected(null); }}><div className="min-w-0 flex-1"><Field label="Find a published course"><input className={fieldClass} value={search} maxLength={100} onChange={event => setSearch(event.target.value)} placeholder="Course title"/></Field></div><Button variant="outline" disabled={courses.isFetching}>Search</Button><Button type="button" variant="outline" disabled={courses.isFetching} onClick={() => { setSelected(null); void courses.refetch(); }}>Reload courses</Button></form>
    <QueryError error={courses.error}/>
    {courses.isLoading && <p className="text-sm" role="status">Loading published courses…</p>}
    {selected && <TrainingRequirementsForm key={`${selected.id}-${selected.courseVersion}-${selected.draftVersion}-${selected.publishedReleaseId}`} course={selected} onClose={() => setSelected(null)}/>}
    {courses.data && !courses.data.items.length && <p className="rounded-md border p-4 text-sm">{q ? 'No published courses match this search.' : 'No published courses are available. Create and publish courses in Learning & Training first.'}</p>}
    <div className="grid gap-3 lg:grid-cols-2">{courses.data?.items.map(course => <article key={course.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{course.title}</h3><Badge variant="secondary">Release {course.releaseNumber}</Badge></div>
      <p className="text-sm">{course.settings.mandatoryForOnboarding ? 'Mandatory for eligible new onboarding cases' : 'Optional for onboarding'}</p>
      <p className="text-xs text-muted-foreground">{course.settings.employeeTypes.map(type => employeeTypeLabels[type]).join(' · ')}<br/>{course.settings.departments.length ? `Departments: ${course.settings.departments.join(', ')}` : 'All departments'}<br/>Default deadline: {course.settings.defaultDueDays} days after {course.settings.dueDateBasis === 'joining_date' ? 'employee joining date' : 'enrollment or future joining date'}</p>
      {course.hasDraft || !course.canPublish || course.draftVersion === null ? <div className="space-y-2 text-sm"><p>{course.blockedReason || 'Pending authoring changes must be resolved before publishing new requirements.'}</p><a href="/learning" className="text-primary underline">Open course editor in Learning & Training</a></div> : <Button variant="outline" disabled={!!selected} onClick={() => setSelected(course)}>Edit onboarding requirements</Button>}
    </article>)}</div>
    {!!courses.data?.total && <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{offset + 1}–{Math.min(offset + courses.data.items.length, courses.data.total)} of {courses.data.total} published courses</p><div className="flex gap-2"><Button variant="outline" disabled={offset === 0 || courses.isFetching} onClick={() => { setOffset(Math.max(0, offset - 25)); setSelected(null); }}>Previous</Button><Button variant="outline" disabled={offset + 25 >= courses.data.total || courses.isFetching} onClick={() => { setOffset(offset + 25); setSelected(null); }}>Next</Button></div></div>}
  </Section>;
}

export default function OperationsSetup() {
  const { user } = useAuth(), allowed = ['admin', 'super_admin'].includes(user?.role || '');
  const [asOf, setAsOf] = useState(localToday), [tab, setTab] = useState(initialTab);
  const readiness = useQuery<OperationsSetupResponse>({ queryKey: ['/api/operations-setup', { asOf }], enabled: allowed });
  if (!allowed) return <p>Only administrators can configure operational setup.</p>;
  const data = readiness.data, section = (id: ReadinessSection['id']) => data?.sections.find(item => item.id === id);
  return <div className="space-y-6">
    <Helmet><title>Operational setup | E3 HR</title></Helmet>
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Operational setup</h1><p className="text-muted-foreground">Prepare employee access, work locations, supervisors, leave approvals and required induction courses.</p></header>
    <Section title="Configuration readiness">
      <div className="flex flex-wrap items-end gap-3"><Field label="Readiness date (Qatar)"><input className={fieldClass} type="date" required value={asOf} onChange={event => { if (event.target.value) setAsOf(event.target.value); }}/></Field><Button variant="outline" disabled={readiness.isFetching} onClick={() => void readiness.refetch()}>{readiness.isFetching ? 'Refreshing…' : 'Refresh readiness'}</Button></div>
      <p className="text-xs text-muted-foreground">This date checks location, supervisor and rule coverage for currently active employees. Accounts, roles and published course requirements use their current state. The editors below use their current saved versions and explicit effective dates when you save.</p>
      <QueryError error={readiness.error}/>
      {readiness.isLoading && <p role="status">Loading configuration readiness…</p>}
      {data && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Active employees', data.counts.activeEmployees], ['Employees with linked accounts', data.counts.linkedEmployees], ['Accounts ready to sign in', data.counts.readyEmployees], ['Password setup pending', data.counts.setupPendingEmployees], ['Workforce teams', data.counts.teams], ['Workforce sites', data.counts.sites],
      ].map(([label, count]) => <div key={label} className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{count}</p></div>)}</div>
        {data.counts.activeEmployees === 0 && <p className="rounded-md border p-4 text-sm">No active employees are recorded yet. Add real employee records and link approved user accounts before confirming location coverage, supervisor access or individual onboarding requirements.</p>}
        {data.truncated && <p role="status" className="text-sm">Some readiness details are limited in this view. Review the linked modules for the remaining records.</p>}
      </>}
    </Section>
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="locations">Locations & geofencing</TabsTrigger><TabsTrigger value="supervisors">People & supervisors</TabsTrigger><TabsTrigger value="leave">Leave approvals</TabsTrigger><TabsTrigger value="induction">Required training</TabsTrigger><TabsTrigger value="services">Services & recovery</TabsTrigger></TabsList>
      <TabsContent value="overview" className="space-y-4 pt-3">
        {data?.sections.map(item => <Section key={item.id} title={item.title}><ReadinessIssues section={item}/><Button variant="outline" onClick={() => setTab(item.id === 'people' ? 'supervisors' : item.id)}>Open {item.id === 'people' ? 'people setup' : item.title.toLowerCase()}</Button></Section>)}
        {!data && !readiness.isLoading && <p className="text-sm text-muted-foreground">Refresh readiness to load the configuration checklist. The setup tabs remain available.</p>}
      </TabsContent>
      <TabsContent value="locations" className="space-y-4 pt-3"><Section title="Location coverage"><ReadinessIssues section={section('locations')}/><p className="text-sm">Create event, mall and FEC sites in <a href="/workforce" className="text-primary underline">Workforce</a>, then record their actual coordinates, radius and dates here. Enable GPS enforcement after checking coverage for the employees and sites you operate.</p></Section><AttendanceLocationManagement/></TabsContent>
      <TabsContent value="supervisors" className="space-y-4 pt-3"><Section title="Employee records and account access"><ReadinessIssues section={section('people')}/><p className="text-sm">Create the employee record, link the approved account and keep their department and employment type accurate.</p><div className="flex flex-wrap gap-4 text-sm"><a href="/employees" className="text-primary underline">Employee database</a><a href="/user-management" className="text-primary underline">User accounts and roles</a></div></Section><Section title="Supervisor assignments"><ReadinessIssues section={section('supervisors')}/><p className="text-sm">In Workforce, choose the site and team, add dated employee membership and grant the supervisor the required access for those dates. Attendance and timesheet approval need independent review access; scheduling access alone does not approve time.</p><p className="text-sm text-muted-foreground">Temporary, contract and workforce attendance requires supervisor approval. For office employees, maintain the reporting relationship in their employee profile and review the attendance enforcement rules.</p><div className="flex flex-wrap gap-4 text-sm"><a href="/workforce" className="text-primary underline">Manage teams and lead access</a><a href="/employees" className="text-primary underline">Manage reporting relationships</a><a href="/attendance" className="text-primary underline">Attendance approval queue</a></div></Section></TabsContent>
      <TabsContent value="leave" className="space-y-4 pt-3"><Section title="Leave approval readiness"><ReadinessIssues section={section('leave')}/><p className="text-sm">Choose a company leave rule or employee override, specify the first approver and add further approval stages when needed. Revisions take effect on the date you select and retain previous request snapshots.</p></Section><HrRules initialKind="leave"/></TabsContent>
      <TabsContent value="induction" className="space-y-4 pt-3"><Section title="Induction readiness"><ReadinessIssues section={section('induction')}/><p className="text-sm">Configure required courses for permanent, temporary, event and contract staff. When updating existing onboarding cases, use the explicit requirements refresh in <a href="/onboarding" className="text-primary underline">Onboarding</a>.</p></Section><TrainingRequirements/></TabsContent>
      <TabsContent value="services" className="space-y-4 pt-3"><SystemReadiness/></TabsContent>
    </Tabs>
  </div>;
}
