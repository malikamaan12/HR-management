import {Router} from 'express';
import {z} from 'zod';
import {and,eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,activityLogs,trainingCourses,documents} from '@shared/schema';
import {hasPermission,getAccessScope,type HRModule,type Permission} from '@shared/permissions';
import {employeeScope} from '../services/access';
import {authenticate} from '../middleware/auth';
import {civilDate} from '@shared/calculation-rules';
import {OnboardingError} from '../services/onboarding-workflow';
const router=Router(); router.use(authenticate); router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const id=z.number().int().positive(), reason=z.string().trim().min(5).max(2000), text=z.string().trim().min(2).max(200);
const page=z.coerce.number().int().min(1).max(10000).default(1);
const admin=(req:any)=>['admin','super_admin'].includes(req.user.role);
function requirePermission(req:any,module:HRModule,permission:Permission='read',all=false){if(!hasPermission(req.user.role,module,permission)||(all&&getAccessScope(req.user.role,module)!=='all'))throw new OnboardingError(403,'You do not have access to this action');}
async function employee(tx:any,req:any,employeeId:number,module:HRModule,permission:Permission='read'){
 const [row]=await tx.select().from(employees).where(and(eq(employees.id,employeeId),employeeScope(req.user,module,permission))).for('share');
 if(!row)throw new OnboardingError(404,'Employee not found within your scope');return row;
}
async function history(tx:any,req:any,kind:string,row:any,why:string){
 await tx.execute(sql`INSERT INTO lifecycle_history(kind,record_id,version,snapshot,actor_id,reason) VALUES (${kind},${row.id},${row.version},${JSON.stringify(row)}::jsonb,${req.user.userId},${why})`);
 await tx.insert(activityLogs).values({userId:req.user.userId,action:'update',entityType:'lifecycle_'+kind,entityId:row.id,details:'Saved version '+row.version});
}
function endpoint(fn:(req:any,res:any)=>Promise<any>){return async(req:any,res:any)=>{try{await fn(req,res);}catch(e:any){const code=e.code||e.cause?.code;res.status(e instanceof OnboardingError?e.status:e instanceof z.ZodError?400:code==='23505'?409:500).json({message:e instanceof OnboardingError?e.message:e instanceof z.ZodError?e.issues.map((i:any)=>i.message).join('; '):code==='23505'?'This record already exists':'Unable to complete workflow'});}};}
const rubric=z.array(z.object({title:text,weight:z.number().int().min(1).max(100)}).strict()).min(1).max(20).refine(rows=>rows.reduce((n,r)=>n+r.weight,0)===100,'Rubric weights must total 100');
router.get('/people',endpoint(async(req,res)=>{
 const module=z.enum(['performance_management','training_development']).parse(req.query.module),q=z.string().trim().min(2).max(100).parse(req.query.q);requirePermission(req,module);
 const rows=await db.execute(sql`SELECT employees.id,employees.first_name || ' ' || employees.last_name AS name,employees.employee_id FROM employees WHERE ${employeeScope(req.user,module)} AND employees.status='active' AND strpos(lower(employees.first_name || ' ' || employees.last_name || ' ' || employees.employee_id),lower(${q}))>0 ORDER BY employees.id LIMIT 25`);res.json(rows.rows);
}));
router.get('/onboardings',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','read',true);const r=await db.execute(sql`SELECT o.id,employees.first_name || ' ' || employees.last_name AS name FROM employee_onboarding o JOIN employees ON employees.id=o.employee_id WHERE o.status='in_progress' AND ${employeeScope(req.user,'compliance_documents')} ORDER BY o.id DESC LIMIT 100`);res.json(r.rows);
}));
router.get('/document-checks/:id/options',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','read',true);const recordId=id.parse(Number(req.params.id));const r=await db.execute(sql`SELECT d.id,d.document_type,d.issue_date,d.expiry_date FROM onboarding_document_checks c JOIN employee_onboarding o ON o.id=c.onboarding_id JOIN employees ON employees.id=o.employee_id JOIN documents d ON d.employee_id=employees.id AND d.document_type=c.document_type WHERE c.id=${recordId} AND ${employeeScope(req.user,'compliance_documents')} AND d.document_file IS NOT NULL AND d.expiry_date>=CURRENT_DATE AND d.issue_date<=CURRENT_DATE ORDER BY d.id DESC LIMIT 100`);res.json(r.rows);
}));
router.get('/cycles',endpoint(async(req,res)=>{
 requirePermission(req,'performance_management');const p=page.parse(req.query.page);
 const rows=await db.execute(sql`SELECT c.* FROM review_cycles c WHERE ${admin(req)} OR EXISTS (SELECT 1 FROM cycle_assessments a JOIN employees ON employees.id=a.employee_id WHERE a.cycle_id=c.id AND ${employeeScope(req.user,'performance_management')}) ORDER BY c.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);
 res.json({items:rows.rows,canCreate:admin(req)});
}));
router.post('/cycles',endpoint(async(req,res)=>{
 if(!admin(req))throw new OnboardingError(403,'An Admin or Super Admin configures review cycles');
 const input=z.object({title:text,startDate:civilDate,endDate:civilDate,dueDate:civilDate,rubric,ratingMax:z.union([z.literal(5),z.literal(10)]).default(5),scoreDecimals:z.number().int().min(0).max(2).default(2),reason}).strict().parse(req.body);
 if(input.endDate<input.startDate||input.dueDate<input.endDate)throw new OnboardingError(400,'Check cycle period and due date');
 const saved=await db.transaction(async tx=>{const r=await tx.execute(sql`INSERT INTO review_cycles(title,start_date,end_date,due_date,rubric,rating_max,score_decimals,created_by) VALUES (${input.title},${input.startDate},${input.endDate},${input.dueDate},${JSON.stringify(input.rubric)}::jsonb,${input.ratingMax},${input.scoreDecimals},${req.user.userId}) RETURNING *`);await history(tx,req,'cycle',r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.post('/cycles/:id/close',endpoint(async(req,res)=>{
 if(!admin(req))throw new OnboardingError(403,'An administrator closes review cycles');const cycleId=id.parse(Number(req.params.id)),input=z.object({version:id,reason}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{const rows=await tx.execute(sql`SELECT * FROM review_cycles WHERE id=${cycleId} FOR UPDATE`),row=rows.rows[0];if(!row)throw new OnboardingError(404,'Cycle not found');if(row.version!==input.version||row.status!=='open')throw new OnboardingError(409,'Cycle changed; reload');
 const pending=await tx.execute(sql`SELECT id FROM cycle_assessments WHERE cycle_id=${cycleId} AND status<>'published' LIMIT 1`);if(pending.rows.length)throw new OnboardingError(409,'Publish all assigned reviews first');
 const r=await tx.execute(sql`UPDATE review_cycles SET status='closed',version=version+1 WHERE id=${cycleId} RETURNING *`);await history(tx,req,'cycle',r.rows[0],input.reason);return r.rows[0];});res.json(result);
}));
router.get('/assessments',endpoint(async(req,res)=>{
 requirePermission(req,'performance_management');const p=page.parse(req.query.page);
 const rows=await db.execute(sql`SELECT a.*,c.title AS cycle_title,c.rubric,c.rating_max,c.score_decimals,c.status AS cycle_status,employees.first_name || ' ' || employees.last_name AS employee_name,employees.user_id AS subject_user_id,r.user_id AS reviewer_user_id FROM cycle_assessments a JOIN review_cycles c ON c.id=a.cycle_id JOIN employees ON employees.id=a.employee_id JOIN employees r ON r.id=a.reviewer_id WHERE ${employeeScope(req.user,'performance_management')} AND (a.status='published' OR (employees.user_id IS DISTINCT FROM ${req.user.userId} AND (r.user_id=${req.user.userId} OR ${['admin','super_admin','hr_director','hr'].includes(req.user.role)}))) ORDER BY a.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);
 res.json({items:rows.rows.map((r:any)=>({...r,canEdit:r.reviewer_user_id===req.user.userId&&r.status==='draft'&&r.cycle_status==='open',canPublish:['admin','super_admin','hr_director','hr'].includes(req.user.role)&&r.reviewer_user_id!==req.user.userId&&r.subject_user_id!==req.user.userId&&r.status==='submitted',canAcknowledge:r.subject_user_id===req.user.userId&&r.status==='published'&&!r.acknowledged_at})),canAssign:hasPermission(req.user.role,'performance_management','create')&&getAccessScope(req.user.role,'performance_management')!=='self'});
}));
router.post('/assessments',endpoint(async(req,res)=>{
 const input=z.object({cycleId:id,employeeId:id,reviewerId:id,reason}).strict().parse(req.body);requirePermission(req,'performance_management','create');
 const result=await db.transaction(async tx=>{
 const cycles=await tx.execute(sql`SELECT * FROM review_cycles WHERE id=${input.cycleId} FOR UPDATE`);if(cycles.rows[0]?.status!=='open')throw new OnboardingError(409,'Choose an open cycle');
 const subject=await employee(tx,req,input.employeeId,'performance_management','create');if(subject.userId===req.user.userId||subject.id===input.reviewerId)throw new OnboardingError(403,'Assign an independent reviewer');
 const [reviewer]=await tx.select().from(employees).where(eq(employees.id,input.reviewerId));if(!reviewer||reviewer.status!=='active'||!reviewer.userId)throw new OnboardingError(400,'Reviewer needs an active employee account');
 const account=await tx.execute(sql`SELECT role,is_active,approval_status,department FROM users WHERE id=${reviewer.userId}`);const u=account.rows[0] as any;
 if(!u?.is_active||u.approval_status!=='approved')throw new OnboardingError(400,'Reviewer account is unavailable');
 await employee(tx,{user:{userId:reviewer.userId,role:u.role,department:u.department}},subject.id,'performance_management','update');
 const r=await tx.execute(sql`INSERT INTO cycle_assessments(cycle_id,employee_id,reviewer_id) VALUES (${input.cycleId},${input.employeeId},${input.reviewerId}) RETURNING *`);await history(tx,req,'assessment',r.rows[0],input.reason);return r.rows[0];});res.status(201).json(result);
}));
router.post('/assessments/:id/actions',endpoint(async(req,res)=>{
 const recordId=id.parse(Number(req.params.id));const input=z.object({version:id,action:z.enum(['submit','return','publish','acknowledge']),reason,ratings:z.array(z.object({score:z.number().int().min(1).max(10),evidence:reason}).strict()).max(20).optional(),developmentPlan:z.string().trim().min(5).max(5000).optional()}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
 const lookup=await tx.execute(sql`SELECT cycle_id FROM cycle_assessments WHERE id=${recordId}`);if(!lookup.rows.length)throw new OnboardingError(404,'Review not found');
 const cycles=await tx.execute(sql`SELECT * FROM review_cycles WHERE id=${lookup.rows[0].cycle_id} FOR UPDATE`);const cycle=cycles.rows[0] as any;
 const rows=await tx.execute(sql`SELECT * FROM cycle_assessments WHERE id=${recordId} FOR UPDATE`);const row=rows.rows[0] as any;
 const subject=await employee(tx,req,row.employee_id,'performance_management');if(row.version!==input.version)throw new OnboardingError(409,'Review changed; reload');
 const [reviewer]=await tx.select().from(employees).where(eq(employees.id,row.reviewer_id));
 let status=row.status,ratings=row.ratings,plan=row.development_plan,score=row.score,ack=row.acknowledged_at,publisher=row.published_by;
 if(input.action==='acknowledge'){if(subject.userId!==req.user.userId||status!=='published'||ack)throw new OnboardingError(403,'Only the employee acknowledges a published review');ack=new Date();}
 else{if(cycle.status!=='open')throw new OnboardingError(409,'Cycle is closed');await employee(tx,req,row.employee_id,'performance_management','update');
 if(input.action==='submit'){if(reviewer.userId!==req.user.userId||subject.userId===req.user.userId||status!=='draft')throw new OnboardingError(403,'Only the assigned reviewer submits a draft');if(!input.ratings||input.ratings.length!==cycle.rubric.length||!input.developmentPlan)throw new OnboardingError(400,'Rate every criterion with evidence and a development plan');if(input.ratings.some(r=>r.score>cycle.rating_max))throw new OnboardingError(400,'Score exceeds this cycle’s rating scale');ratings=input.ratings;plan=input.developmentPlan;const factor=10**cycle.score_decimals;score=Math.round(ratings.reduce((n:number,r:any,i:number)=>n+r.score*cycle.rubric[i].weight,0)/100*factor)/factor;status='submitted';}
 else{if(!['admin','super_admin','hr_director','hr'].includes(req.user.role)||reviewer.userId===req.user.userId||subject.userId===req.user.userId||status!=='submitted')throw new OnboardingError(403,'Independent HR must review submitted assessments');status=input.action==='publish'?'published':'draft';publisher=input.action==='publish'?req.user.userId:null;}}
 const r=await tx.execute(sql`UPDATE cycle_assessments SET status=${status},ratings=${JSON.stringify(ratings)}::jsonb,development_plan=${plan},score=${score},acknowledged_at=${ack},published_by=${publisher},version=version+1 WHERE id=${recordId} RETURNING *`);await history(tx,req,'assessment',r.rows[0],input.reason);return r.rows[0];});res.json(result);
}));
router.get('/goals',endpoint(async(req,res)=>{requirePermission(req,'performance_management');const p=page.parse(req.query.page);const r=await db.execute(sql`SELECT g.*,employees.first_name || ' ' || employees.last_name AS employee_name FROM employee_goals g JOIN employees ON employees.id=g.employee_id WHERE ${employeeScope(req.user,'performance_management')} ORDER BY g.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);res.json({items:r.rows,canEdit:hasPermission(req.user.role,'performance_management','update')});}));
router.post('/goals/:id/progress',endpoint(async(req,res)=>{
 const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,status:z.enum(['not_started','in_progress','completed','cancelled','extended']),progress:z.number().int().min(0).max(100),dueDate:civilDate,reason}).strict().parse(req.body);
 if((input.status==='completed'&&input.progress!==100)||(input.status==='not_started'&&input.progress!==0)||(input.status==='in_progress'&&input.progress===100))throw new OnboardingError(400,'Progress must match goal status');
 const saved=await db.transaction(async tx=>{const rows=await tx.execute(sql`SELECT * FROM employee_goals WHERE id=${recordId} FOR UPDATE`);const row=rows.rows[0] as any;if(!row)throw new OnboardingError(404,'Goal not found');await employee(tx,req,row.employee_id,'performance_management','update');if(row.version!==input.version)throw new OnboardingError(409,'Goal changed; reload');if(input.dueDate<row.start_date)throw new OnboardingError(400,'Due date must follow the start date');
 const r=await tx.execute(sql`UPDATE employee_goals SET status=${input.status},progress=${input.progress},due_date=${input.dueDate},completion_date=${input.status==='completed'?new Date().toISOString().slice(0,10):null},updated_at=now() WHERE id=${recordId} RETURNING *`);await history(tx,req,'goal',r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));
router.get('/courses',endpoint(async(req,res)=>{requirePermission(req,'training_development');const p=page.parse(req.query.page);const rows=await db.execute(sql`SELECT id,title,description,provider,active FROM training_courses WHERE active=true OR ${admin(req)} ORDER BY id DESC LIMIT 25 OFFSET ${(p-1)*25}`);res.json({items:rows.rows,canCreate:admin(req)});}));
router.post('/courses',endpoint(async(req,res)=>{if(!admin(req))throw new OnboardingError(403,'An administrator manages the course catalogue');const input=z.object({title:text,description:reason,provider:text,reason}).strict().parse(req.body);const saved=await db.transaction(async tx=>{const [row]=await tx.insert(trainingCourses).values({title:input.title,description:input.description,provider:input.provider,active:true,cost:'0'}).returning();await history(tx,req,'course',{...row,version:1},input.reason);return row;});res.status(201).json(saved);}));
router.get('/learning',endpoint(async(req,res)=>{
 requirePermission(req,'training_development');const p=page.parse(req.query.page);const rows=await db.execute(sql`SELECT l.*,employees.first_name || ' ' || employees.last_name AS employee_name,employees.user_id AS subject_user_id FROM learning_records l JOIN employees ON employees.id=l.employee_id WHERE ${employeeScope(req.user,'training_development')} ORDER BY l.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);
 res.json({items:rows.rows.map((r:any)=>({...r,canSubmit:r.subject_user_id===req.user.userId&&r.status==='assigned',canVerify:r.subject_user_id!==req.user.userId&&hasPermission(req.user.role,'training_development','update')&&['submitted','assigned'].includes(r.status),canWithdraw:['assigned','submitted'].includes(r.status)&&(r.subject_user_id===req.user.userId||hasPermission(req.user.role,'training_development','update'))})),canAssign:hasPermission(req.user.role,'training_development','create')});
}));
router.post('/learning',endpoint(async(req,res)=>{
 const input=z.object({employeeId:id,courseId:id,dueDate:civilDate,reason}).strict().parse(req.body);const saved=await db.transaction(async tx=>{const e=await employee(tx,req,input.employeeId,'training_development','create');if(e.status!=='active')throw new OnboardingError(400,'Choose an active employee');const [course]=await tx.select().from(trainingCourses).where(eq(trainingCourses.id,input.courseId)).for('share');if(!course?.active)throw new OnboardingError(400,'Choose an active course');const r=await tx.execute(sql`INSERT INTO learning_records(employee_id,course_id,course_title,due_date,created_by) VALUES (${input.employeeId},${course.id},${course.title},${input.dueDate},${req.user.userId}) RETURNING *`);await history(tx,req,'learning',r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.post('/learning/:id/actions',endpoint(async(req,res)=>{
 const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,action:z.enum(['submit','verify','return','withdraw']),reason,evidence:reason.optional(),completionDate:civilDate.optional(),expiryDate:civilDate.nullable().optional()}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{const rows=await tx.execute(sql`SELECT * FROM learning_records WHERE id=${recordId} FOR UPDATE`);const row=rows.rows[0] as any;if(!row)throw new OnboardingError(404,'Learning record not found');const e=await employee(tx,req,row.employee_id,'training_development');if(row.version!==input.version||['completed','withdrawn'].includes(row.status))throw new OnboardingError(409,'Record changed or is final');
 let status=row.status,evidence=row.evidence,completion=row.completion_date,expiry=row.expiry_date,verifier=row.verified_by;
 if(input.action==='submit'){if(e.userId!==req.user.userId||status!=='assigned'||!input.evidence)throw new OnboardingError(403,'The assigned employee submits completion evidence');status='submitted';evidence=input.evidence;}
 else if(input.action==='withdraw'){if(e.userId!==req.user.userId)await employee(tx,req,e.id,'training_development','update');status='withdrawn';}
 else{await employee(tx,req,e.id,'training_development','update');if(e.userId===req.user.userId)throw new OnboardingError(403,'An independent reviewer must verify completion');if(input.action==='return'){if(status!=='submitted')throw new OnboardingError(409,'Only submitted evidence can be returned');status='assigned';}
 else{const today=new Date().toISOString().slice(0,10);if(!input.completionDate||input.completionDate>today||!input.evidence||(input.expiryDate&&input.expiryDate<input.completionDate))throw new OnboardingError(400,'Provide a valid completion date and verification evidence');status='completed';completion=input.completionDate;expiry=input.expiryDate||null;evidence=input.evidence;verifier=req.user.userId;}}
 const r=await tx.execute(sql`UPDATE learning_records SET status=${status},evidence=${evidence},completion_date=${completion},expiry_date=${expiry},verified_by=${verifier},version=version+1 WHERE id=${recordId} RETURNING *`);await history(tx,req,'learning',r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));
router.get('/applications',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','read',true);const p=page.parse(req.query.page);
 const r=await db.execute(sql`SELECT a.id,a.status,a.stage_version AS version,c.full_name_en AS candidate_name,j.job_title FROM job_applications a JOIN candidates c ON c.id=a.candidate_id JOIN job_requisitions j ON j.id=a.requisition_id ORDER BY a.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);res.json({items:r.rows,canEdit:hasPermission(req.user.role,'recruitment_onboarding','update')});
}));
router.post('/applications/:id/stage',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','update',true);const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,status:z.enum(['screening','shortlisted','interview','offer','rejected']),reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{const rows=await tx.execute(sql`SELECT * FROM job_applications WHERE id=${recordId} FOR UPDATE`);const row=rows.rows[0] as any;if(!row)throw new OnboardingError(404,'Application not found');if(row.stage_version!==input.version)throw new OnboardingError(409,'Application changed; reload');
 const transitions:Record<string,string[]>={new:['screening','rejected'],screening:['shortlisted','rejected'],shortlisted:['interview','rejected'],interview:['offer','rejected'],offer:['rejected']};if(!transitions[row.status]?.includes(input.status))throw new OnboardingError(409,'This stage transition is not available');
 const offers=await tx.execute(sql`SELECT id FROM job_offers WHERE application_id=${recordId} AND status IN ('draft','pending_approval','pending','accepted') LIMIT 1`);if(input.status==='rejected'&&offers.rows.length)throw new OnboardingError(409,'Resolve the active offer before rejecting the application');
 if(input.status==='offer'){const interviews=await tx.execute(sql`SELECT id FROM interviews WHERE application_id=${recordId} AND status='completed' LIMIT 1`);if(!interviews.rows.length)throw new OnboardingError(409,'Record a completed interview before the offer stage');}
 const r=await tx.execute(sql`UPDATE job_applications SET status=${input.status},rejection_reason=${input.status==='rejected'?input.reason:null},updated_at=now() WHERE id=${recordId} RETURNING *,stage_version AS version`);await history(tx,req,'application',r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));
router.get('/document-checks',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','read',true);requirePermission(req,'compliance_documents');const p=page.parse(req.query.page);
 const r=await db.execute(sql`SELECT c.*,employees.first_name || ' ' || employees.last_name AS employee_name,o.status AS onboarding_status,(c.status='verified' AND d.updated_at=c.document_updated_at AND d.expiry_date>=CURRENT_DATE AND d.issue_date<=CURRENT_DATE AND d.document_file IS NOT NULL) AS current FROM onboarding_document_checks c JOIN employee_onboarding o ON o.id=c.onboarding_id JOIN employees ON employees.id=o.employee_id LEFT JOIN documents d ON d.id=c.document_id WHERE ${employeeScope(req.user,'compliance_documents')} ORDER BY c.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);res.json({items:r.rows,canEdit:hasPermission(req.user.role,'recruitment_onboarding','update')});
}));
router.post('/document-checks',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','update',true);const input=z.object({onboardingId:id,documentType:text,reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{const parents=await tx.execute(sql`SELECT * FROM employee_onboarding WHERE id=${input.onboardingId} FOR UPDATE`);const parent=parents.rows[0] as any;if(!parent||parent.status!=='in_progress')throw new OnboardingError(409,'Select active onboarding');await employee(tx,req,parent.employee_id,'compliance_documents');
 const r=await tx.execute(sql`INSERT INTO onboarding_document_checks(onboarding_id,document_type) VALUES (${input.onboardingId},${input.documentType}) RETURNING *`);await history(tx,req,'document',r.rows[0],input.reason);return r.rows[0];});res.status(201).json(saved);
}));
router.post('/document-checks/:id/verify',endpoint(async(req,res)=>{
 requirePermission(req,'recruitment_onboarding','update',true);const recordId=id.parse(Number(req.params.id)),input=z.object({version:id,documentId:id,reason}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{
 const lookup=await tx.execute(sql`SELECT onboarding_id FROM onboarding_document_checks WHERE id=${recordId}`);if(!lookup.rows.length)throw new OnboardingError(404,'Requirement not found');
 const parents=await tx.execute(sql`SELECT * FROM employee_onboarding WHERE id=${lookup.rows[0].onboarding_id} FOR UPDATE`);const parent=parents.rows[0] as any;if(parent.status!=='in_progress')throw new OnboardingError(409,'Onboarding is no longer active');
 const e=await employee(tx,req,parent.employee_id,'compliance_documents','update');if(e.userId===req.user.userId)throw new OnboardingError(403,'Another reviewer must verify your documents');
 const rows=await tx.execute(sql`SELECT * FROM onboarding_document_checks WHERE id=${recordId} FOR UPDATE`);const row=rows.rows[0] as any;if(row.version!==input.version)throw new OnboardingError(409,'Requirement changed; reload');if(row.status==='waived')throw new OnboardingError(409,'Revoke the waiver before verifying a document');
 const [doc]=await tx.select().from(documents).where(eq(documents.id,input.documentId)).for('share');const today=new Date().toISOString().slice(0,10);
 if(!doc||doc.employeeId!==parent.employee_id||doc.documentType!==row.document_type||!doc.documentFile||doc.expiryDate<today||doc.issueDate>today)throw new OnboardingError(400,'Select this employee’s current uploaded document of the required type');
 const r=await tx.execute(sql`UPDATE onboarding_document_checks SET document_id=${doc.id},document_updated_at=${doc.updatedAt},status='verified',verified_by=${req.user.userId},version=version+1 WHERE id=${recordId} RETURNING *`);await history(tx,req,'document',r.rows[0],input.reason);return r.rows[0];});res.json(saved);
}));
router.get('/exits',endpoint(async(req,res)=>{
 if(!['admin','super_admin','hr_director','hr'].includes(req.user.role))throw new OnboardingError(403,'HR management access is required');const p=page.parse(req.query.page);
 const r=await db.execute(sql`SELECT o.*,employees.first_name || ' ' || employees.last_name AS employee_name FROM offboarding_cases o JOIN employees ON employees.id=o.employee_id ORDER BY o.id DESC LIMIT 25 OFFSET ${(p-1)*25}`);
 const items=[];for(const row of r.rows){let settlements:any[]=[],payroll:any[]=[],canReadPay=false;
 if(hasPermission(req.user.role,'payroll_management','read')){const e=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,Number(row.employee_id)),employeeScope(req.user,'payroll_management')));if(e.length){canReadPay=true;settlements=(await db.execute(sql`SELECT id,status,exit_date FROM final_settlements WHERE employee_id=${row.employee_id} ORDER BY id DESC LIMIT 10`)).rows;payroll=(await db.execute(sql`SELECT id,month,year,status FROM payroll WHERE employee_id=${row.employee_id} AND status='pending' ORDER BY id DESC LIMIT 10`)).rows;}}
 items.push({...row,settlements,pendingPayroll:payroll,canReadPay});}res.json({items});
}));
router.get('/history/:kind/:id',endpoint(async(req,res)=>{
 const kind=z.enum(['application','document','exit','cycle','assessment','learning','goal']).parse(req.params.kind),recordId=id.parse(Number(req.params.id));
 if(kind==='goal'){const r=await db.execute(sql`SELECT employee_id FROM employee_goals WHERE id=${recordId}`);if(!r.rows.length)throw new OnboardingError(404,'Goal not found');await employee(db,req,Number(r.rows[0].employee_id),'performance_management');}
 if(kind==='application')requirePermission(req,'recruitment_onboarding','read',true);
 if(kind==='cycle'&&!admin(req))throw new OnboardingError(403,'Administrator history access required');
 if(kind==='exit'&&!['admin','super_admin','hr_director','hr'].includes(req.user.role))throw new OnboardingError(403,'HR history access required');
 if(kind==='document'){requirePermission(req,'recruitment_onboarding','read',true);const r=await db.execute(sql`SELECT o.employee_id FROM onboarding_document_checks c JOIN employee_onboarding o ON o.id=c.onboarding_id WHERE c.id=${recordId}`);if(!r.rows.length)throw new OnboardingError(404,'Record not found');await employee(db,req,Number(r.rows[0].employee_id),'compliance_documents');}
 let own=false;if(kind==='assessment'||kind==='learning'){const table=kind==='assessment'?sql`cycle_assessments`:sql`learning_records`;const r=await db.execute(sql`SELECT * FROM ${table} WHERE id=${recordId}`);if(!r.rows.length)throw new OnboardingError(404,'Record not found');const e=await employee(db,req,Number(r.rows[0].employee_id),kind==='assessment'?'performance_management':'training_development');own=e.userId===req.user.userId;if(kind==='assessment'){const reviewer=await db.select().from(employees).where(eq(employees.id,Number(r.rows[0].reviewer_id)));if(own&&r.rows[0].status!=='published')throw new OnboardingError(404,'Review not published');if(!own&&!['admin','super_admin','hr_director','hr'].includes(req.user.role)&&reviewer[0]?.userId!==req.user.userId)throw new OnboardingError(403,'Private review history');}}
 const r=await db.execute(sql`SELECT version,snapshot,actor_id,reason,created_at FROM lifecycle_history WHERE kind=${kind} AND record_id=${recordId} AND (${!(kind==='assessment'&&own)} OR snapshot->>'status'='published') ORDER BY version DESC LIMIT 100`);res.json(r.rows);
}));
export default router;
