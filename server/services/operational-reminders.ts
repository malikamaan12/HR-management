import {and,eq,gte,inArray,isNotNull,lte,ne,not,sql,type SQL} from 'drizzle-orm';
import {db} from '../db';
import {documents,employees,learningEnrollments,leaves,leaveSnapshots,notifications,serviceRequests,users,type UserRole} from '@shared/schema';
import {hasPermission,ROLE_PERMISSIONS} from '@shared/permissions';
import {defaultOperationalReminders,operationalReminderConfig,type OperationalReminderPolicy} from '@shared/reminders';
import {leaveApprovalChain} from '@shared/leave-workflow';
import {localDate} from '@shared/workforce';
import {employeeScope} from './access';
import {documentIsArchived} from './retention';

const afterDays=(date:string,days:number)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
export async function operationalReminderPolicy(tx:any):Promise<OperationalReminderPolicy>{
  const row=(await tx.execute(sql`SELECT version,config FROM operational_reminder_policies ORDER BY version DESC LIMIT 1`)).rows[0];
  return {version:Number(row?.version||0),config:operationalReminderConfig.parse(row?.config||defaultOperationalReminders)};
}
const approvalRoles=(Object.keys(ROLE_PERMISSIONS) as UserRole[]).filter(role=>['leave_absence_management','benefits_perks','expense_management'].some(module=>hasPermission(role,module as any,'approve')));

