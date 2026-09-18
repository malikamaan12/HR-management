import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {QueryError,Section} from '@/components/hr/Operations';
import {Input,Note,Pager,Toggle,text,today,useSave,type Directory} from '@/components/hr/EmployeeServiceUI';
import type {CourseDefinition} from '@shared/employee-services';
import type {InductionBrand,InductionSettings} from '@shared/induction';
import InductionAuthor,{InductionBrandEditor} from './InductionAuthor';
import InductionPlayer from './InductionPlayer';
import InductionReports from './InductionReports';
import InductionSafetyLibrary from './InductionSafetyLibrary';

const base='/api/learning/induction';
type Context={brand:{version:number;config:InductionBrand};canManage:boolean;canReport:boolean;canConfigure:boolean;storage:boolean;limits:Record<string,number>};
type Course={id:number;version:number;definition:CourseDefinition;publishedRelease:{id:number;releaseNumber:number;lessonCount:number;questionCount:number;settings:InductionSettings}|null;hasDraft:boolean};
type Courses={items:Course[];total:number};
type SelectedEmployee={id:number;name:string;code:string};
const enrollmentFromLocation=()=>{const value=Number(new URLSearchParams(window.location.search).get('enrollment'));return Number.isSafeInteger(value)&&value>0?value:null;};

