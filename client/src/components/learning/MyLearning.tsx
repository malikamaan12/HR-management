import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {BookOpen,Play,Clock3,Award,Search,ArrowRight} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {QueryError} from '@/components/hr/Operations';
import {Pager,today} from '@/components/hr/EmployeeServiceUI';
import {useDebounced} from '@/components/communications/HubControls';
import {CourseCover,LearningProgress} from './LearningVisuals';
import type {Records} from './InductionReports';
import {inductionStatus} from './LearningVisuals';

export default function MyLearning({onOpen,onBrowse}:{onOpen:(id:number)=>void;onBrowse:()=>void}) {
  const [q,setQ]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),search=useDebounced(q);
  const query=useQuery<Records>({queryKey:['/api/learning/induction/records',{mine:'true',q:search,status,offset:(page-1)*25}]});
  const stats=query.data?.stats;
  return <div className="space-y-5">
    <div className="learning-section-heading"><div><h2>My learning</h2><p>Pick up where you left off.</p></div><Button variant="outline" onClick={onBrowse}>Explore courses<ArrowRight className="ml-2 h-4 w-4"/></Button></div>
    {stats&&<div className="learning-summary"><span><BookOpen/>{stats.assigned}<small>Assigned</small></span><span><Play/>{stats.inProgress}<small>In progress</small></span><span><Award/>{stats.completed}<small>Completed</small></span>{stats.overdue>0&&<span className="text-destructive"><Clock3/>{stats.overdue}<small>Overdue</small></span>}</div>}
    <div className="learning-catalog-toolbar"><label className="learning-search"><Search/><input aria-label="Search my learning" placeholder="Find your course…" value={q} maxLength={100} onChange={e=>{setQ(e.target.value);setPage(1);}}/></label><select aria-label="Filter my learning" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="learning-select"><option value="">All learning</option><option value="approved">Ready to start</option><option value="in_progress">In progress</option><option value="requested">Awaiting approval</option><option value="completion_submitted">Awaiting review</option><option value="completed">Completed</option><option value="failed">Needs follow-up</option><option value="withdrawn">Withdrawn</option><option value="rejected">Rejected</option></select></div>
    <QueryError error={query.error}/>{query.isLoading&&<p role="status">Loading your learning…</p>}
    <div className="learning-course-grid">{!query.error&&query.data?.items.map(row=>{
      const ready=['approved','in_progress'].includes(row.status),overdue=row.dueDate&&row.dueDate<today()&&!['completed','withdrawn','rejected'].includes(row.status);
      return <article key={row.id} className="learning-course-card"><button className="course-cover-button" aria-label={`Open ${row.title}`} onClick={()=>onOpen(row.id)}><CourseCover course={row}/><span className="course-image-tag">{row.required?'Required':'My course'}</span></button><div className="course-card-body"><span className="course-provider">{inductionStatus(row.status)}</span><h3>{row.title}</h3><LearningProgress value={row.progress} label="Lessons completed"/><div className={`course-meta ${overdue?'text-destructive':''}`}><Clock3/>{row.dueDate?`Due ${row.dueDate}`:'Learn at your own pace'}</div><div className="course-card-actions"><Button className="w-full gap-2" variant={row.status==='completed'?'outline':'default'} onClick={()=>onOpen(row.id)}>{ready?<Play className="h-4 w-4"/>:<BookOpen className="h-4 w-4"/>}{ready?(row.progress?'Continue learning':'Start learning'):row.status==='completed'?'Review course':'View enrollment'}</Button>{row.status==='completed'&&row.certificateNumber&&<Button variant="ghost" className="w-full gap-2" asChild><a href={`/api/learning/induction/enrollments/${row.id}/certificate`} target="_blank" rel="noopener noreferrer"><Award className="h-4 w-4"/>View certificate</a></Button>}</div></div></article>;
    })}</div>
    {!query.error&&query.data&&!query.data.items.length&&<div className="learning-empty"><BookOpen/><h3>{q||status?'No courses match':'Your next skill starts here'}</h3><p>{q||status?'Try another search or filter.':'Explore the catalog or find training assigned by your team.'}</p><Button onClick={onBrowse}>Explore courses</Button></div>}
    {(query.data?.total||0)>25&&<Pager page={page} total={query.data?.total||0} onChange={setPage}/>}
  </div>;
}
