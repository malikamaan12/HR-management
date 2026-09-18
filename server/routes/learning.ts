import {Router} from 'express';
import {z} from 'zod';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {db} from '../db';
import {learningCourses as courses,learningEnrollments as enrollments,employees,users} from '@shared/schema';
import {courseDefinition,enrollmentInput,learningAdmin,policyAdmin,versionInput} from '@shared/employee-services';
import {positiveId,reason} from '@shared/hr-rules';
import {hasPermission} from '@shared/permissions';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {scopedEmployee,audit,businessToday} from '../services/hr-rules';
import {approver,directory,employed,enrollmentRecord,event,fileMetadata,requireWriter,versionCheck} from '../services/employee-services';
import {privateStorageConfigured} from '../services/r2';
import {fail} from '../services/workforce';
import {handle} from './hr-rules';
import {serviceFileRoutes} from './service-files';
import inductionRouter from './induction';
import {internalCourse,internalEnrollment,completeInternalInduction,inductionAudience} from '../services/induction-learning';
const router=Router(),active=['requested','approved','in_progress','completion_submitted'];
router.use(authenticate);router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!hasPermission(req.user!.role,'training_development','read'))return res.status(403).json({message:'Learning access is required'});next();});
router.use('/induction',inductionRouter);
router.get('/directory',handle(async(req,res)=>res.json(await db.transaction(async tx=>({employees:await directory(tx,req.user!,'training_development',z.string().max(100).parse(req.query.q||'')),approvers:learningAdmin(req.user!.role)?(await tx.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,role:users.role}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved')))).filter(u=>hasPermission(u.role,'training_development','approve')):[]})))));
router.get('/courses',handle(async(req,res)=>{
  const admin=learningAdmin(req.user!.role),page=z.coerce.number().int().min(1).default(1).parse(req.query.page),q=z.string().max(100).parse(req.query.q||''),term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const where=and(admin?undefined:sql`${courses.definition}->>'status'='published'`,sql`${courses.definition}->>'title' ILIKE ${term}`);
  const items=await db.select().from(courses).where(where).orderBy(desc(courses.id)).limit(20).offset((page-1)*20),[total]=await db.select({count:sql<number>`count(*)::int`}).from(courses).where(where);
  res.json({items:items.map(c=>admin?c:{...c,history:[]}),total:total.count,canManage:admin,canOverride:policyAdmin(req.user!.role)});
}));
router.post('/courses',handle(async(req,res)=>{
  if(!learningAdmin(req.user!.role))fail(403,'Training administration access required');const definition=courseDefinition.parse(req.body);if(definition.delivery==='internal')fail(400,'Create internal courses in the induction course builder');
  res.status(201).json(await db.transaction(async tx=>{await approver(tx,definition.approverId,'training_development');const [row]=await tx.insert(courses).values({definition,createdBy:req.user!.userId,history:event([],req.user!,'Created','Course created',1,definition)}).returning();await audit(tx,req.user!,'learning_course',row.id,'Created course');return row;}));
}));
router.patch('/courses/:id',handle(async(req,res)=>{
  if(!learningAdmin(req.user!.role))fail(403,'Training administration access required');const input=z.object({version:versionInput,definition:courseDefinition,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const [row]=await tx.select().from(courses).where(eq(courses.id,positiveId.parse(req.params.id))).for('update');if(!row)fail(404,'Course not found');if(input.definition.delivery==='internal'||await internalCourse(tx,row.id))fail(409,'Revise internal courses in the induction course builder');versionCheck(row.version,input.version);await approver(tx,input.definition.approverId,'training_development');const [count]=await tx.select({count:sql<number>`count(*)::int`}).from(enrollments).where(and(eq(enrollments.courseId,row.id),inArray(enrollments.status,active)));if(input.definition.capacity!==null&&count.count>input.definition.capacity)fail(409,'Capacity cannot be lower than active enrollments');const [saved]=await tx.update(courses).set({definition:input.definition,version:row.version+1,updatedAt:new Date(),history:event(row.history,req.user!,'Revised',input.reason,row.version+1,input.definition)}).where(eq(courses.id,row.id)).returning();await audit(tx,req.user!,'learning_course',row.id,'Course revised');return saved;}));
}));
router.get('/enrollments',handle(async(req,res)=>{
  const page=z.coerce.number().int().min(1).default(1).parse(req.query.page),status=z.string().max(30).parse(req.query.status||'');
  const where=and(employeeScope(req.user!,'training_development'),status?eq(enrollments.status,status):undefined);
  const items=await db.select({id:enrollments.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,title:sql<string>`${enrollments.courseSnapshot}->>'title'`,status:enrollments.status,progress:enrollments.progress,dueDate:enrollments.dueDate,expiresOn:enrollments.expiresOn}).from(enrollments).innerJoin(employees,eq(enrollments.employeeId,employees.id)).where(where).orderBy(desc(enrollments.id)).limit(25).offset((page-1)*25);
  const [total]=await db.select({count:sql<number>`count(*)::int`}).from(enrollments).innerJoin(employees,eq(enrollments.employeeId,employees.id)).where(where);res.json({items,total:total.count});
}));
router.post('/enrollments',handle(async(req,res)=>{
  const input=enrollmentInput.parse(req.body);if(input.override&&!policyAdmin(req.user!.role))fail(403,'Only administrators can set employee-specific completion rules');
  res.status(201).json(await db.transaction(async tx=>{
    const e=await scopedEmployee(tx,req.user!,input.employeeId,'training_development','read',true);requireWriter(req.user!,e,'training_development');employed(e);
    const [course]=await tx.select().from(courses).where(eq(courses.id,input.courseId)).for('update');if(!course||course.definition.status!=='published')fail(409,'Choose a published course');
    if(await internalCourse(tx,course.id))fail(409,'Use the induction academy to assign or enroll in this internal course');
    if(input.dueDate&&input.dueDate<businessToday())fail(400,'Choose a current or future due date');
    await approver(tx,course.definition.approverId,'training_development',e);if(course.definition.approverId===req.user!.userId)fail(409,'A different preparer must request enrollment for this course');
    const current=await tx.select({employeeId:enrollments.employeeId}).from(enrollments).where(and(eq(enrollments.courseId,course.id),inArray(enrollments.status,active)));
    if(current.some(x=>x.employeeId===e.id))fail(409,'An active enrollment already exists');if(course.definition.capacity!==null&&current.length>=course.definition.capacity)fail(409,'This course has no remaining active places');
    const snapshot={...course.definition,...(input.override?{passScore:input.override.passScore,requiresEvidence:input.override.requiresEvidence,validMonths:input.override.validMonths,override:input.override}:{}),version:course.version};
    const [row]=await tx.insert(enrollments).values({courseId:course.id,employeeId:e.id,courseSnapshot:snapshot,dueDate:input.dueDate,requestedBy:req.user!.userId,approverId:snapshot.approverId,history:event([],req.user!,'Enrollment requested',input.reason,1,snapshot)}).returning();await audit(tx,req.user!,'learning_enrollment',row.id,'Enrollment requested');return row;
  }));
}));
router.get('/enrollments/:id',handle(async(req,res)=>res.json(await db.transaction(async tx=>{const {row,employee}=await enrollmentRecord(tx,req.user!,positiveId.parse(req.params.id));return {row,employeeName:employee.firstName+' '+employee.lastName,files:await fileMetadata(tx,'learning',row.id),canPrepare:employee.userId===req.user!.userId||row.requestedBy===req.user!.userId&&hasPermission(req.user!.role,'training_development','create'),canReview:row.approverId===req.user!.userId&&employee.userId!==req.user!.userId&&row.requestedBy!==req.user!.userId&&hasPermission(req.user!.role,'training_development','approve'),canReassign:policyAdmin(req.user!.role),storage:privateStorageConfigured()};}))));
router.post('/enrollments/:id/actions',handle(async(req,res)=>{
  const input=z.object({version:versionInput,action:z.enum(['approve','reject','withdraw','progress','submit_completion','return','verify','reassign']),reason,progress:z.number().int().min(0).max(99).optional(),score:z.number().int().min(0).max(100).optional(),approverId:positiveId.optional()}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const {row,employee}=await enrollmentRecord(tx,req.user!,positiveId.parse(req.params.id),true);versionCheck(row.version,input.version);
    const internal=await internalEnrollment(tx,row.id);
    if(internal&&['progress','submit_completion','withdraw'].includes(input.action))fail(409,input.action==='withdraw'?'An independent HR administrator must record an induction exemption':'Complete the lessons and quiz in the internal induction academy');
    const prepare=employee.userId===req.user!.userId||row.requestedBy===req.user!.userId&&hasPermission(req.user!.role,'training_development','create');
    const patch:Partial<typeof enrollments.$inferInsert>={};
    if(input.action==='reassign'){
      if(!policyAdmin(req.user!.role))fail(403,'Administrator access required');if(!active.includes(row.status))fail(409,'Only active enrollments can be reassigned');if(!input.approverId)fail(400,'Select an approver');await approver(tx,input.approverId,'training_development',employee);if([row.requestedBy,row.submittedBy].includes(input.approverId))fail(400,'Choose an independent reviewer');patch.approverId=input.approverId;
    }else if(['progress','submit_completion','withdraw'].includes(input.action)){
      if(!prepare)fail(403,'Only the employee or original preparer can perform this action');
      if(input.action==='withdraw'){if(!active.includes(row.status))fail(409,'This enrollment is already closed');patch.status='withdrawn';}
      else {employed(employee);if(!['approved','in_progress'].includes(row.status))fail(409,'Enrollment must be approved before recording progress');
        if(input.action==='progress'){if(input.progress===undefined)fail(400,'Enter progress');patch.progress=input.progress;patch.status='in_progress';}
        else {if(row.courseSnapshot.requiresEvidence&&!(await fileMetadata(tx,'learning',row.id)).length)fail(409,'Attach completion evidence first');patch.status='completion_submitted';patch.progress=100;patch.completionNote=input.reason;patch.submittedBy=req.user!.userId;}
      }
    }else {
      if(row.approverId!==req.user!.userId||[employee.userId,row.requestedBy,row.submittedBy].includes(req.user!.userId))fail(403,'The independent assigned reviewer must decide');await approver(tx,req.user!.userId,'training_development',employee);
      if(input.action==='approve'||input.action==='reject'){if(row.status!=='requested')fail(409,'This enrollment has already been decided');if(input.action==='approve'){employed(employee);if(internal&&!inductionAudience(employee,internal.content))fail(409,'This employee is outside the audience for the assigned course release');}patch.status=input.action==='approve'?'approved':'rejected';}
      else {if(row.status!=='completion_submitted')fail(409,'Completion evidence must be submitted first');
        if(input.action==='return'){patch.status='in_progress';patch.progress=internal?90:99;patch.submittedBy=null;}
        else if(internal){employed(employee);Object.assign(patch,await completeInternalInduction(tx,req.user!,row,internal,req.user!.userId));}
        else {if(input.score===undefined)fail(400,'Record the verified score');patch.score=input.score;patch.verifiedBy=req.user!.userId;patch.status=input.score>=row.courseSnapshot.passScore?'completed':'failed';if(patch.status==='completed'){const now=new Date();patch.completedAt=now;patch.certificateNumber=`E3-LRN-${row.id}`;if(row.courseSnapshot.validMonths){const target=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+row.courseSnapshot.validMonths,1));const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(now.getUTCDate(),last));patch.expiresOn=target.toISOString().slice(0,10);}}}
      }
    }
    patch.version=row.version+1;patch.updatedAt=new Date();patch.history=event(row.history,req.user!,input.action,input.reason,patch.version,{...patch,history:undefined});const [saved]=await tx.update(enrollments).set(patch).where(eq(enrollments.id,row.id)).returning();await audit(tx,req.user!,'learning_enrollment',row.id,input.action);return saved;
  }));
}));
router.use('/enrollments',serviceFileRoutes('learning'));
export default router;
