import {and,eq,sql} from 'drizzle-orm';
import {db} from '../db';
import {users,helpdeskCases as cases} from '@shared/schema';
import {caseScope,caseEvent} from './helpdesk';
import {helpdeskResponder} from '@shared/helpdesk';
export async function sweepHelpdeskReminders(){
 return db.transaction(async tx=>{
  const settings=await tx.execute(sql`SELECT * FROM helpdesk_reminder_policy WHERE id=1 AND enabled=true FOR UPDATE SKIP LOCKED`);const policy=settings.rows[0] as any;if(!policy)return {processed:0,created:0};
  const [actor]=await tx.select().from(users).where(eq(users.id,policy.actor_id));if(!actor?.isActive||actor.approvalStatus!=='approved'||!['admin','super_admin'].includes(actor.role))return {processed:0,created:0};
  const user={userId:actor.id,role:actor.role,department:actor.department} as any;
  const due=await tx.select().from(cases).where(and(caseScope(user),sql`${cases.status} NOT IN ('resolved','closed')`,sql`((${cases.responseDueAt}<now() AND ${cases.firstResponseAt} IS NULL AND NOT EXISTS(SELECT 1 FROM helpdesk_reminders r WHERE r.case_id=${cases.id} AND r.user_id=${cases.requesterId} AND r.kind='response' AND r.deadline=${cases.responseDueAt})) OR (${cases.resolutionDueAt}<now() AND NOT EXISTS(SELECT 1 FROM helpdesk_reminders r WHERE r.case_id=${cases.id} AND r.user_id=${cases.requesterId} AND r.kind='resolution' AND r.deadline=${cases.resolutionDueAt})))`)).orderBy(cases.id).limit(100).for('update');
  let created=0;
  for(const row of due){for(const [kind,deadline,needed] of [['response',row.responseDueAt,!row.firstResponseAt],['resolution',row.resolutionDueAt,true]] as const){if(!deadline||+deadline>=Date.now()||!needed)continue;
    const recipients=[row.requesterId];if(row.assigneeId&&row.assigneeId!==row.requesterId){const [assignee]=await tx.select().from(users).where(eq(users.id,row.assigneeId));if(assignee?.isActive&&assignee.approvalStatus==='approved'&&helpdeskResponder(assignee.role))recipients.push(assignee.id);}
    for(const recipient of recipients){const r=await tx.execute(sql`INSERT INTO helpdesk_reminders(case_id,user_id,kind,deadline) VALUES (${row.id},${recipient},${kind},${deadline}) ON CONFLICT DO NOTHING RETURNING id`);created+=r.rows.length;}
  }
  if(policy.escalate&&!row.escalatedAt){await tx.update(cases).set({escalatedAt:new Date(),updatedAt:new Date(),version:row.version+1}).where(eq(cases.id,row.id));await caseEvent(tx,user,row.id,'Escalated automatically after the saved service deadline');}
  }
  return {processed:due.length,created};
 });
}
