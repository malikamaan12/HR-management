import {and,eq,gte,inArray,isNotNull,lte,or,sql} from 'drizzle-orm';
import {db} from '../db';
import {documents,employees,learningEnrollments,leaves,notifications,serviceRequests,users} from '@shared/schema';
import notificationService from './notifications';

const dayStart=(now:Date)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
const iso=(date:Date)=>date.toISOString().slice(0,10);

export async function runOperationalReminders(now=new Date()) {
  const start=dayStart(now), horizon=new Date(+now+30*86400000), dueSoon=new Date(+now+7*86400000);
  const existing=await db.select({userId:notifications.userId,data:notifications.data}).from(notifications).where(gte(notifications.createdAt,start));
  const seen=new Set(existing.map(row=>String((row.data as any)?.reminderKey||'')));
  let created=0;
  const enqueue=async(userId:number,message:string,type:string,key:string)=>{if(seen.has(key))return;await notificationService.createNotification({userId,message,channel:'push',status:'pending',data:{type,reminderKey:key}});seen.add(key);created++;};
  const approvers=await db.select({id:users.id}).from(users).where(and(eq(users.isActive,true),inArray(users.role,['admin','super_admin','hr','hr_director'])));
  const [pendingLeave]=await db.select({count:sql<number>`count(*)::int`}).from(leaves).where(eq(leaves.status,'pending'));
  const [pendingService]=await db.select({count:sql<number>`count(*)::int`}).from(serviceRequests).where(eq(serviceRequests.status,'submitted'));
  if(Number(pendingLeave?.count||0)+Number(pendingService?.count||0)>0) for(const approver of approvers) await enqueue(approver.id,`Approval queue reminder: ${Number(pendingLeave?.count||0)} leave request(s) and ${Number(pendingService?.count||0)} benefit/expense request(s) are waiting.`,`approval_reminder`,`approvals-${iso(now)}-${approver.id}`);
  const expiring=await db.select({employeeId:documents.employeeId,employeeUserId:employees.userId,documentType:documents.documentType,expiryDate:documents.expiryDate,status:documents.status}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id)).where(and(isNotNull(employees.userId),or(eq(documents.status,'expired'),eq(documents.status,'expiring_soon'),and(isNotNull(documents.expiryDate),lte(documents.expiryDate,iso(horizon)))))).limit(200);
  for(const row of expiring) if(row.employeeUserId) await enqueue(row.employeeUserId,`Document reminder: ${row.documentType} ${row.status==='expired'?'has expired':`expires on ${row.expiryDate||'soon'}`}.`,`document_expiry`, `document-${row.employeeId}-${row.documentType}-${row.expiryDate||row.status}-${iso(now)}`);
  const training=await db.select({id:learningEnrollments.id,employeeId:learningEnrollments.employeeId,employeeUserId:employees.userId,title:sql<string>`(${learningEnrollments.courseSnapshot}->>'title')`,dueDate:learningEnrollments.dueDate,status:learningEnrollments.status}).from(learningEnrollments).innerJoin(employees,eq(learningEnrollments.employeeId,employees.id)).where(and(isNotNull(employees.userId),inArray(learningEnrollments.status,['requested','approved','in_progress']),isNotNull(learningEnrollments.dueDate),lte(learningEnrollments.dueDate,iso(dueSoon)),gte(learningEnrollments.dueDate,iso(now)))).limit(200);
  for(const row of training) if(row.employeeUserId) await enqueue(row.employeeUserId,`Training reminder: ${row.title||'assigned course'} is due by ${row.dueDate}.`,'training_completion',`training-${row.id}-${row.dueDate}-${iso(now)}`);
  return {created,pendingLeave:Number(pendingLeave?.count||0),pendingService:Number(pendingService?.count||0),documents:expiring.length,training:training.length};
}
