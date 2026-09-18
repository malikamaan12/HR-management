import {Router} from 'express';
import {z} from 'zod';
import {and,eq,sql} from 'drizzle-orm';
import {employees} from '@shared/schema';
import {inductionAssignment,inductionAttemptStart,inductionAttemptSubmit} from '@shared/induction';
import {learningAdmin} from '@shared/employee-services';
import {positiveId,reason} from '@shared/hr-rules';
import {hasPermission} from '@shared/permissions';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {businessToday} from '../services/hr-rules';
import {employed,versionCheck} from '../services/employee-services';
import {fail} from '../services/workforce';
import {handle} from './hr-rules';
import type {TokenPayload} from '../services/auth';
import {assignInduction,inductionRecord,inductionDetail,openInductionLesson,completeInductionLesson,startInductionAttempt,submitInductionAttempt,expireInductionAttempts,saveInductionEnrollment,inductionAudience} from '../services/induction-learning';

const router=Router();
router.use(authenticate);router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!hasPermission(req.user!.role,'training_development','read'))return res.status(403).json({message:'Learning access is required'});next();});
router.post('/courses/:id/assign',handle(async(req,res)=>{const input=inductionAssignment.parse(req.body);res.status(201).json(await db.transaction(tx=>assignInduction(tx,req.user!,positiveId.parse(req.params.id),input)));}));
router.post('/courses/:id/enroll',handle(async(req,res)=>{
 const input=z.object({releaseId:positiveId,reason}).strict().parse(req.body);
 const [employee]=await db.select({id:employees.id}).from(employees).where(eq(employees.userId,req.user!.userId));if(!employee)fail(409,'Link an employee record to your account before enrolling');
 res.status(201).json(await db.transaction(tx=>assignInduction(tx,req.user!,positiveId.parse(req.params.id),{...input,employeeIds:[employee.id],dueDate:null,required:false},true)));
}));
const filters=z.object({q:z.string().max(100).default(''),status:z.enum(['','requested','approved','in_progress','completion_submitted','completed','failed','rejected','withdrawn']).default(''),courseId:positiveId.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),mine:z.enum(['true','false']).optional()});
for(const path of ['/records','/reports'])router.get(path,handle(async(req,res)=>{
 const input=filters.parse(req.query),term='%'+input.q.replace(/[\\%_]/g,'\\$&')+'%',today=businessToday();
 const predicate=and(employeeScope(req.user!,'training_development'),input.mine==='true'?eq(employees.userId,req.user!.userId):undefined,input.status?sql`e.status=${input.status}`:undefined,input.courseId?sql`e.course_id=${input.courseId}`:undefined,sql`(${employees.firstName}||' '||${employees.lastName} ILIKE ${term} OR ${employees.employeeId} ILIKE ${term} OR e.course_snapshot->>'title' ILIKE ${term})`);
 const from=sql`FROM learning_enrollments e JOIN learning_induction_enrollments i ON i.enrollment_id=e.id JOIN learning_induction_releases r ON r.id=i.release_id JOIN ${employees} ON ${employees.id}=e.employee_id WHERE ${predicate}`;
 const items=(await db.execute(sql`SELECT e.id,e.employee_id AS "employeeId",${employees.firstName}||' '||${employees.lastName} AS "employeeName",${employees.employeeId} AS "employeeCode",e.course_id AS "courseId",e.course_snapshot->>'title' AS title,e.status,e.progress,e.score,e.due_date AS "dueDate",e.expires_on AS "expiresOn",e.completed_at AS "completedAt",e.certificate_number AS "certificateNumber",i.required,r.release_number AS "releaseNumber",(SELECT count(*)::int FROM learning_induction_attempts a WHERE a.enrollment_id=e.id) AS "attemptCount",(${employees.userId}=${req.user!.userId}) AS own ${from} ORDER BY e.id DESC LIMIT 25 OFFSET ${input.offset}`)).rows;
 const totals=(await db.execute(sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE e.status NOT IN ('withdrawn','rejected'))::int AS assigned,count(*) FILTER(WHERE e.status='completed')::int AS completed,count(*) FILTER(WHERE e.status IN ('approved','in_progress','completion_submitted','requested'))::int AS "inProgress",count(*) FILTER(WHERE e.status='failed')::int AS failed,count(*) FILTER(WHERE e.status NOT IN ('completed','withdrawn','rejected') AND e.due_date<${today}::date)::int AS overdue,round(avg(e.score))::int AS "averageScore" ${from}`)).rows[0] as any;
 const {total,...stats}=totals;res.json({items,total,stats});
}));
async function expireOwn(user:TokenPayload,id:number){const record=await db.transaction(tx=>inductionRecord(tx,user,id));if(record.employee.userId===user.userId)await expireInductionAttempts(user,id);}
router.get('/enrollments/:id',handle(async(req,res)=>{const id=positiveId.parse(req.params.id);await expireOwn(req.user!,id);res.json(await db.transaction(tx=>inductionDetail(tx,req.user!,id)));}));
router.post('/enrollments/:id/lessons/:lessonId/open',handle(async(req,res)=>{z.object({}).strict().parse(req.body);const id=positiveId.parse(req.params.id),lessonId=z.string().uuid().parse(req.params.lessonId);res.json(await db.transaction(async tx=>{await openInductionLesson(tx,req.user!,id,lessonId);return inductionDetail(tx,req.user!,id);}));}));
router.post('/enrollments/:id/lessons/:lessonId/complete',handle(async(req,res)=>{const input=z.object({version:positiveId,confirmed:z.literal(true)}).strict().parse(req.body);res.json(await db.transaction(tx=>completeInductionLesson(tx,req.user!,positiveId.parse(req.params.id),z.string().uuid().parse(req.params.lessonId),input.version)));}));
router.post('/enrollments/:id/attempts/start',handle(async(req,res)=>{const input=inductionAttemptStart.parse(req.body),id=positiveId.parse(req.params.id);await expireInductionAttempts(req.user!,id);res.status(201).json(await db.transaction(tx=>startInductionAttempt(tx,req.user!,id,input)));}));
router.post('/enrollments/:id/attempts/:attemptId/submit',handle(async(req,res)=>{const input=inductionAttemptSubmit.parse(req.body),id=positiveId.parse(req.params.id);await expireInductionAttempts(req.user!,id);const result=await db.transaction(tx=>submitInductionAttempt(tx,req.user!,id,positiveId.parse(req.params.attemptId),input.answers));if('error' in result&&result.error)fail(result.error.status,result.error.message);res.json(result);}));
router.post('/enrollments/:id/exempt',handle(async(req,res)=>{
 const input=z.object({version:positiveId,reason}).strict().parse(req.body),id=positiveId.parse(req.params.id);res.json(await db.transaction(async tx=>{
  const {row,employee}=await inductionRecord(tx,req.user!,id,true);versionCheck(row.version,input.version);
  if(!learningAdmin(req.user!.role)||employee.userId===req.user!.userId)fail(403,'An independent HR administrator must grant an induction exemption');
  if(!['requested','approved','in_progress','completion_submitted','failed','rejected'].includes(row.status))fail(409,'This enrollment is already closed');
  await tx.execute(sql`UPDATE learning_induction_attempts SET status='expired',submitted_at=now(),score=0,earned_points=0,passed=false WHERE enrollment_id=${id} AND status='in_progress'`);
  await saveInductionEnrollment(tx,req.user!,row,{status:'withdrawn'},'Induction exemption',input.reason);return inductionDetail(tx,req.user!,id);
 }));
}));
router.post('/enrollments/:id/resubmit',handle(async(req,res)=>{
 const input=z.object({version:positiveId,reason}).strict().parse(req.body),id=positiveId.parse(req.params.id);res.json(await db.transaction(async tx=>{
  const {row,employee,internal}=await inductionRecord(tx,req.user!,id,true);versionCheck(row.version,input.version);
  if(employee.userId!==req.user!.userId)fail(403,'Only the assigned employee can resubmit completion');employed(employee);
  if(row.status!=='in_progress'||!internal.content.settings.reviewRequired||!internal.passed_attempt_id||!inductionAudience(employee,internal.content))fail(409,'This enrollment has no returned passing completion to submit');
  const passing=(await tx.execute(sql`SELECT id FROM learning_induction_attempts WHERE id=${internal.passed_attempt_id} AND enrollment_id=${id} AND passed=true AND status='submitted'`)).rows[0];if(!passing)fail(409,'A saved passing attempt is required');
  await saveInductionEnrollment(tx,req.user!,row,{status:'completion_submitted',progress:100,submittedBy:req.user!.userId,completionNote:input.reason},'Completion resubmitted',input.reason);return inductionDetail(tx,req.user!,id);
 }));
}));
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
router.get('/enrollments/:id/certificate',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),detail=await db.transaction(tx=>inductionDetail(tx,req.user!,id));if(detail.row.status!=='completed'||!detail.row.certificateNumber)fail(409,'Complete the induction before downloading its certificate');
 const brand=detail.brand,date=detail.row.completedAt?new Date(detail.row.completedAt).toISOString().slice(0,10):'',logo=brand.logoAssetId?`<img class="logo" src="/api/learning/induction/assets/${brand.logoAssetId}/download?enrollmentId=${id}" alt="${escape(brand.organizationName)}">`:'';
 res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");res.set('X-Content-Type-Options','nosniff');res.set('Content-Disposition',`inline; filename="induction-certificate-${id}.html"`);
 res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(brand.certificateTitle)}</title><style>body{font-family:Arial,sans-serif;color:#172033;background:#f7f8fa;margin:0;padding:32px}.certificate{max-width:960px;margin:auto;background:#fff;padding:64px;border:8px double ${escape(brand.accentColor)};text-align:center}.logo{max-width:180px;max-height:80px}h1{font-size:36px;color:${escape(brand.accentColor)}}h2{font-size:30px;margin:32px 0}p{line-height:1.6}.small{font-size:13px;color:#596273}.footer{margin-top:52px} @media print{body{padding:0;background:white}.certificate{page-break-inside:avoid;margin:0;padding:45px} @page{size:A4 landscape;margin:15mm}}</style></head><body><main class="certificate">${logo}<p>${escape(brand.organizationName)} · ${escape(brand.academyTitle)}</p><h1>${escape(brand.certificateTitle)}</h1><p>This confirms that</p><h2>${escape(detail.employeeName)}</h2><p>completed <strong>${escape(detail.row.courseSnapshot.title)}</strong><br>Course release ${detail.releaseNumber} · Quiz score ${detail.row.score}%</p><p>Completed ${escape(date)}${detail.row.expiresOn?` · Valid until ${escape(detail.row.expiresOn)}`:''}</p><div class="footer"><p>${escape(brand.signatoryTitle)}</p><p class="small">Certificate ${escape(detail.row.certificateNumber)}<br>Issued from the internal employee training record.</p></div></main></body></html>`);
}));
export default router;
