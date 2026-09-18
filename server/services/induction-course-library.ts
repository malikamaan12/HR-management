import {and,eq,inArray,sql} from 'drizzle-orm';
import {db} from '../db';
import {learningCourses,users} from '@shared/schema';
import {courseDefinition,learningAdmin} from '@shared/employee-services';
import {hasPermission} from '@shared/permissions';
import {inductionContent} from '@shared/induction';
import {materializeSafetyCourse,safetyCourseLibrary,safetyCourseSummaries,safetyLibraryVersion} from '@shared/induction-course-library';
import {inductionBranding,requireInductionAuthor} from './induction';
import {event} from './employee-services';
import {audit} from './hr-rules';
import {fail} from './workforce';
import type {TokenPayload} from './auth';

export async function safetyLibraryCatalogue(){
 const rows=(await db.execute(sql`SELECT s.starter_key,s.course_id,s.library_version,c.definition->>'status' AS status,c.definition->>'title' AS current_title FROM learning_induction_starter_courses s JOIN learning_courses c ON c.id=s.course_id`)).rows;
 return {items:safetyCourseSummaries().map(seed=>{const installed=rows.find(row=>row.starter_key===seed.key);return {...seed,courseId:installed?Number(installed.course_id):null,status:installed?String(installed.status):'not_installed',currentTitle:installed?String(installed.current_title):null,installedVersion:installed?Number(installed.library_version):null};})};
}

/** Install missing requested starter courses only. Never revise, republish or assign an existing course. */
export async function ensureInductionSafetyCourses(options:{actor?:TokenPayload;reason?:string}={}){
 if(options.actor)requireInductionAuthor(options.actor);
 return db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('e3_hr_induction_safety_library'))`);
  const installed=(await tx.execute(sql`SELECT starter_key,course_id FROM learning_induction_starter_courses`)).rows;
  const existing=installed.filter(row=>safetyCourseLibrary.some(seed=>seed.key===row.starter_key)).map(row=>Number(row.course_id));
  const missing=safetyCourseLibrary.filter(seed=>!installed.some(row=>row.starter_key===seed.key));
  if(!missing.length)return {created:[] as number[],existing};
  const [owner]=await tx.select({id:users.id,username:users.username,role:users.role,department:users.department}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),inArray(users.role,['super_admin','admin','hr_director','hr']),options.actor?eq(users.id,options.actor.userId):undefined)).orderBy(sql`CASE ${users.role} WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 WHEN 'hr_director' THEN 2 ELSE 3 END`,users.id).limit(1).for('share');
  if(!owner||!learningAdmin(owner.role)||!hasPermission(owner.role,'training_development','approve')){
   if(options.actor)fail(403,'An active approved training administrator with approval access must install these courses');
   return {created:[] as number[],existing,skipped:'No active approved training administrator is available'};
  }
  const actor:TokenPayload={userId:owner.id,username:owner.username,role:owner.role,department:owner.department};
  const branding=await inductionBranding(tx),created:number[]=[];
  const reason=options.reason||'System bootstrap installed the requested editable safety library. Initial administrator ownership is assigned for course management; this is not a record of personal content approval.';
  for(const seed of missing){
   const prepared=materializeSafetyCourse(seed,owner.id,branding.config.organizationName),definition=courseDefinition.parse(prepared.definition),content=inductionContent.parse(prepared.content);
   const history=event(event([],actor,'Safety library course created',reason,1,{starterKey:seed.key,libraryVersion:safetyLibraryVersion}),actor,'Safety library release published',reason,2,{releaseNumber:1,lessonCount:content.lessons.length,questionCount:content.questions.length});
   const [course]=await tx.insert(learningCourses).values({version:2,definition,createdBy:owner.id,history}).returning({id:learningCourses.id});
   await tx.execute(sql`INSERT INTO learning_induction_courses(course_id) VALUES (${course.id})`);
   await tx.execute(sql`INSERT INTO learning_induction_drafts(course_id,definition,content,updated_by) VALUES (${course.id},${JSON.stringify({...definition,status:'draft'})}::jsonb,${JSON.stringify(content)}::jsonb,${owner.id})`);
   const release=(await tx.execute(sql`INSERT INTO learning_induction_releases(course_id,release_number,course_version,definition,content,created_by) VALUES (${course.id},1,2,${JSON.stringify(definition)}::jsonb,${JSON.stringify(content)}::jsonb,${owner.id}) RETURNING id`)).rows[0];
   await tx.execute(sql`UPDATE learning_induction_courses SET published_release_id=${release.id} WHERE course_id=${course.id}`);
   await tx.execute(sql`INSERT INTO learning_induction_starter_courses(starter_key,course_id,library_version,installed_by) VALUES (${seed.key},${course.id},${safetyLibraryVersion},${owner.id})`);
   await audit(tx,actor,'induction_course',course.id,`Installed safety library course ${seed.key}, release 1; no enrollments assigned`);
   created.push(course.id);
  }
  return {created,existing};
 });
}