export default function InductionAcademy(){
  const [tab,setTab]=useState('mine'),[q,setQ]=useState(''),[page,setPage]=useState(1),[editor,setEditor]=useState<number|null|undefined>(),[selected,setSelected]=useState<number|null>(enrollmentFromLocation),[assignment,setAssignment]=useState<Course|null>(null),[selfEnroll,setSelfEnroll]=useState<Course|null>(null);
  const context=useQuery<Context>({queryKey:[base+'/context']}),courses=useQuery<Courses>({queryKey:[base+'/courses',{q,offset:(page-1)*25}],enabled:tab==='catalogue'&&editor===undefined&&!selected});
  if(!context.data)return <div className="space-y-3"><QueryError error={context.error}/>{context.isLoading?<p role="status">Loading your academy…</p>:<Button variant="outline" onClick={()=>context.refetch()}>Reload academy</Button>}</div>;
  const {brand,canManage,canReport,canConfigure}=context.data;
  const openEnrollment=(id:number|null)=>{setSelected(id);const url=new URL(window.location.href);if(id)url.searchParams.set('enrollment',String(id));else url.searchParams.delete('enrollment');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);};
  if(selected)return <InductionPlayer key={selected} id={selected} onBack={()=>openEnrollment(null)}/>;
  if(editor!==undefined)return <InductionAuthor courseId={editor||undefined} onClose={()=>{setEditor(undefined);setTab('catalogue');}} onSaved={()=>setTab('catalogue')}/>;
  const tabs=[{id:'mine',label:'My learning'},{id:'catalogue',label:'Course catalogue'},...(canManage?[{id:'library',label:'Safety course library'}]:[]),...(canReport?[{id:'records',label:'Team learning reports'}]:[]),...(canConfigure?[{id:'branding',label:'Academy branding'}]:[])];
  return <div className="space-y-6">
    <header className="rounded-lg border border-t-4 bg-card p-5" style={{borderTopColor:brand.config.accentColor}}><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4">{brand.config.logoAssetId&&<img className="h-14 w-24 object-contain" src={`${base}/assets/${brand.config.logoAssetId}/download`} alt={`${brand.config.organizationName} logo`}/>}<div><p className="text-sm text-muted-foreground">{brand.config.organizationName}</p><h2 className="mt-1 text-2xl font-semibold">{brand.config.academyTitle}</h2><p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">{brand.config.welcomeText}</p></div></div>{canManage&&<Button onClick={()=>setEditor(null)}>Create induction course</Button>}</div></header>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Induction academy sections">{tabs.map(item=><Button key={item.id} id={`induction-tab-${item.id}`} role="tab" aria-selected={tab===item.id} aria-controls={`induction-panel-${item.id}`} variant={tab===item.id?'default':'outline'} onClick={()=>{setTab(item.id);setAssignment(null);setSelfEnroll(null);}}>{item.label}</Button>)}</div>
    <div id={`induction-panel-${tab}`} role="tabpanel" aria-labelledby={`induction-tab-${tab}`} className="space-y-5">
      {tab==='mine'&&<InductionReports mine onOpen={openEnrollment}/>}
      {tab==='records'&&canReport&&<InductionReports onOpen={openEnrollment}/>}
      {tab==='library'&&canManage&&<InductionSafetyLibrary onEdit={setEditor} onCatalogue={()=>setTab('catalogue')}/>}
      {tab==='branding'&&canConfigure&&<InductionBrandEditor onClose={()=>setTab('mine')}/>}
      {tab==='catalogue'&&<>
        {assignment&&<Section title={`Assign training · ${assignment.definition.title}`}><AssignmentForm key={assignment.id} course={assignment} onClose={()=>setAssignment(null)} onOpen={openEnrollment}/></Section>}
        {selfEnroll&&<Section title={`Start training · ${selfEnroll.definition.title}`}><SelfEnrollment key={selfEnroll.id} course={selfEnroll} onClose={()=>setSelfEnroll(null)} onOpen={openEnrollment}/></Section>}
        <Section title="Induction course catalogue"><div className="flex flex-wrap items-end justify-between gap-3"><div className="min-w-60 flex-1"><Input label="Search courses" placeholder="Course title or description" value={q} maxLength={100} onChange={e=>{setQ(e.target.value);setPage(1);}}/></div>{canManage&&<p className="max-w-md text-sm text-muted-foreground">Publish a course before assigning it. Existing learners retain the release assigned to them.</p>}</div><QueryError error={courses.error}/>{courses.error&&<Button variant="outline" onClick={()=>courses.refetch()}>Reload courses</Button>}
          {courses.isLoading?<p role="status">Loading courses…</p>:<div className="grid gap-4 xl:grid-cols-2">{courses.data?.items.map(course=>{
            const release=course.publishedRelease,settings=release?.settings,available=!!release&&course.definition.status!=='archived';
            return <article className="space-y-4 rounded-lg border p-5" key={course.id}><div className="flex items-start justify-between gap-3"><h3 className="text-lg font-semibold">{course.definition.title}</h3><span className="rounded bg-muted px-2 py-1 text-xs">{course.definition.status==='archived'?'Archived':release?`Release ${release.releaseNumber}`:'Draft'}</span></div><p className="whitespace-pre-wrap text-sm">{course.definition.description}</p><div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{course.definition.durationMinutes} minutes</span>{release&&<><span>{release.lessonCount} lessons</span><span>{release.questionCount} quiz questions</span><span>Pass score: {settings?.passScore}%</span></>}</div>
              {settings&&<div className="space-y-1 text-sm"><p>{settings.mandatoryForOnboarding?'Part of required induction':'Role and skills training'}</p><p className="text-xs text-muted-foreground">{settings.employeeTypes.map(t=>t==='temporary'?'Temporary / event staff':t==='contract'?'Contract employees':'Permanent employees').join(' · ')}{settings.departments.length?` · ${settings.departments.join(', ')}`:' · All departments'}</p>{settings.enrollmentApprovalRequired&&<p className="text-xs text-muted-foreground">Enrollment approval required.</p>}</div>}
              {canManage&&course.hasDraft&&release&&<p className="rounded bg-muted p-2 text-xs">There are unpublished changes. New assignments use release {release.releaseNumber} until a new release is published.</p>}
              <div className="flex flex-wrap gap-2">{available&&settings?.allowSelfEnrollment&&<Button onClick={()=>{setSelfEnroll(course);setAssignment(null);}}>{settings.enrollmentApprovalRequired?'Request enrollment':'Enroll & start'}</Button>}{available&&!settings?.allowSelfEnrollment&&!canManage&&<p className="text-sm text-muted-foreground">Your HR team assigns this course.</p>}{canManage&&<><Button variant="outline" onClick={()=>setEditor(course.id)}>Edit course</Button>{available&&<Button variant="outline" onClick={()=>{setAssignment(course);setSelfEnroll(null);}}>Assign employees</Button>}</>}</div>
            </article>;
          })}</div>}
          {courses.data&&!courses.data.items.length&&<p className="text-sm text-muted-foreground">{canManage?'No courses match this search. Create an induction course with your own lessons and quiz to get started.':'No published courses match this search. Assigned training appears under My learning.'}</p>}<Pager page={page} total={courses.data?.total||0} onChange={setPage}/>
        </Section>
      </>}
    </div>
  </div>;
}

function SelfEnrollment({course,onClose,onOpen}:{course:Course;onClose:()=>void;onOpen:(id:number)=>void}){
  const save=useSave<{enrollmentId:number}>(value=>onOpen(value.enrollmentId));
  return <form className="space-y-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save.mutate({url:`${base}/courses/${course.id}/enroll`,body:{releaseId:course.publishedRelease!.id,reason:text(f,'reason')}});}}><p className="text-sm">You will be enrolled in release {course.publishedRelease?.releaseNumber}. {course.publishedRelease?.settings.enrollmentApprovalRequired?'Your assigned reviewer must approve the enrollment before you begin.':'Your lessons will be available after enrollment.'}</p><Note label="Reason for enrollment" value="Complete my employee induction and training."/><QueryError error={save.error}/><div className="flex gap-2"><Button disabled={save.isPending}>Confirm enrollment</Button><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button></div></form>;
}

