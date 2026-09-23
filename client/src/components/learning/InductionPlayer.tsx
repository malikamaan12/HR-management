import {ArrowLeft,ArrowRight,CheckCircle2,Play,Lock,BookOpen,Clock3,Award} from 'lucide-react';
import {CourseCover,LearningProgress} from './LearningVisuals';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {QueryError,Section,Table} from '@/components/hr/Operations';
import {History,Note,Reassign,text} from '@/components/hr/EmployeeServiceUI';
import {apiJson} from '@/lib/queryClient';
import {useToast} from '@/hooks/use-toast';
import type {InductionBrand,PublicInductionContent,PublicInductionQuestion} from '@shared/induction';
import type {WorkflowEvent} from '@shared/employee-services';
import {inductionStatus} from './LearningVisuals';

const base='/api/learning/induction';
type Attempt={id:number;attemptNumber:number;status:string;startedAt:string;expiresAt:string;submittedAt:string|null;score:number|null;passed:boolean|null};
type ActiveAttempt={id:number;attemptNumber:number;expiresAt:string;questions:PublicInductionQuestion[]};
type EnrollmentRow={id:number;version:number;status:string;progress:number;score:number|null;dueDate:string|null;expiresOn:string|null;completedAt:string|null;certificateNumber:string|null;completionNote:string|null;approverId:number;courseSnapshot:{title:string;description?:string;coverImage?:import('@shared/employee-services').CourseDefinition['coverImage'];coverImageUrl?:string};history:WorkflowEvent[]};
type QuizResult={score:number;passed:boolean;earnedPoints:number;totalPoints:number};
type Detail={row:EnrollmentRow;employeeName:string;content:PublicInductionContent;brand:InductionBrand;lessons:{lessonId:string;openedAt:string|null;completedAt:string|null}[];attempts:Attempt[];activeAttempt:ActiveAttempt|null;canLearn:boolean;canReview:boolean;canExempt:boolean;canReassign:boolean;required:boolean;releaseNumber:number;attemptsRemaining:number;retryAfter:string|null;assets?:{id:number;mime:string;filename:string}[];result?:QuizResult};
type Command={url:string;body:unknown;kind?:'open'|'complete'|'start'|'submit'|'review'|'exempt'};
const editableStatuses=['approved','in_progress','failed'];
const when=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'—';

