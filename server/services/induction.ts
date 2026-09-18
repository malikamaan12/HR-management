import {and,eq,sql} from 'drizzle-orm';
import {learningCourses as courses} from '@shared/schema';
import {learningAdmin,policyAdmin,type CourseDefinition} from '@shared/employee-services';
import {inductionBrand,type InductionContent} from '@shared/induction';
import {getCompanySettings} from './settings';
import {fail} from './workforce';

export function requireInductionAuthor(user:{role:string}){if(!learningAdmin(user.role))fail(403,'Training author access required');}
export function requireInductionAdmin(user:{role:string}){if(!policyAdmin(user.role))fail(403,'Administrator access required');}
export async function inductionBranding(tx:any){
 const row=(await tx.execute(sql`SELECT version,config FROM learning_induction_branding WHERE id=1`)).rows[0];
 if(row)return {version:Number(row.version),config:inductionBrand.parse(row.config)};
 const company=await getCompanySettings(tx);
 return {version:0,config:inductionBrand.parse({organizationName:company.companyName,academyTitle:'Induction & training',welcomeText:'Your induction courses, learning progress and completion records in one place.',accentColor:'#174b49',certificateTitle:'Certificate of completion',certificatePrefix:'HR-IND',signatoryTitle:'Learning & development',logoAssetId:null})};
}
export function internalDefinition(definition:CourseDefinition,status:'draft'|'published'|'archived'='draft'):CourseDefinition{
 return {...definition,delivery:'internal',format:'self_paced',url:'',status};
}
export async function inductionCourse(tx:any,id:number,lock=false){
 const query=tx.select().from(courses).where(and(eq(courses.id,id),sql`EXISTS(SELECT 1 FROM learning_induction_courses i WHERE i.course_id=${courses.id})`));
 const [row]=await(lock?query.for('update'):query);if(!row)fail(404,'Internal course not found');return row as typeof courses.$inferSelect;
}
export async function validateInductionAssets(tx:any,courseId:number,content:InductionContent){
 for(const lesson of content.lessons){
  if(!lesson.assetId)continue;
  const row=(await tx.execute(sql`SELECT id,mime FROM learning_induction_assets WHERE id=${lesson.assetId} AND course_id=${courseId} AND kind='lesson'`)).rows[0];
  if(!row)fail(400,'Every lesson asset must belong to this course');
  if(lesson.kind==='video'&&!['video/mp4','video/webm'].includes(row.mime))fail(400,'Choose an uploaded MP4 or WebM for a video lesson');
  if(lesson.kind==='document'&&!['application/pdf','image/png','image/jpeg'].includes(row.mime))fail(400,'Choose an uploaded PDF, PNG or JPEG for a document lesson');
 }
}
export async function inductionMediaUsage(tx:any){const row=(await tx.execute(sql`SELECT coalesce(sum(size),0)::bigint AS used FROM learning_induction_assets`)).rows[0];return Number(row.used);}
