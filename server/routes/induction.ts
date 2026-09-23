import {Router,type Request,type Response,type NextFunction} from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {and,eq,sql,desc} from 'drizzle-orm';
import {z} from 'zod';
import {learningCourses as courses,learningEnrollments as enrollments,employees} from '@shared/schema';
import {learningAdmin,policyAdmin} from '@shared/employee-services';
import {hasPermission} from '@shared/permissions';
import {positiveId,reason} from '@shared/hr-rules';
import {inductionCreate,inductionRevision,inductionPublish,inductionContent,inductionBrand,publicInductionContent,type InductionContent} from '@shared/induction';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {handle} from './hr-rules';
import {fail} from '../services/workforce';
import {approver,enrollmentRecord,event,versionCheck} from '../services/employee-services';
import {audit,businessToday} from '../services/hr-rules';
import {recordHistory} from '../services/workflowRecords';
import {inductionBranding,inductionCourse,inductionMediaUsage,internalDefinition,requireInductionAuthor,requireInductionAdmin,validateInductionAssets} from '../services/induction';
import {privateStorageConfigured,validateInductionFile,uploadInductionAsset,deleteInductionAsset,inductionAssetUrl,StorageUnavailableError} from '../services/r2';
import learnerRouter from './induction-learning';
import {ensureInductionSafetyCourses,safetyLibraryCatalogue} from '../services/induction-course-library';

