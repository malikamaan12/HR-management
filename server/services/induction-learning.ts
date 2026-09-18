import {randomInt} from 'node:crypto';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {employees,learningCourses as courses,learningEnrollments as enrollments} from '@shared/schema';
import {inductionContent,publicInductionContent,type InductionContent,type InductionQuestion,type InductionBrand} from '@shared/induction';
import {learningAdmin} from '@shared/employee-services';
import {hasPermission} from '@shared/permissions';
import type {TokenPayload} from './auth';
import {db} from '../db';
import {fail,type WorkforceTransaction} from './workforce';
import {approver,employed,enrollmentRecord,event,versionCheck} from './employee-services';
import {scopedEmployee,audit,businessToday} from './hr-rules';
import {inductionBranding} from './induction';

type Employee=typeof employees.$inferSelect;
type Enrollment=typeof enrollments.$inferSelect;
type Attempt={id:number;enrollment_id:number;attempt_number:number;start_key:string;questions:InductionQuestion[];answers:{questionId:string;optionIds:string[]}[]|null;status:string;started_at:Date;expires_at:Date;submitted_at:Date|null;score:number|null;earned_points:number|null;total_points:number|null;passed:boolean|null;created_by:number};
const active=['requested','approved','in_progress','completion_submitted'];
export function inductionAudience(employee:Employee,content:InductionContent){return content.settings.employeeTypes.includes(employee.type)&&(!content.settings.departments.length||content.settings.departments.includes(employee.department));}
export async function internalEnrollment(tx:WorkforceTransaction,id:number){
 const result=await tx.execute(sql`SELECT i.*,r.course_id,r.release_number,r.content,r.definition FROM learning_induction_enrollments i JOIN learning_induction_releases r ON r.id=i.release_id WHERE i.enrollment_id=${id}`);
 const row=result.rows[0] as any;return row?{...row,content:inductionContent.parse(row.content)}:null;
}
export async function internalCourse(tx:WorkforceTransaction,id:number){return !!(await tx.execute(sql`SELECT course_id FROM learning_induction_courses WHERE course_id=${id}`)).rows.length;}
function self(user:TokenPayload,employee:Employee){if(employee.userId!==user.userId)fail(403,'Only the assigned employee can complete lessons and take this quiz');}
function learningAllowed(row:Enrollment,employee:Employee,content:InductionContent){employed(employee);if(!inductionAudience(employee,content))fail(409,'The employee is outside the audience for this course release');if(!['approved','in_progress'].includes(row.status))fail(409,'This enrollment must be approved and open before learning');}
export async function inductionRecord(tx:WorkforceTransaction,user:TokenPayload,id:number,lock=false){const record=await enrollmentRecord(tx,user,id,lock),internal=await internalEnrollment(tx,id);if(!internal)fail(404,'Internal induction enrollment not found');return {...record,internal};}
function publicAttempt(a:Attempt){return {id:a.id,attemptNumber:a.attempt_number,status:a.status,startedAt:a.started_at,expiresAt:a.expires_at,submittedAt:a.submitted_at,score:a.score,earnedPoints:a.earned_points,totalPoints:a.total_points,passed:a.passed};}
function question(q:InductionQuestion){return {id:q.id,prompt:q.prompt,kind:q.kind,options:q.options,points:q.points};}
export async function inductionDetail(tx:WorkforceTransaction,user:TokenPayload,id:number){
 const {row,employee,internal}=await inductionRecord(tx,user,id),content:InductionContent=internal.content;
 const lessonRows=(await tx.execute(sql`SELECT lesson_id,opened_at,completed_at FROM learning_induction_lesson_progress WHERE enrollment_id=${id}`)).rows as any[];
 const attempts=(await tx.execute(sql`SELECT * FROM learning_induction_attempts WHERE enrollment_id=${id} ORDER BY attempt_number DESC`)).rows as unknown as Attempt[];
 const open=attempts.find(a=>a.status==='in_progress'&&new Date(a.expires_at).getTime()>Date.now());
 const own=employee.userId===user.userId,independent=![employee.userId,row.requestedBy,row.submittedBy].includes(user.userId);
 let eligible=true;try{learningAllowed(row,employee,content);}catch{eligible=false;}
 const last=attempts[0],retryAfter=last&&last.status!=='in_progress'?new Date(new Date(last.submitted_at||last.expires_at).getTime()+content.settings.retryDelayMinutes*60000).toISOString():null;
 const currentBrand=await inductionBranding(tx),brand=internal.completion_brand||currentBrand.config;
 const assets=(await tx.execute(sql`SELECT id,mime,filename FROM learning_induction_assets WHERE course_id=${row.courseId} AND id IN (SELECT (lesson->>'assetId')::integer FROM jsonb_array_elements(${JSON.stringify(content.lessons)}::jsonb) lesson WHERE lesson->>'assetId' IS NOT NULL)`)).rows;
 return {row,employeeName:employee.firstName+' '+employee.lastName,content:publicInductionContent(content),brand,
  lessons:lessonRows.map(l=>({lessonId:l.lesson_id,openedAt:l.opened_at,completedAt:l.completed_at})),attempts:attempts.map(publicAttempt),
  activeAttempt:own&&open?{...publicAttempt(open),questions:open.questions.map(question)}:null,
  canLearn:own&&eligible,canReview:independent&&row.approverId===user.userId&&hasPermission(user.role,'training_development','approve'),
  canExempt:learningAdmin(user.role)&&employee.userId!==user.userId&&[...active,'failed','rejected'].includes(row.status),canReassign:['admin','super_admin'].includes(user.role)&&active.includes(row.status),
  required:internal.required,releaseNumber:internal.release_number,attemptsRemaining:Math.max(0,content.settings.maxAttempts-attempts.length),retryAfter,assets};
}
export async function saveInductionEnrollment(tx:WorkforceTransaction,user:TokenPayload,row:Enrollment,patch:Partial<typeof enrollments.$inferInsert>,action:string,note:string){
 const version=row.version+1;const [saved]=await tx.update(enrollments).set({...patch,version,updatedAt:new Date(),history:event(row.history,user,action,note,version,{...patch})}).where(eq(enrollments.id,row.id)).returning();
 await audit(tx,user,'learning_enrollment',row.id,action);return saved;
}
function addDays(date:string,days:number){return new Date(Date.parse(date+'T00:00:00.000Z')+days*86400000).toISOString().slice(0,10);}
function expiresAfter(date:string,months:number|null){if(!months)return null;const now=new Date(date+'T00:00:00.000Z'),target=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+months,1));target.setUTCDate(Math.min(now.getUTCDate(),new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()));return target.toISOString().slice(0,10);}
export async function completeInternalInduction(tx:WorkforceTransaction,user:TokenPayload,row:Enrollment,internal:any,verifiedBy:number|null){
 const attempt=(await tx.execute(sql`SELECT id,score,passed FROM learning_induction_attempts WHERE id=${internal.passed_attempt_id} AND enrollment_id=${row.id} AND status='submitted'`)).rows[0] as any;
 if(!attempt?.passed||attempt.score===null||attempt.score<internal.content.settings.passScore)fail(409,'A saved passing quiz attempt is required');
 const brand:InductionBrand=internal.completion_brand||(await inductionBranding(tx)).config;
 await tx.execute(sql`UPDATE learning_induction_enrollments SET completion_brand=${JSON.stringify(brand)}::jsonb WHERE enrollment_id=${row.id}`);
 return {status:'completed',progress:100,score:attempt.score,completedAt:new Date(),verifiedBy,certificateNumber:`${brand.certificatePrefix}-${row.id}-${internal.release_number}`,expiresOn:expiresAfter(businessToday(),internal.content.settings.validMonths)} satisfies Partial<typeof enrollments.$inferInsert>;
}
export async function assignInduction(tx:WorkforceTransaction,user:TokenPayload,courseId:number,input:{employeeIds:number[];releaseId:number;dueDate:string|null;required:boolean;reason:string},selfEnrollment=false,knownEmployee?:Employee){
 if(!selfEnrollment&&!knownEmployee&&!learningAdmin(user.role))fail(403,'Training administration access is required to assign courses');
 // Lock employees in deterministic order before the course, matching enrollment and lifecycle changes.
 const selected:Employee[]=[];for(const id of [...input.employeeIds].sort((a,b)=>a-b))selected.push(knownEmployee?.id===id?knownEmployee:await scopedEmployee(tx,user,id,'training_development',selfEnrollment?'read':'create',true));
 const [course]=await tx.select().from(courses).where(eq(courses.id,courseId)).for('update');
 const published=(await tx.execute(sql`SELECT c.published_release_id,r.* FROM learning_induction_courses c JOIN learning_induction_releases r ON r.id=c.published_release_id WHERE c.course_id=${courseId}`)).rows[0] as any;
 if(!course||course.definition.status!=='published'||!published||published.id!==input.releaseId)fail(409,'Choose the current published induction release');
 const content=inductionContent.parse(published.content),settings=content.settings;
 if(selfEnrollment&&!settings.allowSelfEnrollment)fail(403,'This course must be assigned by HR');
 if(input.dueDate&&input.dueDate<businessToday())fail(400,'Choose a current or future due date');
 const existing=await tx.select().from(enrollments).where(and(eq(enrollments.courseId,courseId),inArray(enrollments.employeeId,selected.map(e=>e.id))));
 const mandatory=(await tx.execute(sql`SELECT DISTINCT e.employee_id FROM learning_enrollments e JOIN learning_induction_enrollments i ON i.enrollment_id=e.id WHERE e.course_id=${courseId} AND i.required=true AND e.status<>'withdrawn'`)).rows.map(r=>Number(r.employee_id));
 const [capacity]=await tx.select({count:sql<number>`count(*)::int`}).from(enrollments).where(and(eq(enrollments.courseId,courseId),inArray(enrollments.status,active)));
 let reserved=capacity.count;const created:Enrollment[]=[],skipped:{employeeId:number;enrollmentId:number;reason:string}[]=[];
 for(const employee of selected){
  if(selfEnrollment)self(user,employee);
  if(knownEmployee){if(employee.status!=='active'||employee.terminationDate&&employee.terminationDate<=businessToday())fail(409,'An active employee is required for induction');}
  else employed(employee);
  if(!inductionAudience(employee,content))fail(409,'An employee is outside the audience for this course release');
  const current=existing.find(e=>e.employeeId===employee.id&&(active.includes(e.status)||e.status==='completed'&&(!e.expiresOn||e.expiresOn>=businessToday())));
  if(current){
   if(input.required){const changed=(await tx.execute(sql`UPDATE learning_induction_enrollments SET required=true WHERE enrollment_id=${current.id} AND required=false RETURNING enrollment_id`)).rows;if(changed.length)await saveInductionEnrollment(tx,user,current,{},'Induction required',input.reason);}
   skipped.push({employeeId:employee.id,enrollmentId:current.id,reason:'An open enrollment or valid completion already exists'});continue;
  }
  if(selfEnrollment){const prior=(await tx.execute(sql`SELECT e.id FROM learning_enrollments e JOIN learning_induction_enrollments i ON i.enrollment_id=e.id WHERE e.employee_id=${employee.id} AND i.release_id=${published.id} AND e.status='failed' LIMIT 1`)).rows[0];if(prior)fail(409,'Attempts for this course release are exhausted. Ask HR to arrange another enrollment');}
  if(course.definition.capacity!==null&&reserved>=course.definition.capacity)fail(409,'This course has no remaining active places');
  if(settings.enrollmentApprovalRequired||settings.reviewRequired){await approver(tx,course.definition.approverId,'training_development',employee);if(course.definition.approverId===user.userId)fail(409,'Choose an independent course approver before assigning this course');}
  const snapshot={...published.definition,delivery:'internal' as const,version:published.course_version,passScore:settings.passScore,validMonths:settings.validMonths,requiresEvidence:false};
  const dueDate=input.dueDate||addDays(employee.joiningDate>businessToday()?employee.joiningDate:businessToday(),settings.defaultDueDays);
  const required=input.required||mandatory.includes(employee.id);
  const [row]=await tx.insert(enrollments).values({courseId,employeeId:employee.id,courseSnapshot:snapshot,dueDate,requestedBy:user.userId,approverId:snapshot.approverId,status:settings.enrollmentApprovalRequired?'requested':'approved',history:event([],user,'Induction assigned',input.reason,1,{releaseId:published.id,releaseNumber:published.release_number,required})}).returning();
  await tx.execute(sql`INSERT INTO learning_induction_enrollments (enrollment_id,release_id,required) VALUES (${row.id},${published.id},${required})`);await audit(tx,user,'learning_enrollment',row.id,'Internal induction assigned');created.push(row);reserved++;
 }
 return {created,skipped};
}
export async function assignOnboardingInduction(tx:WorkforceTransaction,user:TokenPayload,employee:Employee){
 const releases=(await tx.execute(sql`SELECT r.id,r.course_id,r.content FROM learning_induction_courses c JOIN learning_induction_releases r ON r.id=c.published_release_id JOIN learning_courses course ON course.id=c.course_id WHERE course.definition->>'status'='published' AND r.content->'settings'->>'mandatoryForOnboarding'='true' ORDER BY r.course_id`)).rows as any[];
 const assigned=[];for(const release of releases){const content=inductionContent.parse(release.content);if(!inductionAudience(employee,content))continue;assigned.push(await assignInduction(tx,user,release.course_id,{employeeIds:[employee.id],releaseId:release.id,dueDate:null,required:true,reason:'Mandatory induction assigned by onboarding workflow'},false,employee));}return assigned;
}
export async function pendingInduction(tx:WorkforceTransaction,employeeId:number){return (await tx.execute(sql`SELECT e.id,e.course_snapshot->>'title' AS title,e.status,e.progress,e.due_date AS "dueDate" FROM learning_enrollments e JOIN learning_induction_enrollments i ON i.enrollment_id=e.id WHERE e.employee_id=${employeeId} AND i.required=true AND e.status<>'withdrawn' AND (e.status<>'completed' OR e.expires_on<${businessToday()}::date) AND NOT EXISTS(SELECT 1 FROM learning_enrollments later JOIN learning_induction_enrollments li ON li.enrollment_id=later.id WHERE later.employee_id=e.employee_id AND later.course_id=e.course_id AND li.required=true AND later.id>e.id) AND NOT EXISTS(SELECT 1 FROM learning_enrollments passed WHERE passed.employee_id=e.employee_id AND passed.course_id=e.course_id AND passed.status='completed' AND (passed.expires_on IS NULL OR passed.expires_on>=${businessToday()}::date)) ORDER BY e.id`)).rows;}
export async function expireInductionAttempts(user:TokenPayload,id:number){
 await db.transaction(async tx=>{const {row,employee,internal}=await inductionRecord(tx,user,id,true);self(user,employee);
  const expired=(await tx.execute(sql`UPDATE learning_induction_attempts SET status='expired',submitted_at=expires_at,score=0,earned_points=0,passed=false WHERE enrollment_id=${id} AND status='in_progress' AND expires_at<=now() RETURNING id`)).rows;
  if(!expired.length)return;
  const count=Number((await tx.execute(sql`SELECT count(*) AS n FROM learning_induction_attempts WHERE enrollment_id=${id}`)).rows[0].n);
  if(['approved','in_progress'].includes(row.status))await saveInductionEnrollment(tx,user,row,{status:count>=internal.content.settings.maxAttempts?'failed':'in_progress'},'Quiz timed out','The server closed the timed quiz attempt');
 });
}
async function completedLessons(tx:WorkforceTransaction,id:number){return (await tx.execute(sql`SELECT lesson_id FROM learning_induction_lesson_progress WHERE enrollment_id=${id} AND completed_at IS NOT NULL`)).rows.map(r=>String(r.lesson_id));}
export async function openInductionLesson(tx:WorkforceTransaction,user:TokenPayload,id:number,lessonId:string,expected?:number){
 const record=await inductionRecord(tx,user,id,true);self(user,record.employee);learningAllowed(record.row,record.employee,record.internal.content);
 if(expected!==undefined)versionCheck(record.row.version,expected);
 const content:InductionContent=record.internal.content,index=content.lessons.findIndex(l=>l.id===lessonId);if(index<0)fail(404,'Lesson not found in this enrollment release');
 const complete=await completedLessons(tx,id);if(content.settings.sequentialLessons&&content.lessons.slice(0,index).some(l=>l.required&&!complete.includes(l.id)))fail(409,'Complete the preceding required lessons first');
 await tx.execute(sql`INSERT INTO learning_induction_lesson_progress (enrollment_id,lesson_id) VALUES (${id},${lessonId}::uuid) ON CONFLICT (enrollment_id,lesson_id) DO NOTHING`);
 return record;
}
export async function completeInductionLesson(tx:WorkforceTransaction,user:TokenPayload,id:number,lessonId:string,version:number){
 const {row,internal}=await openInductionLesson(tx,user,id,lessonId,version);
 const updated=(await tx.execute(sql`UPDATE learning_induction_lesson_progress SET completed_at=now(),completed_by=${user.userId} WHERE enrollment_id=${id} AND lesson_id=${lessonId}::uuid AND completed_at IS NULL RETURNING lesson_id`)).rows;
 if(updated.length){const completed=await completedLessons(tx,id),required=internal.content.lessons.filter((l:any)=>l.required),progress=Math.floor(required.filter((l:any)=>completed.includes(l.id)).length/required.length*90);await saveInductionEnrollment(tx,user,row,{progress,status:'in_progress'},'Lesson completed','The employee confirmed completion of a course lesson');}
 return inductionDetail(tx,user,id);
}
function shuffled<T>(input:T[]){const items=[...input];for(let n=items.length-1;n>0;n--){const i=randomInt(n+1);[items[n],items[i]]=[items[i],items[n]];}return items;}
export async function startInductionAttempt(tx:WorkforceTransaction,user:TokenPayload,id:number,input:{version:number;key:string}){
 const {row,employee,internal}=await inductionRecord(tx,user,id,true);self(user,employee);
 const prior=(await tx.execute(sql`SELECT * FROM learning_induction_attempts WHERE enrollment_id=${id} AND start_key=${input.key}::uuid`)).rows[0];if(prior)return inductionDetail(tx,user,id);
 versionCheck(row.version,input.version);learningAllowed(row,employee,internal.content);
 if(internal.passed_attempt_id&&internal.content.settings.reviewRequired)fail(409,'Resubmit your saved passing completion for review instead of starting another quiz');
 const content:InductionContent=internal.content,completed=await completedLessons(tx,id);if(content.lessons.some(l=>l.required&&!completed.includes(l.id)))fail(409,'Complete every required lesson before starting the quiz');
 const attempts=(await tx.execute(sql`SELECT * FROM learning_induction_attempts WHERE enrollment_id=${id} ORDER BY attempt_number DESC`)).rows as unknown as Attempt[];
 if(attempts.some(a=>a.status==='in_progress'))return inductionDetail(tx,user,id);
 if(attempts.length>=content.settings.maxAttempts)fail(409,'The maximum number of quiz attempts has been reached');
 if(attempts[0]&&Date.now()<new Date(attempts[0].submitted_at||attempts[0].expires_at).getTime()+content.settings.retryDelayMinutes*60000)fail(409,'The course retry waiting period has not finished');
 let questions=content.settings.shuffleQuestions?shuffled(content.questions):[...content.questions];questions=questions.slice(0,content.settings.questionCount||questions.length).map(q=>({...q,options:content.settings.shuffleOptions?shuffled(q.options):q.options}));
 const total=questions.reduce((n,q)=>n+q.points,0),expiresAt=new Date(Date.now()+content.settings.attemptMinutes*60000);
 await tx.execute(sql`INSERT INTO learning_induction_attempts (enrollment_id,attempt_number,start_key,questions,expires_at,created_by,total_points) VALUES (${id},${attempts.length+1},${input.key}::uuid,${JSON.stringify(questions)}::jsonb,${expiresAt},${user.userId},${total})`);
 await saveInductionEnrollment(tx,user,row,{status:'in_progress'},'Quiz started','The employee started a timed quiz attempt');return inductionDetail(tx,user,id);
}
export async function submitInductionAttempt(tx:WorkforceTransaction,user:TokenPayload,id:number,attemptId:number,answers:{questionId:string;optionIds:string[]}[]){
 const {row,employee,internal}=await inductionRecord(tx,user,id,true);self(user,employee);
 const attempt=(await tx.execute(sql`SELECT * FROM learning_induction_attempts WHERE id=${attemptId} AND enrollment_id=${id} FOR UPDATE`)).rows[0] as unknown as Attempt;
 if(!attempt||attempt.created_by!==user.userId)fail(404,'Quiz attempt not found');
 if(attempt.status==='submitted')return {...await inductionDetail(tx,user,id),result:{score:attempt.score,passed:attempt.passed,earnedPoints:attempt.earned_points,totalPoints:attempt.total_points}};
 if(attempt.status!=='in_progress')fail(409,'This quiz attempt has expired. Refresh to continue');
 if(new Date(attempt.expires_at).getTime()<=Date.now()){
  // Return an error value so expiry is committed even at the boundary between the preflight and submission.
  await tx.execute(sql`UPDATE learning_induction_attempts SET status='expired',submitted_at=expires_at,score=0,earned_points=0,passed=false WHERE id=${attempt.id}`);
  if(['approved','in_progress'].includes(row.status))await saveInductionEnrollment(tx,user,row,{status:attempt.attempt_number>=internal.content.settings.maxAttempts?'failed':'in_progress'},'Quiz timed out','The server closed the timed quiz attempt');
  return {error:{status:409,message:'This quiz attempt has expired. Refresh to continue'}};
 }
 learningAllowed(row,employee,internal.content);
 if(new Set(answers.map(a=>a.questionId)).size!==answers.length||answers.length!==attempt.questions.length)fail(400,'Answer every quiz question exactly once');
 let earned=0,total=0;for(const q of attempt.questions){const answer=answers.find(a=>a.questionId===q.id);if(!answer||new Set(answer.optionIds).size!==answer.optionIds.length||answer.optionIds.some(id=>!q.options.some(o=>o.id===id))||(q.kind!=='multiple'&&answer.optionIds.length!==1))fail(400,'Choose valid answers for every quiz question');total+=q.points;if(answer.optionIds.length===q.correctOptionIds.length&&answer.optionIds.every(id=>q.correctOptionIds.includes(id)))earned+=q.points;}
 const score=Math.round(earned/total*100),passed=score>=internal.content.settings.passScore;
 await tx.execute(sql`UPDATE learning_induction_attempts SET status='submitted',answers=${JSON.stringify(answers)}::jsonb,submitted_at=now(),score=${score},earned_points=${earned},total_points=${total},passed=${passed} WHERE id=${attempt.id}`);
 let patch:Partial<typeof enrollments.$inferInsert>={score,status:attempt.attempt_number>=internal.content.settings.maxAttempts?'failed':'in_progress'};
 if(passed){await tx.execute(sql`UPDATE learning_induction_enrollments SET passed_attempt_id=${attempt.id} WHERE enrollment_id=${id}`);internal.passed_attempt_id=attempt.id;
  patch=internal.content.settings.reviewRequired?{score,status:'completion_submitted',progress:100,submittedBy:user.userId,completionNote:'Required lessons and server-scored induction quiz completed'}:await completeInternalInduction(tx,user,row,internal,null);
 }
 await saveInductionEnrollment(tx,user,row,patch,passed?'Quiz passed':'Quiz submitted',passed?'The employee achieved the course passing score':'The server recorded the quiz score');
 return {...await inductionDetail(tx,user,id),result:{score,passed,earnedPoints:earned,totalPoints:total}};
}