// Called by the in-process scheduler. Policy publication does not run delivery.
// Unique delivery keys and notifications commit in the same transaction.
export async function runOperationalReminders(now=new Date()){
  return db.transaction(async tx=>{
    const locked=(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(7331037) AS locked`)).rows[0];
    if(!locked?.locked)return {skipped:true,created:0};
    const policy=await operationalReminderPolicy(tx),c=policy.config,today=localDate(now,c.timezone),cutoff=new Date(+now-c.repeatHours*3600000);
    const period=`${c.repeatHours}:${Math.floor(+now/(c.repeatHours*3600000))}`;
    await tx.execute(sql`UPDATE operational_reminder_runtime SET last_started_at=${now},policy_version=${policy.version},enabled=${c.enabled} WHERE id=1`);
    const summary={documents:0,training:0,handbooks:0,equipment:0,approvals:0,pendingLeave:0,pendingService:0};let created=0;
    const kindCount=[c.notifyDocuments,c.notifyTraining,c.notifyHandbooks,c.notifyEquipment,c.notifyApprovals].filter(Boolean).length;
    const budget=Math.max(1,Math.floor(c.maxPerRun/Math.max(1,kindCount)));
    const notRecentlySent=(kind:string,id:SQL,userId:SQL,date:SQL)=>sql`NOT EXISTS(SELECT 1 FROM operational_reminder_deliveries d WHERE d.kind=${kind} AND d.record_id=${id} AND d.recipient_id=${userId} AND d.target_date=coalesce((${date})::text,'') AND (d.period_key=${period} OR d.created_at>${cutoff}))`;
    const enqueue=async(userId:number,message:string,kind:string,recordId:number,date:string,url:string)=>{
      const [person]=await tx.select({id:users.id}).from(users).where(and(eq(users.id,userId),eq(users.isActive,true),eq(users.approvalStatus,'approved'))).for('share');if(!person)return false;
      const inserted=(await tx.execute(sql`INSERT INTO operational_reminder_deliveries(kind,record_id,recipient_id,target_date,period_key,policy_version,created_at)
        SELECT ${kind},${recordId},${userId},${date},${period},${policy.version},${now}
        WHERE NOT EXISTS(SELECT 1 FROM operational_reminder_deliveries WHERE kind=${kind} AND record_id=${recordId} AND recipient_id=${userId} AND target_date=${date} AND created_at>${cutoff})
        ON CONFLICT DO NOTHING RETURNING id`)).rows[0];if(!inserted)return false;
      const [notification]=await tx.insert(notifications).values({userId,message,channel:'push',status:'pending',data:{type:kind,recordId,url,reminderKey:`${kind}:${recordId}:${userId}:${date}:${period}`,policyVersion:policy.version},timestamp:now,createdAt:now,updatedAt:now}).returning({id:notifications.id});
      await tx.execute(sql`UPDATE operational_reminder_deliveries SET notification_id=${notification.id} WHERE id=${inserted.id}`);created++;return true;
    };
    const eligibleRecipient=and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),ne(employees.status,'inactive'));
    if(c.enabled&&c.notifyDocuments){
      const rows=await tx.select({id:documents.id,userId:users.id,documentType:documents.documentType,expiryDate:documents.expiryDate}).from(documents).innerJoin(employees,eq(documents.employeeId,employees.id)).innerJoin(users,eq(employees.userId,users.id))
        .where(and(eligibleRecipient,not(documentIsArchived),lte(documents.expiryDate,afterDays(today,c.documentDays)),c.includeOverdue?undefined:gte(documents.expiryDate,today),notRecentlySent('document_expiry',sql`${documents.id}`,sql`${users.id}`,sql`${documents.expiryDate}`))).orderBy(documents.expiryDate,documents.id).limit(budget);
      for(const row of rows)if(await enqueue(row.userId,`Document reminder: ${row.documentType} ${row.expiryDate<today?'expired on':'expires on'} ${row.expiryDate}.`,'document_expiry',row.id,row.expiryDate,'/documents'))summary.documents++;
    }
    if(c.enabled&&c.notifyTraining){
      const rows=await tx.select({id:learningEnrollments.id,userId:users.id,title:sql<string>`(${learningEnrollments.courseSnapshot}->>'title')`,dueDate:learningEnrollments.dueDate}).from(learningEnrollments).innerJoin(employees,eq(learningEnrollments.employeeId,employees.id)).innerJoin(users,eq(employees.userId,users.id))
        .where(and(eligibleRecipient,inArray(learningEnrollments.status,['requested','approved','in_progress']),isNotNull(learningEnrollments.dueDate),lte(learningEnrollments.dueDate,afterDays(today,c.trainingDays)),c.includeOverdue?undefined:gte(learningEnrollments.dueDate,today),notRecentlySent('training_completion',sql`${learningEnrollments.id}`,sql`${users.id}`,sql`${learningEnrollments.dueDate}`))).orderBy(learningEnrollments.dueDate,learningEnrollments.id).limit(budget);
      for(const row of rows)if(row.dueDate&&await enqueue(row.userId,`Training reminder: ${row.title||'assigned course'} ${row.dueDate<today?'was due':'is due'} by ${row.dueDate}.`,'training_completion',row.id,row.dueDate,'/learning'))summary.training++;
    }
    if(c.enabled&&c.notifyHandbooks){
      const rows=(await tx.execute(sql`SELECT a.id,a.due_date::text,u.id AS user_id,e.title FROM hr_handbook_assignments a JOIN hr_handbook_editions e ON e.id=a.edition_id JOIN employees p ON p.id=a.employee_id JOIN users u ON u.id=p.user_id
        WHERE a.status='pending' AND e.status='published' AND e.effective_on<=${today}::date AND p.status<>'inactive' AND u.is_active AND u.approval_status='approved'
        AND a.due_date<=${afterDays(today,c.handbookDays)}::date AND (${c.includeOverdue} OR a.due_date>=${today}::date)
        AND ${notRecentlySent('handbook_due',sql`a.id`,sql`u.id`,sql`a.due_date`)} ORDER BY a.due_date,a.id LIMIT ${budget}`)).rows;
      for(const row of rows)if(await enqueue(Number(row.user_id),`Handbook reminder: ${row.title} acknowledgement ${String(row.due_date)<today?'was due':'is due'} by ${row.due_date}.`,'handbook_due',Number(row.id),String(row.due_date),'/handbook'))summary.handbooks++;
    }
    if(c.enabled&&c.notifyEquipment){
      const rows=(await tx.execute(sql`SELECT a.id,a.due_on::text,u.id AS user_id,a.asset_snapshot->>'asset_tag' AS asset_tag FROM hr_equipment_assignments a JOIN employees p ON p.id=a.employee_id JOIN users u ON u.id=p.user_id
        WHERE a.status IN ('issued','return_requested') AND a.due_on IS NOT NULL AND p.status<>'inactive' AND u.is_active AND u.approval_status='approved'
        AND a.due_on<=${afterDays(today,c.equipmentDays)}::date AND (${c.includeOverdue} OR a.due_on>=${today}::date)
        AND ${notRecentlySent('equipment_due',sql`a.id`,sql`u.id`,sql`a.due_on`)} ORDER BY a.due_on,a.id LIMIT ${budget}`)).rows;
      for(const row of rows)if(await enqueue(Number(row.user_id),`Equipment reminder: ${row.asset_tag||'issued equipment'} return ${String(row.due_on)<today?'was due':'is due'} by ${row.due_on}. HR must confirm the return inspection.`,'equipment_due',Number(row.id),String(row.due_on),'/equipment'))summary.equipment++;
    }
    if(c.enabled&&c.notifyApprovals){
      const people=await tx.select({id:users.id,role:users.role,department:users.department}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),inArray(users.role,approvalRoles),notRecentlySent('approval_reminder',sql`0`,sql`${users.id}`,sql`''`))).orderBy(users.id);
      for(const person of people){
        if(summary.approvals>=budget)break;
        const user={userId:person.id,role:person.role,department:person.department||undefined} as any;let pendingLeave=0,pendingService=0;
        if(hasPermission(person.role,'leave_absence_management','approve')){
          const waiting=await tx.select({id:leaves.id,stage:leaves.approvalStage,snapshot:leaveSnapshots}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id)).leftJoin(leaveSnapshots,eq(leaveSnapshots.leaveId,leaves.id))
            .where(and(eq(leaves.status,'pending'),employeeScope(user,'leave_absence_management','approve'),sql`(${employees.userId} IS NULL OR ${employees.userId}<>${person.id})`,sql`NOT EXISTS(SELECT 1 FROM hr_leave_stage_decisions sd WHERE sd.leave_id=${leaves.id} AND sd.actor_id=${person.id})`));
          pendingLeave=waiting.filter(row=>{const chain=leaveApprovalChain(row.snapshot),stage=row.stage||0;return (!chain[stage]||chain[stage]===person.id)&&!chain.slice(stage+1).includes(person.id);}).length;
        }
        for(const [kind,module] of [['benefit','benefits_perks'],['expense','expense_management']] as const){
          if(!hasPermission(person.role,module,'approve'))continue;
          const [count]=await tx.select({total:sql<number>`count(*)::integer`}).from(serviceRequests).innerJoin(employees,eq(serviceRequests.employeeId,employees.id)).where(and(eq(serviceRequests.kind,kind),eq(serviceRequests.status,'submitted'),eq(serviceRequests.approverId,person.id),ne(serviceRequests.createdBy,person.id),sql`(${employees.userId} IS NULL OR ${employees.userId}<>${person.id})`,employeeScope(user,module,'approve')));pendingService+=Number(count.total);
        }
        if(pendingLeave+pendingService>0&&await enqueue(person.id,`Your approval queue: ${pendingLeave} leave request(s) and ${pendingService} benefit/expense request(s) are waiting for your review.`,'approval_reminder',0,'','/team-overview')){summary.approvals++;summary.pendingLeave+=pendingLeave;summary.pendingService+=pendingService;}
      }
    }
    await tx.execute(sql`UPDATE operational_reminder_runtime SET last_finished_at=${new Date()},notifications_created=${created},summary=${JSON.stringify(summary)}::jsonb WHERE id=1`);
    return {skipped:false,created,...summary};
  });
}