const router=Router();
router.use(authenticate);
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!hasPermission(req.user!.role,'training_development','read'))return res.status(403).json({message:'Learning access required'});next();});
const listInput=z.object({q:z.string().trim().max(100).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),filter:z.enum(['all','required','self','draft']).default('all')}).strict();
router.get('/library',handle(async(req,res)=>{requireInductionAuthor(req.user!);res.json(await safetyLibraryCatalogue());}));
router.post('/library/install',handle(async(req,res)=>{requireInductionAuthor(req.user!);const input=z.object({reason}).strict().parse(req.body);res.json(await ensureInductionSafetyCourses({actor:req.user!,reason:input.reason}));}));
router.get('/context',handle(async(req,res)=>{
 const brand=await inductionBranding(db),used=await inductionMediaUsage(db);
 res.json({brand,canManage:learningAdmin(req.user!.role),canReport:learningAdmin(req.user!.role)||hasPermission(req.user!.role,'training_development','update')||hasPermission(req.user!.role,'training_development','approve'),canConfigure:policyAdmin(req.user!.role),storage:privateStorageConfigured(),limits:{maxAssetBytes:brand.config.maxUploadMb*1048576,mediaBudgetBytes:brand.config.mediaBudgetMb*1048576,mediaUsedBytes:learningAdmin(req.user!.role)?used:undefined}});
}));
router.get('/courses',handle(async(req,res)=>{
 const input=listInput.parse(req.query),author=learningAdmin(req.user!.role);
 const [learner]=await db.select().from(employees).where(eq(employees.userId,req.user!.userId)).limit(1);
 const learnerActive=!!learner&&learner.status==='active'&&businessToday()>=learner.joiningDate&&(!learner.contractEndDate||businessToday()<=learner.contractEndDate)&&(!learner.terminationDate||businessToday()<learner.terminationDate);
 const where=sql`(${author} OR (c.definition->>'status'='published' AND r.id IS NOT NULL)) AND (${input.q}='' OR strpos(lower(c.definition->>'title'),lower(${input.q}))>0)
 AND (${input.filter}='all' OR (${input.filter}='required' AND r.content->'settings'->>'mandatoryForOnboarding'='true' AND c.definition->>'status'='published')
 OR (${input.filter}='draft' AND r.id IS NULL AND c.definition->>'status'='draft')
 OR (${input.filter}='self' AND ${learnerActive} AND c.definition->>'status'='published' AND r.content->'settings'->>'allowSelfEnrollment'='true' AND (r.content->'settings'->'employeeTypes') ? ${learner?.type||''} AND (jsonb_array_length(r.content->'settings'->'departments')=0 OR (r.content->'settings'->'departments') ? ${learner?.department||''})))`;
 const rows=(await db.execute(sql`SELECT c.id,c.version,c.definition,r.id AS release_id,r.release_number,r.content,
  (SELECT jsonb_build_object('id',e.id,'status',e.status,'progress',e.progress) FROM learning_enrollments e JOIN learning_induction_enrollments ie ON ie.enrollment_id=e.id WHERE e.course_id=c.id AND e.employee_id=${learner?.id??0} AND e.status NOT IN ('withdrawn','rejected') AND (e.status<>'completed' OR e.expires_on IS NULL OR e.expires_on>=${businessToday()}::date) ORDER BY e.id DESC LIMIT 1) AS own_enrollment,
  EXISTS(SELECT 1 FROM learning_induction_drafts d WHERE d.course_id=c.id AND (r.id IS NULL OR d.content IS DISTINCT FROM r.content OR (d.definition-'status') IS DISTINCT FROM (r.definition-'status'))) AS has_draft
  FROM learning_courses c JOIN learning_induction_courses i ON i.course_id=c.id LEFT JOIN learning_induction_releases r ON r.id=i.published_release_id
  WHERE ${where} ORDER BY c.id DESC LIMIT 25 OFFSET ${input.offset}`)).rows;
 const count=(await db.execute(sql`SELECT count(*)::int AS count FROM learning_courses c JOIN learning_induction_courses i ON i.course_id=c.id LEFT JOIN learning_induction_releases r ON r.id=i.published_release_id WHERE ${where}`)).rows[0];
 res.json({items:rows.map((row:any)=>{const content=row.content?publicInductionContent(inductionContent.parse(row.content)):null;const current=!!learner&&learner.status==='active'&&businessToday()>=learner.joiningDate&&(!learner.contractEndDate||businessToday()<=learner.contractEndDate)&&(!learner.terminationDate||businessToday()<learner.terminationDate);const eligible=current&&!!content&&!!learner&&content.settings.employeeTypes.includes(learner.type)&&(!content.settings.departments.length||content.settings.departments.includes(learner.department));return {id:row.id,version:row.version,definition:row.definition,ownEnrollment:row.own_enrollment,canSelfEnroll:eligible,selfEnrollmentNote:!learner?'An employee profile is needed to enroll.':!current?'Enrollment requires an active employee profile.':!eligible?'This course is assigned to other roles or departments.':null,hasDraft:author&&row.has_draft,publishedRelease:content?{id:row.release_id,releaseNumber:row.release_number,lessonCount:content.lessons.length,questionCount:content.questionCount,settings:content.settings}:null};}),total:Number(count.count)});
}));
router.post('/courses',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const input=inductionCreate.parse(req.body);
 res.status(201).json(await db.transaction(async tx=>{
  await approver(tx,input.definition.approverId,'training_development');
  const definition=internalDefinition({...input.definition,requiresEvidence:false,passScore:input.content.settings.passScore,validMonths:input.content.settings.validMonths});
  const [course]=await tx.insert(courses).values({definition,createdBy:req.user!.userId,history:event([],req.user!,'Internal course created',input.reason,1)}).returning();
  await tx.execute(sql`INSERT INTO learning_induction_courses(course_id) VALUES (${course.id})`);
  await validateInductionAssets(tx,course.id,input.content);
  await tx.execute(sql`INSERT INTO learning_induction_drafts(course_id,definition,content,updated_by) VALUES (${course.id},${JSON.stringify(definition)}::jsonb,${JSON.stringify(input.content)}::jsonb,${req.user!.userId})`);
  await audit(tx,req.user!,'induction_course',course.id,'Created private course draft');return {id:course.id,version:course.version};
 }));
}));
router.get('/courses/:id/draft',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const id=positiveId.parse(req.params.id),course=await inductionCourse(db,id);
 const draft=(await db.execute(sql`SELECT version,definition,content FROM learning_induction_drafts WHERE course_id=${id}`)).rows[0];
 const published=(await db.execute(sql`SELECT r.id,r.release_number FROM learning_induction_courses c JOIN learning_induction_releases r ON r.id=c.published_release_id WHERE c.course_id=${id}`)).rows[0];
 const assets=(await db.execute(sql`SELECT id,filename,mime,size FROM learning_induction_assets WHERE course_id=${id} ORDER BY id DESC`)).rows;
 res.json({course:{id:course.id,version:course.version,definition:course.definition},draft,publishedRelease:published?{id:published.id,releaseNumber:published.release_number}:null,assets,history:course.history});
}));
router.put('/courses/:id/draft',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const id=positiveId.parse(req.params.id),input=inductionRevision.parse(req.body);
 res.json(await db.transaction(async tx=>{
  const course=await inductionCourse(tx,id,true);versionCheck(course.version,input.version);
  const draft=(await tx.execute(sql`SELECT * FROM learning_induction_drafts WHERE course_id=${id} FOR UPDATE`)).rows[0];versionCheck(Number(draft.version),input.draftVersion);
  await approver(tx,input.definition.approverId,'training_development');await validateInductionAssets(tx,id,input.content);
  const definition=internalDefinition({...input.definition,requiresEvidence:false,passScore:input.content.settings.passScore,validMonths:input.content.settings.validMonths});
  await tx.execute(sql`UPDATE learning_induction_drafts SET definition=${JSON.stringify(definition)}::jsonb,content=${JSON.stringify(input.content)}::jsonb,version=version+1,updated_by=${req.user!.userId},updated_at=now() WHERE course_id=${id}`);
  const [saved]=await tx.update(courses).set({definition:course.definition.status==='draft'?definition:course.definition,version:course.version+1,updatedAt:new Date(),history:event(course.history,req.user!,'Draft revised',input.reason,course.version+1,{lessonCount:input.content.lessons.length,questionCount:input.content.questions.length})}).where(eq(courses.id,id)).returning();
  await audit(tx,req.user!,'induction_course',id,'Saved course draft');return {id,version:saved.version,draftVersion:Number(draft.version)+1};
 }));
}));
router.post('/courses/:id/publish',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const id=positiveId.parse(req.params.id),input=inductionPublish.parse(req.body);
 res.json(await db.transaction(async tx=>{
  const course=await inductionCourse(tx,id,true);versionCheck(course.version,input.version);
  const draft=(await tx.execute(sql`SELECT * FROM learning_induction_drafts WHERE course_id=${id} FOR UPDATE`)).rows[0];versionCheck(Number(draft.version),input.draftVersion);
  const content=inductionContent.parse(draft.content),definition=internalDefinition(draft.definition as any,'published');
  if(content.lessons.some(l=>l.body.includes('DRAFT AUTHORING INSTRUCTIONS'))||content.questions.some(q=>q.prompt.includes('DRAFT QUESTION:')||q.options.some(o=>o.text.includes('Replace this option with'))))fail(400,'Replace the draft authoring instructions and starter question with your actual training before publishing');
  await validateInductionAssets(tx,id,content);await approver(tx,definition.approverId,'training_development');
  const number=Number((await tx.execute(sql`SELECT coalesce(max(release_number),0)+1 AS next FROM learning_induction_releases WHERE course_id=${id}`)).rows[0].next);
  const release=(await tx.execute(sql`INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES (${id},${number},${course.version+1},${JSON.stringify(definition)}::jsonb,${JSON.stringify(content)}::jsonb,${req.user!.userId}) RETURNING id`)).rows[0];
  await tx.execute(sql`UPDATE learning_induction_courses SET published_release_id=${release.id} WHERE course_id=${id}`);
  await tx.update(courses).set({definition,version:course.version+1,updatedAt:new Date(),history:event(course.history,req.user!,'Release published',input.reason,course.version+1,{releaseId:release.id,releaseNumber:number})}).where(eq(courses.id,id));
  await audit(tx,req.user!,'induction_course',id,`Published release ${number}`);return {id,version:course.version+1,releaseId:release.id,releaseNumber:number};
 }));
}));
router.post('/courses/:id/archive',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,reason}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{
  const course=await inductionCourse(tx,id,true);versionCheck(course.version,input.version);if(course.definition.status==='archived')fail(409,'Course is already archived');
  const [row]=await tx.update(courses).set({definition:internalDefinition(course.definition,'archived'),version:course.version+1,updatedAt:new Date(),history:event(course.history,req.user!,'Course archived',input.reason,course.version+1)}).where(eq(courses.id,id)).returning();
  await audit(tx,req.user!,'induction_course',id,'Archived for new enrollments');return {id,version:row.version};
 }));
}));