function AssignmentForm({course,onClose,onOpen}:{course:Course;onClose:()=>void;onOpen:(id:number)=>void}){
  const [q,setQ]=useState(''),[selected,setSelected]=useState<SelectedEmployee[]>([]),[saved,setSaved]=useState<{id:number;enrollmentId:number;employeeId:number}[]|null>(null);
  const directory=useQuery<Directory>({queryKey:['/api/learning/directory',{q}]}),save=useSave<{items:{id:number;enrollmentId:number;employeeId:number}[]}>(value=>setSaved(value.items));
  const toggle=(employee:SelectedEmployee,checked:boolean)=>setSelected(old=>checked?(old.some(e=>e.id===employee.id)?old:[...old,employee]):old.filter(e=>e.id!==employee.id));
  if(saved)return <div className="space-y-4"><p role="status" className="font-medium">Training assignment saved for {saved.length} {saved.length===1?'employee':'employees'}.</p><p className="text-sm text-muted-foreground">Each assignment retains its course release, quiz rules and due date. Existing assignments returned by the server remain unchanged.</p><ul className="space-y-2">{saved.map(record=><li key={record.enrollmentId} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"><span>{selected.find(e=>e.id===record.employeeId)?.name||'Assigned employee'}</span><Button variant="outline" onClick={()=>onOpen(record.enrollmentId)}>Open training record</Button></li>)}</ul><Button variant="outline" onClick={onClose}>Done</Button></div>;
  return <form className="space-y-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save.mutate({url:`${base}/courses/${course.id}/assign`,body:{employeeIds:selected.map(employee=>employee.id),releaseId:course.publishedRelease!.id,dueDate:text(f,'dueDate')||null,required:f.has('required'),reason:text(f,'reason')}});}}>
    <p className="text-sm text-muted-foreground">Select up to 100 employees within your access scope. The server checks eligibility for this course’s employee types and departments before assigning release {course.publishedRelease?.releaseNumber}.</p>
    <Input label="Find employees to assign" value={q} maxLength={100} placeholder="Name or employee code" onChange={e=>setQ(e.target.value)}/><QueryError error={directory.error}/>{directory.isLoading&&<p role="status" className="text-sm">Loading employees…</p>}
    <fieldset className="max-h-72 space-y-2 overflow-y-auto rounded border p-3"><legend className="px-1 text-sm font-medium">Matching employees</legend>{directory.data?.employees.map(employee=><label className="flex items-center gap-3 rounded p-2 text-sm hover:bg-muted" key={employee.id}><input type="checkbox" checked={selected.some(e=>e.id===employee.id)} disabled={save.isPending||selected.length>=100&&!selected.some(e=>e.id===employee.id)} onChange={e=>toggle(employee,e.target.checked)}/><span>{employee.name} <span className="text-muted-foreground">· {employee.code}{employee.own?' · You':''}</span></span></label>)}{directory.data&&!directory.data.employees.length&&<p className="text-sm text-muted-foreground">No employees match this search.</p>}</fieldset><p className="text-xs text-muted-foreground">Up to 50 search results are shown. Search again to add more people; your selection is retained.</p>
    <div className="space-y-2"><p className="text-sm font-medium">{selected.length} / 100 selected</p><div className="flex flex-wrap gap-2">{selected.map(employee=><button type="button" className="rounded-full border px-3 py-1 text-xs" key={employee.id} onClick={()=>toggle(employee,false)} disabled={save.isPending} aria-label={`Remove ${employee.name} from this assignment`}>{employee.name} · Remove</button>)}</div>{!!selected.length&&<Button type="button" variant="ghost" onClick={()=>setSelected([])} disabled={save.isPending}>Clear selection</Button>}</div>
    <Input label="Due date (blank uses the course default)" name="dueDate" type="date" min={today()}/><Toggle label="Required training assignment" name="required" checked={true}/><Note label="Assignment reason" value="Employee induction and role training assignment."/><QueryError error={save.error}/><div className="flex flex-wrap gap-2"><Button disabled={save.isPending||!selected.length}>Assign to {selected.length} {selected.length===1?'employee':'employees'}</Button><Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button></div>
  </form>;
}