export default function InductionPlayer({id,onBack}:{id:number;onBack?:()=>void}){
  const cache=useQueryClient(),{toast}=useToast(),query=useQuery<Detail>({queryKey:[`${base}/enrollments/${id}`],staleTime:0});
  const [selectedLessonId,setSelectedLessonId]=useState(''),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState<QuizResult|null>(null),[now,setNow]=useState(Date.now());
  const startKey=useRef(crypto.randomUUID());
  const mutation=useMutation({mutationFn:({url,body}:Command)=>apiJson<Detail>(url,{method:'POST',body}),onSuccess:(value,command)=>{
    if(value?.row&&value?.content)cache.setQueryData([`${base}/enrollments/${id}`],value);
    cache.invalidateQueries();
    if(command.kind==='start'){startKey.current=crypto.randomUUID();setResult(null);}
    if(command.kind==='complete')setConfirmed(false);
    if(command.kind==='submit'&&value.result)setResult(value.result);
    if(command.kind!=='open')toast({title:command.kind==='submit'?'Quiz attempt recorded':command.kind==='complete'?'Lesson completion saved':'Training record updated'});
  },onError:e=>toast({title:'Unable to update training',description:e.message,variant:'destructive'})});
  const firstLesson=query.data?.content.lessons.find(l=>!query.data?.lessons.some(p=>p.lessonId===l.id&&p.completedAt))?.id||query.data?.content.lessons[0]?.id;
  useEffect(()=>{setSelectedLessonId('');setResult(null);setConfirmed(false);startKey.current=crypto.randomUUID();},[id]);
  useEffect(()=>{if(firstLesson&&!selectedLessonId)setSelectedLessonId(firstLesson);},[firstLesson,selectedLessonId]);
  useEffect(()=>setConfirmed(false),[selectedLessonId]);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(!query.data?.activeAttempt||!query.data?.canLearn)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[query.data?.activeAttempt?.id,query.data?.canLearn]);
  if(!query.data)return <div className="space-y-4">{onBack&&<Button variant="outline" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4"/>Back to courses</Button>}<QueryError error={query.error}/>{query.isLoading?<p role="status">Loading training…</p>:<Button variant="outline" onClick={()=>query.refetch()}>Reload training</Button>}</div>;
  const detail=query.data,row=detail.row,content=detail.content,settings=content.settings,lesson=content.lessons.find(l=>l.id===selectedLessonId)||content.lessons[0];
  const selectedProgress=detail.lessons.find(p=>p.lessonId===lesson?.id),selectedIndex=content.lessons.findIndex(l=>l.id===lesson?.id);
  const priorRequiredIncomplete=content.lessons.slice(0,Math.max(0,selectedIndex)).some(l=>l.required&&!detail.lessons.some(p=>p.lessonId===l.id&&p.completedAt));
  const locked=settings.sequentialLessons&&priorRequiredIncomplete,canStudy=detail.canLearn&&editableStatuses.includes(row.status),lessonVisible=!!selectedProgress?.openedAt||!canStudy;
  const requiredLessons=content.lessons.filter(l=>l.required),completedRequired=requiredLessons.filter(l=>detail.lessons.some(p=>p.lessonId===l.id&&p.completedAt)).length,requiredComplete=completedRequired===requiredLessons.length;
  const retryWait=detail.retryAfter?Math.max(0,new Date(detail.retryAfter).getTime()-now):0;
  const canResubmit=detail.canLearn&&row.status==='in_progress'&&row.score!==null&&row.score>=settings.passScore&&detail.attempts.some(a=>a.passed)&&settings.reviewRequired;
  const asset=lesson?.assetId?detail.assets?.find(a=>a.id===lesson.assetId):undefined,assetUrl=lesson?.assetId?`${base}/assets/${lesson.assetId}/download?enrollmentId=${id}`:'';
  const reviewActions=detail.canReview?(row.status==='requested'?[{action:'approve',label:'Approve enrollment'},{action:'reject',label:'Reject enrollment'}]:row.status==='completion_submitted'?[{action:'verify',label:'Verify & complete'},{action:'return',label:'Return for follow-up'}]:[]):[];
  return <div className="learning-player space-y-6">
    {onBack&&<Button variant="outline" onClick={()=>{if(!detail.activeAttempt||!detail.canLearn||window.confirm('Leave this quiz? Unsubmitted answers will be cleared and the attempt timer will continue.'))onBack();}}><ArrowLeft className="mr-2 h-4 w-4"/>Back to courses</Button>}
    <header className="learning-player-overview"><CourseCover course={row.courseSnapshot}/><div className="learning-player-summary">
      <p className="course-provider">{detail.brand.academyTitle} · {inductionStatus(row.status)}{!detail.canLearn?` · ${detail.employeeName}`:''}</p><h1>{row.courseSnapshot.title}</h1>
      <div className="course-meta"><span><BookOpen/>{completedRequired} / {requiredLessons.length} required lessons</span><span><Clock3/>{row.dueDate?`Due ${row.dueDate}`:'Self-paced'}</span>{row.score!==null&&<span><Award/>{row.score}% quiz score</span>}</div>
      <LearningProgress value={row.progress} label={detail.canLearn?"Your lesson progress":"Lesson progress"}/>
      {!detail.canLearn&&<p className="text-sm text-muted-foreground">You are viewing this employee’s training record. Lesson acknowledgements and quiz answers must be submitted by the assigned employee.</p>}
      {row.status==='requested'&&<p className="rounded bg-muted p-3 text-sm">This enrollment is awaiting approval. Lessons and the quiz become available after approval.</p>}
      {row.status==='completion_submitted'&&<p className="rounded bg-muted p-3 text-sm">The quiz has passed. Completion is awaiting the assigned reviewer’s decision.</p>}
      {row.status==='completed'&&<div className="rounded bg-muted p-4 text-sm space-y-2"><p className="font-semibold">Training completed · {when(row.completedAt)}</p>{row.expiresOn&&<p>Valid until {row.expiresOn}</p>}{row.certificateNumber&&<a className="text-primary underline" href={`${base}/enrollments/${id}/certificate`} target="_blank" rel="noopener noreferrer">Open certificate · {row.certificateNumber}</a>}</div>}
      {row.completionNote&&<p className="whitespace-pre-wrap text-sm">{row.completionNote}</p>}
    </div></header>
    <QueryError error={query.error}/><QueryError error={mutation.error}/>
    {query.error&&<Button variant="outline" onClick={()=>query.refetch()}>Refresh training record</Button>}
    <div className="learning-player-grid">
      <aside className="learning-lesson-path"><h2>Course content</h2><ol>{content.lessons.map((item,index)=>{
        const progress=detail.lessons.find(p=>p.lessonId===item.id),blocked=settings.sequentialLessons&&content.lessons.slice(0,index).some(l=>l.required&&!detail.lessons.some(p=>p.lessonId===l.id&&p.completedAt));
        return <li key={item.id}><button type="button" className="learning-lesson-step" onClick={()=>setSelectedLessonId(item.id)} aria-current={lesson?.id===item.id?'step':undefined}><span className="lesson-step-icon">{progress?.completedAt?<CheckCircle2/>:blocked&&canStudy?<Lock/>:<span>{index+1}</span>}</span><span className="min-w-0"><span className="block font-medium">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{progress?.completedAt?'Completed':blocked&&canStudy?'Complete earlier required lessons':progress?.openedAt?'Started':'Not started'} · {item.required?'Required':'Optional'}{item.estimatedMinutes?` · ${item.estimatedMinutes} min`:''}</span></span></button></li>;
      })}</ol><p className="text-xs text-muted-foreground">{settings.sequentialLessons?'Required lessons follow the order shown.':'Lessons may be completed in any order.'}</p></aside>
      {lesson&&<div className="learning-lesson-content"><Section title={lesson.title}>
        {locked&&canStudy&&!selectedProgress?.completedAt?<p className="rounded bg-muted p-4 text-sm">Complete the earlier required lessons to begin this lesson.</p>:<>
          {!lessonVisible&&<div className="space-y-3"><p className="text-sm text-muted-foreground">Open this lesson to begin reviewing its content.</p><Button disabled={mutation.isPending} onClick={()=>mutation.mutate({url:`${base}/enrollments/${id}/lessons/${lesson.id}/open`,body:{},kind:'open'})}><Play className="mr-2 h-4 w-4"/>Start lesson</Button></div>}
          {lessonVisible&&<div className="space-y-4">
            {lesson.body&&<div className="lesson-reading-text">{lesson.body}</div>}
            {assetUrl&&lesson.kind==='video'&&<video key={assetUrl} controls playsInline preload="metadata" className="w-full max-h-[32rem] rounded-md bg-black" aria-label={lesson.title}><source src={assetUrl}/>Your browser cannot play this file. Use the lesson file link below.</video>}
            {assetUrl&&lesson.kind==='document'&&(asset?.mime.startsWith('image/')?<img src={assetUrl} className="max-h-[40rem] w-full rounded border object-contain" alt={lesson.title}/>:<iframe title={`Lesson document: ${lesson.title}`} src={assetUrl} className="h-[36rem] w-full rounded border"/>)}
            {assetUrl&&<a className="inline-block text-sm underline text-primary" href={assetUrl} target="_blank" rel="noopener noreferrer">Open {asset?.filename||'lesson file'} in a new tab</a>}
            {selectedProgress?.completedAt?<p className="rounded bg-muted p-3 text-sm">Lesson acknowledged on {when(selectedProgress.completedAt)}.</p>:canStudy&&<form className="space-y-3 rounded border p-4" onSubmit={e=>{e.preventDefault();mutation.mutate({url:`${base}/enrollments/${id}/lessons/${lesson.id}/complete`,body:{version:row.version,confirmed:true},kind:'complete'});}}>
              <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required/><span>I have reviewed this lesson and understand its content.</span></label><p className="text-xs text-muted-foreground">This records your acknowledgement of the lesson.</p><Button disabled={!confirmed||mutation.isPending}>Mark lesson complete</Button>
            </form>}
          </div>}
        </>}
      </Section><div className="lesson-navigation"><Button variant="outline" disabled={selectedIndex<=0} onClick={()=>setSelectedLessonId(content.lessons[selectedIndex-1].id)}><ArrowLeft className="mr-2 h-4 w-4"/>Previous</Button><span>Lesson {selectedIndex+1} of {content.lessons.length}</span>{selectedIndex<content.lessons.length-1?<Button variant="outline" disabled={canStudy&&settings.sequentialLessons&&lesson.required&&!selectedProgress?.completedAt} onClick={()=>setSelectedLessonId(content.lessons[selectedIndex+1].id)}>Next lesson<ArrowRight className="ml-2 h-4 w-4"/></Button>:<Button variant="outline" onClick={()=>document.getElementById('learning-quiz')?.scrollIntoView({behavior:'smooth'})}>Knowledge check<ArrowRight className="ml-2 h-4 w-4"/></Button>}</div></div>}
    </div>
    <div id="learning-quiz"><Section title="Knowledge check">
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><p>Passing score: {settings.passScore}%</p><p>{content.questionCount} questions per attempt</p><p>Time limit: {settings.attemptMinutes} minutes</p><p>Attempts remaining: {detail.attemptsRemaining} / {settings.maxAttempts}</p></div>
      <p className="text-sm text-muted-foreground">Quiz scores are calculated from your submitted answers. {settings.reviewRequired?'A reviewer confirms completion after a passing result.':'A passing result completes the course once all required lessons are acknowledged.'}</p>
      {result&&<div role="status" className="rounded border bg-muted p-4"><p className="text-lg font-semibold">{result.passed?'Quiz passed':'Passing score not reached'} · {result.score}%</p><p className="text-sm">{result.earnedPoints} / {result.totalPoints} points</p></div>}
      {detail.activeAttempt&&detail.canLearn?<QuizAttempt key={detail.activeAttempt.id} attempt={detail.activeAttempt} pending={mutation.isPending} now={now} onRefresh={()=>query.refetch()} onSubmit={answers=>mutation.mutate({url:`${base}/enrollments/${id}/attempts/${detail.activeAttempt!.id}/submit`,body:{answers},kind:'submit'})}/>:<>
        {!requiredComplete&&canStudy&&<p className="rounded bg-muted p-3 text-sm">Complete all {requiredLessons.length} required lessons to unlock the quiz.</p>}
        {retryWait>0&&canStudy&&<p className="text-sm">Your next attempt is available at {when(detail.retryAfter)}.</p>}
        {canStudy&&detail.attemptsRemaining===0&&<p className="rounded bg-muted p-3 text-sm">All permitted attempts have been used. Contact your HR team about the next steps.</p>}
        {canStudy&&requiredComplete&&detail.attemptsRemaining>0&&!canResubmit&&<Button disabled={mutation.isPending||retryWait>0} onClick={()=>mutation.mutate({url:`${base}/enrollments/${id}/attempts/start`,body:{version:row.version,key:startKey.current},kind:'start'})}>Start {detail.attempts.length?'next ':''}quiz attempt</Button>}
        {detail.activeAttempt&&!detail.canLearn&&<p className="text-sm text-muted-foreground">The employee has an active quiz attempt. Their submitted score will appear when the attempt is recorded.</p>}
      </>}
      {canResubmit&&<form className="space-y-3 rounded border p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);mutation.mutate({url:`${base}/enrollments/${id}/resubmit`,body:{version:row.version,reason:text(f,'reason')},kind:'review'});}}><p className="text-sm">Your passing quiz result is retained. Address the reviewer’s feedback and resubmit the same result for completion review.</p><Note label="Follow-up and resubmission reason"/><Button disabled={mutation.isPending}>Resubmit for completion review</Button></form>}
      <details className="rounded border p-4"><summary className="cursor-pointer text-sm font-medium">Quiz attempt history ({detail.attempts.length})</summary><div className="mt-3"><Table headers={['Attempt','Started','Submitted','Score','Result']} rows={detail.attempts.map(a=>[a.attemptNumber,when(a.startedAt),when(a.submittedAt),a.score===null?'—':`${a.score}%`,a.passed?'Passed':a.submittedAt?'Not passed':inductionStatus(a.status)])}/></div></details>
    </Section>
    </div>
    {!!reviewActions.length&&<Section title="Enrollment review"><form className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),action=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');if(action)mutation.mutate({url:`/api/learning/enrollments/${id}/actions`,body:{version:row.version,action,reason:text(f,'reason')},kind:'review'});}}>{row.status==='completion_submitted'&&<p className="text-sm text-muted-foreground">Verification uses the recorded quiz result. The score cannot be changed manually.</p>}<Note label="Review decision and reason"/><div className="flex flex-wrap gap-2">{reviewActions.map(action=><Button key={action.action} value={action.action} variant={['reject','return'].includes(action.action)?'outline':'default'} disabled={mutation.isPending}>{action.label}</Button>)}</div></form></Section>}
    {detail.canExempt&&<details className="rounded-lg border p-5"><summary className="cursor-pointer font-medium">Record an induction exemption</summary><form className="mt-4 space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);mutation.mutate({url:`${base}/enrollments/${id}/exempt`,body:{version:row.version,reason:text(f,'reason')},kind:'exempt'});}}><p className="text-sm text-muted-foreground">Use only when this employee does not need to complete this assignment. The decision is retained in their training history and does not award a passing quiz score.</p><Note label="Reason for exemption"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" required/>I confirm this exemption is appropriate for this employee.</label><Button variant="outline" disabled={mutation.isPending}>Record exemption</Button></form></details>}
    {detail.canReassign&&<Reassign base="/api/learning/enrollments" directoryBase="/api/learning" id={id} version={row.version}/>}
    {row.history?.length>0&&<History events={row.history}/>}
  </div>;
}

function QuizAttempt({attempt,pending,now,onRefresh,onSubmit}:{attempt:ActiveAttempt;pending:boolean;now:number;onRefresh:()=>void;onSubmit:(answers:{questionId:string;optionIds:string[]}[])=>void}){
  const [answers,setAnswers]=useState<Record<string,string[]>>({}),[ready,setReady]=useState(false),[questionIndex,setQuestionIndex]=useState(0);
  const seconds=Math.max(0,Math.ceil((new Date(attempt.expiresAt).getTime()-now)/1000)),expired=seconds===0,answered=attempt.questions.filter(q=>answers[q.id]?.length).length;
  const choose=(question:PublicInductionQuestion,optionId:string,checked:boolean)=>setAnswers(old=>({...old,[question.id]:question.kind==='multiple'?(checked?[...(old[question.id]||[]).filter(id=>id!==optionId),optionId]:(old[question.id]||[]).filter(id=>id!==optionId)):[optionId]}));
  return <form className="space-y-5" onSubmit={e=>{e.preventDefault();if(pending||expired||!ready||answered!==attempt.questions.length)return;onSubmit(attempt.questions.filter(q=>answers[q.id]?.length).map(q=>({questionId:q.id,optionIds:answers[q.id]})));}}>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-muted p-4"><p className="font-medium">Attempt {attempt.attemptNumber}</p><p role="timer" aria-label="Time remaining" className={expired?'font-semibold text-destructive':'font-mono text-lg'}>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</p><p className="text-sm">{answered} / {attempt.questions.length} answered</p></div>
    <p className="text-sm text-muted-foreground">Select {attempt.questions.some(q=>q.kind==='multiple')?'all correct options where requested and one answer for other questions':'one answer for each question'}. Keep this page open until you submit; unsubmitted answers are kept only in this page.</p>
    {expired&&<div className="space-y-3 rounded border border-destructive p-3"><p role="alert" className="text-sm text-destructive">The time limit has ended. Refresh the training record to see the recorded attempt and available next steps.</p><Button type="button" variant="outline" onClick={onRefresh} disabled={pending}>Refresh timed-out attempt</Button></div>}
    <div className="quiz-question-nav" role="group" aria-label="Quiz questions">{attempt.questions.map((question,index)=><button key={question.id} type="button" aria-label={`Question ${index+1}${answers[question.id]?.length?', answered':''}`} aria-current={questionIndex===index?'step':undefined} data-answered={!!answers[question.id]?.length} onClick={()=>setQuestionIndex(index)}>{index+1}</button>)}</div>
    {attempt.questions.map((question,index)=>index===questionIndex&&<fieldset className="space-y-3 rounded border p-4" key={question.id} disabled={pending||expired}><legend className="px-1 text-sm font-semibold">Question {index+1} · {question.points} {question.points===1?'point':'points'}</legend><p className="whitespace-pre-wrap font-medium">{question.prompt}</p><p className="text-xs text-muted-foreground">{question.kind==='multiple'?'Select all correct answers.':'Select one answer.'}</p>{question.options.map(option=><label key={option.id} className="quiz-answer-option" data-selected={!!answers[question.id]?.includes(option.id)}><input className="mt-1" type={question.kind==='multiple'?'checkbox':'radio'} name={`question-${question.id}`} value={option.id} checked={!!answers[question.id]?.includes(option.id)} onChange={e=>choose(question,option.id,e.target.checked)}/><span className="whitespace-pre-wrap">{option.text}</span></label>)}</fieldset>)}
    <div className="lesson-navigation"><Button type="button" variant="outline" disabled={!questionIndex} onClick={()=>setQuestionIndex(i=>i-1)}><ArrowLeft className="mr-2 h-4 w-4"/>Previous</Button><span>Question {questionIndex+1} of {attempt.questions.length}</span><Button type="button" variant="outline" disabled={questionIndex===attempt.questions.length-1} onClick={()=>setQuestionIndex(i=>i+1)}>Next<ArrowRight className="ml-2 h-4 w-4"/></Button></div>
    {!expired&&questionIndex===attempt.questions.length-1&&<div className="space-y-3 rounded border p-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" required checked={ready} onChange={e=>setReady(e.target.checked)}/>I have reviewed my answers and am ready to submit this attempt.</label><p className="text-xs text-muted-foreground">Submitted answers cannot be edited. Multiple-answer questions require the complete correct selection to earn their points.</p><Button disabled={pending||answered!==attempt.questions.length||!ready}>{pending?'Saving attempt…':'Submit quiz answers'}</Button></div>}
  </form>;
}