router.get('/branding',handle(async(_req,res)=>res.json(await inductionBranding(db))));
router.post('/branding',handle(async(req,res)=>{
 requireInductionAdmin(req.user!);const input=z.object({version:z.number().int().min(0),config:inductionBrand,reason}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{
  await tx.execute(sql`LOCK TABLE learning_induction_branding IN SHARE ROW EXCLUSIVE MODE`);const old=await inductionBranding(tx);versionCheck(old.version,input.version);
  if(input.config.logoAssetId){const logo=(await tx.execute(sql`SELECT id FROM learning_induction_assets WHERE id=${input.config.logoAssetId} AND kind='logo'`)).rows[0];if(!logo)fail(400,'Choose an uploaded academy logo');}
  const row=(await tx.execute(sql`INSERT INTO learning_induction_branding(id,version,config,updated_by) VALUES (1,${old.version+1},${JSON.stringify(input.config)}::jsonb,${req.user!.userId}) ON CONFLICT(id) DO UPDATE SET version=excluded.version,config=excluded.config,updated_by=excluded.updated_by,updated_at=now() RETURNING *`)).rows[0];
  await recordHistory(tx,req,'induction_branding',row,input.reason);return {version:row.version,config:row.config};
 }));
}));
router.get('/branding/history',handle(async(req,res)=>{
 requireInductionAdmin(req.user!);const offset=z.coerce.number().int().min(0).default(0).parse(req.query.offset);
 res.json((await db.execute(sql`SELECT version,reason,created_at,snapshot->'config' AS config FROM hr_workflow_history WHERE kind='induction_branding' AND record_id=1 ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows);
}));

const uploadLimit=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Please wait before uploading more training media'}});
const parseAsset=multer({storage:multer.memoryStorage(),limits:{fileSize:40*1048576,files:1,fields:0}}).single('file');
const receiveAsset=(req:Request,res:Response,next:NextFunction)=>parseAsset(req,res,error=>{if(error)return res.status(400).json({message:'Upload one supported file up to 40 MB'});if(!req.file)return res.status(400).json({message:'Choose a course file'});next();});
const authorOnly=(req:Request,res:Response,next:NextFunction)=>{if(!learningAdmin(req.user!.role))return res.status(403).json({message:'Training author access required'});next();};
const brandOnly=(req:Request,res:Response,next:NextFunction)=>{if(!policyAdmin(req.user!.role))return res.status(403).json({message:'Administrator access required'});next();};
async function storeAsset(req:Request,res:Response,courseId:number|null){
 let uploaded:string|undefined;
 try{
  try{validateInductionFile(req.file!,courseId===null);}catch(error){fail(400,(error as Error).message);}
  if(!privateStorageConfigured())fail(503,'The existing private storage must be configured before uploading media. Text lessons and quizzes remain available.');
  const saved=await db.transaction(async tx=>{
   if(courseId!==null)await inductionCourse(tx,courseId,true);
   await tx.execute(sql`LOCK TABLE learning_induction_branding IN SHARE MODE`);
   await tx.execute(sql`LOCK TABLE learning_induction_assets IN SHARE ROW EXCLUSIVE MODE`);
   const {config}=await inductionBranding(tx),used=await inductionMediaUsage(tx);
   if(req.file!.size>config.maxUploadMb*1048576)fail(400,`The configured upload limit is ${config.maxUploadMb} MB`);
   if(used+req.file!.size>config.mediaBudgetMb*1048576)fail(409,'The academy media budget is full or disabled. Remove unused assets or use text lessons; an administrator can revise the budget.');
   const file=await uploadInductionAsset(courseId,req.file!);uploaded=file.key;
   const filename=(req.file!.originalname.split(/[\\/]/).pop()||'training-asset').replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);
   const row=(await tx.execute(sql`INSERT INTO learning_induction_assets(course_id,kind,object_key,filename,mime,size,created_by) VALUES (${courseId},${courseId===null?'logo':'lesson'},${file.key},${filename},${file.mime},${req.file!.size},${req.user!.userId}) RETURNING id,filename,mime,size`)).rows[0];
   await audit(tx,req.user!,'induction_asset',Number(row.id),'Uploaded private training asset');return row;
  });res.status(201).json(saved);
 }catch(error){if(uploaded)try{await deleteInductionAsset(uploaded);}catch{console.error('Training asset cleanup pending');}if(error instanceof StorageUnavailableError)fail(503,'Private training storage is unavailable');throw error;}
}
router.post('/courses/:id/assets',authorOnly,uploadLimit,receiveAsset,handle(async(req,res)=>storeAsset(req,res,positiveId.parse(req.params.id))));
router.post('/branding/assets',brandOnly,uploadLimit,receiveAsset,handle(async(req,res)=>storeAsset(req,res,null)));

router.get('/branding/logo',handle(async(_req,res)=>{
 const {config}=await inductionBranding(db);if(!config.logoAssetId)fail(404,'No academy logo configured');
 const asset=(await db.execute(sql`SELECT object_key,mime FROM learning_induction_assets WHERE id=${config.logoAssetId} AND kind='logo'`)).rows[0];
 if(!asset)fail(404,'Logo not found');res.redirect(await inductionAssetUrl(String(asset.object_key),String(asset.mime)));
}));
router.get('/assets/:id/download',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),query=z.object({courseId:positiveId.optional(),enrollmentId:positiveId.optional()}).strict().parse(req.query);
 const asset=(await db.execute(sql`SELECT * FROM learning_induction_assets WHERE id=${id}`)).rows[0];if(!asset)fail(404,'Training file not found');
 if(query.enrollmentId){
  await db.transaction(async tx=>{
   const {row}=await enrollmentRecord(tx,req.user!,query.enrollmentId!);
   if(!['approved','in_progress','completion_submitted','completed','failed'].includes(row.status))fail(403,'Enrollment must be approved before opening course files');
   const pinned=(await tx.execute(sql`SELECT r.content,r.course_id,e.completion_brand FROM learning_induction_enrollments e JOIN learning_induction_releases r ON r.id=e.release_id WHERE e.enrollment_id=${row.id}`)).rows[0];
   const certificateLogo=asset.kind==='logo'&&row.status==='completed'&&Number((pinned?.completion_brand as {logoAssetId?:number}|null)?.logoAssetId)===id;
   if(!certificateLogo&&(!pinned||Number(pinned.course_id)!==Number(asset.course_id)||!(pinned.content as InductionContent).lessons.some(l=>l.assetId===id)))fail(404,'This file is not part of the assigned course release');
  });
 }else if(asset.kind==='logo'){requireInductionAdmin(req.user!);}
 else {requireInductionAuthor(req.user!);if(!query.courseId||query.courseId!==Number(asset.course_id))fail(404,'Training file not found');await inductionCourse(db,query.courseId);}
 res.set('X-Content-Type-Options','nosniff');res.redirect(await inductionAssetUrl(String(asset.object_key),String(asset.mime)));
}));
router.delete('/assets/:id',handle(async(req,res)=>{
 requireInductionAuthor(req.user!);const id=positiveId.parse(req.params.id),input=z.object({reason}).strict().parse(req.body);
 const lookup=(await db.execute(sql`SELECT course_id,kind FROM learning_induction_assets WHERE id=${id}`)).rows[0];if(!lookup)fail(404,'Asset not found');
 if(lookup.kind==='logo')requireInductionAdmin(req.user!);
 await db.transaction(async tx=>{
  if(lookup.course_id)await inductionCourse(tx,Number(lookup.course_id),true);
  await tx.execute(sql`LOCK TABLE learning_induction_branding IN SHARE MODE`);
  await tx.execute(sql`LOCK TABLE learning_induction_assets IN SHARE ROW EXCLUSIVE MODE`);
  const asset=(await tx.execute(sql`SELECT * FROM learning_induction_assets WHERE id=${id} FOR UPDATE`)).rows[0];if(!asset)fail(404,'Asset not found');
  const referenced=(await tx.execute(sql`SELECT 1 AS found FROM learning_induction_releases WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(content->'lessons') l WHERE l->>'assetId'=${String(id)})
   UNION ALL SELECT 1 FROM learning_induction_drafts WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(content->'lessons') l WHERE l->>'assetId'=${String(id)})
   UNION ALL SELECT 1 FROM learning_induction_branding WHERE config->>'logoAssetId'=${String(id)}
   UNION ALL SELECT 1 FROM learning_induction_enrollments WHERE completion_brand->>'logoAssetId'=${String(id)} LIMIT 1`)).rows[0];
  if(referenced)fail(409,'This asset is used by a draft, published release, branding or certificate. Preserve it, or remove its unused draft reference first.');
  await deleteInductionAsset(String(asset.object_key));await tx.execute(sql`DELETE FROM learning_induction_assets WHERE id=${id}`);
  await audit(tx,req.user!,'induction_asset',id,'Removed unused asset: '+input.reason);
 });res.json({removed:true});
}));

router.use(learnerRouter);
export default router;
