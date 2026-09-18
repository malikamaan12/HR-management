import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Field,QueryError,Section,Table,downloadCsv,fieldClass} from '@/components/hr/Operations';
import {Input,Pager,today} from '@/components/hr/EmployeeServiceUI';

const base='/api/learning/induction';
export type InductionRecord={id:number;employeeId:number;employeeName:string;employeeCode:string;courseId:number;title:string;status:string;progress:number;score:number|null;dueDate:string|null;expiresOn:string|null;completedAt:string|null;certificateNumber:string|null;required:boolean;releaseNumber:number;attemptCount:number;own:boolean};
type Records={items:InductionRecord[];total:number;stats:{assigned:number;completed:number;inProgress:number;failed:number;overdue:number;averageScore:number|null}};
type CourseOptions={items:{id:number;definition:{title:string}}[];total:number};
export const inductionStatus=(value:string)=>value==='completion_submitted'?'Awaiting completion review':value.replaceAll('_',' ').replace(/^./,v=>v.toUpperCase());
const statuses=['requested','approved','in_progress','completion_submitted','completed','failed','withdrawn','rejected'];

export default function InductionReports({onOpen,mine=false}:{onOpen:(id:number)=>void;mine?:boolean}){
  const [q,setQ]=useState(''),[status,setStatus]=useState(''),[courseId,setCourseId]=useState(''),[courseSearch,setCourseSearch]=useState(''),[page,setPage]=useState(1);
  const query=useQuery<Records>({queryKey:[`${base}/${mine?'records':'reports'}`,{q,status,courseId,mine:mine?'true':undefined,offset:(page-1)*25}]}),courses=useQuery<CourseOptions>({queryKey:[base+'/courses',{q:courseSearch,offset:0}]});
  const stats=query.data?.stats;
  const exportPage=()=>downloadCsv(mine?'my-induction-records.csv':'induction-training-records.csv',[
    ['Employee','Employee code','Course','Release','Required','Status','Progress %','Quiz score %','Attempts','Due date','Completed date','Expires on','Certificate'],
    ...(query.data?.items||[]).map(r=>[r.employeeName,r.employeeCode,r.title,r.releaseNumber,r.required?'Yes':'No',inductionStatus(r.status),r.progress,r.score,r.attemptCount,r.dueDate,r.completedAt,r.expiresOn,r.certificateNumber]),
  ]);
  return <div className="space-y-5">
    {stats&&<div className="grid grid-cols-2 gap-3 lg:grid-cols-6" aria-label={mine?'My training summary':'Filtered training summary'}>{[
      ['Assigned',stats.assigned],['Completed',stats.completed],['In progress',stats.inProgress],['Failed',stats.failed],['Overdue',stats.overdue],['Average score',stats.averageScore===null?'—':`${Number(stats.averageScore).toFixed(1)}%`],
    ].map(([label,value])=><div className="rounded-lg border bg-card p-4" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}</div>}
    <Section title={mine?'My induction & training':'Training records & completion reports'}>
      <p className="text-sm text-muted-foreground">{mine?'Open an assigned course to continue your lessons and quiz. Completed records remain available here.':'View assignments, lesson progress, quiz scores and completion within your employee access scope. Summary figures follow the selected filters.'}</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Input label={mine?'Search my courses':'Search employee or course'} placeholder={mine?'Course title':'Employee name, code or course'} value={q} maxLength={100} onChange={e=>{setQ(e.target.value);setPage(1);}}/>
        <Field label="Status"><select className={fieldClass} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{statuses.map(s=><option key={s} value={s}>{inductionStatus(s)}</option>)}</select></Field>
        <Input label="Find a course filter" value={courseSearch} placeholder="Search course title" maxLength={100} onChange={e=>setCourseSearch(e.target.value)}/>
        <Field label="Course"><select className={fieldClass} value={courseId} onChange={e=>{setCourseId(e.target.value);setPage(1);}}><option value="">All courses</option>{courseId&&!courses.data?.items.some(c=>String(c.id)===courseId)&&<option value={courseId}>Selected course</option>}{courses.data?.items.map(c=><option value={c.id} key={c.id}>{c.definition.title}</option>)}</select></Field>
      </div>
      <QueryError error={courses.error}/><QueryError error={query.error}/>
      {query.error&&<Button variant="outline" onClick={()=>query.refetch()}>Reload records</Button>}
      {query.isLoading?<p role="status">Loading training records…</p>:<>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{query.data?.total||0} {mine?'of your':'accessible'} enrollment records</p><Button variant="outline" onClick={exportPage} disabled={!query.data?.items.length}>Export this page as CSV</Button></div>
        <Table headers={mine?['Course','Progress & score','Status','Dates','']:['Employee','Course','Progress & score','Status','Dates','']} rows={(query.data?.items||[]).map(r=>{
          const overdue=!!r.dueDate&&r.dueDate<today()&&!['completed','withdrawn','rejected'].includes(r.status);
          const cells=[<div><p className="font-medium">{r.title}</p><p className="text-xs text-muted-foreground">Release {r.releaseNumber} · {r.required?'Required':'Optional'}</p></div>,<div className="min-w-28 space-y-1"><label className="text-xs">Lessons: {r.progress}%<progress className="block h-2 w-full" max={100} value={r.progress} aria-label={`Lesson progress for ${r.title}`}/></label><p>{r.score===null?'No quiz score':`Score: ${r.score}%`}</p><p className="text-xs text-muted-foreground">{r.attemptCount} quiz {r.attemptCount===1?'attempt':'attempts'}</p></div>,<div><p>{inductionStatus(r.status)}</p>{overdue&&<p className="mt-1 font-medium text-destructive">Overdue</p>}</div>,<div className="space-y-1 text-xs"><p>Due: {r.dueDate||'No deadline'}</p>{r.completedAt&&<p>Completed: {new Date(r.completedAt).toLocaleDateString()}</p>}{r.expiresOn&&<p>Valid until: {r.expiresOn}</p>}</div>,<div className="flex flex-col items-start gap-2"><Button variant="outline" onClick={()=>onOpen(r.id)}>{r.own&&!['completed','withdrawn','rejected'].includes(r.status)?'Continue':'View record'}</Button>{r.status==='completed'&&r.certificateNumber&&<a className="text-sm underline text-primary" href={`${base}/enrollments/${r.id}/certificate`} target="_blank" rel="noopener noreferrer">View certificate</a>}</div>];
          return mine?cells:[<div><p className="font-medium">{r.employeeName}</p><p className="text-xs text-muted-foreground">{r.employeeCode}</p></div>,...cells];
        })}/>
        {query.data&&!query.data.items.length&&<p className="text-sm text-muted-foreground">{mine?'No training matches these filters. Browse the course catalogue or ask your HR team about your induction assignment.':'No training matches these filters. Assign a published course from the catalogue to begin tracking completion.'}</p>}
        <Pager page={page} total={query.data?.total||0} onChange={setPage}/>
      </>}
    </Section>
  </div>;
}
