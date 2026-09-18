import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, notifications, helpdeskCases } from '@shared/schema';
import { defaultHelpdeskAutomation, helpdeskAutomationConfig, type BusinessCalendar, type HelpdeskAutomationPolicy } from '@shared/helpdesk-automation';
import { helpdeskResponder, helpdeskTriage } from '@shared/helpdesk';
import type { WorkforceTransaction } from './workforce';

const minute=60000;
const formatters=new Map<string,Intl.DateTimeFormat>();
function localParts(instant:Date,zone:string){let formatter=formatters.get(zone);if(!formatter){formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(zone,formatter);}const parts=Object.fromEntries(formatter.formatToParts(instant).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};}
function localNumber(instant:Date,zone:string){const p=localParts(instant,zone);return Date.parse(p.date+'T00:00:00Z')+(p.hour*60+p.minute)*minute+p.second*1000;}
function addDay(date:string){return new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);}
function windowInstant(date:string,time:string,zone:string,end=false){
  const desired=Date.parse(`${date}T${time}:00Z`),offsets=new Set<number>();
  for(const delta of [-36,-24,-12,0,12,24,36]){const sample=desired+delta*3600000;offsets.add(localNumber(new Date(sample),zone)-sample);}
  // Repeated local times span their whole open window. A skipped local minute
  // advances to the first real local minute following the daylight-saving gap.
  for(let shift=0;shift<=180;shift++){const target=desired+shift*minute,candidates=[...offsets].map(offset=>target-offset).filter(candidate=>localNumber(new Date(candidate),zone)===target);if(candidates.length)return new Date(end?Math.max(...candidates):Math.min(...candidates));}
  throw new Error('Unable to resolve a business-calendar boundary');
}
function windowsFor(date:string,calendar:BusinessCalendar){if(calendar.holidays.some(holiday=>holiday.date===date))return [];const day=new Date(date+'T12:00:00Z').getUTCDay();return (calendar.week.find(item=>item.day===day)?.windows||[]).map(window=>({start:windowInstant(date,window.start,calendar.timezone),end:windowInstant(date,window.end,calendar.timezone,true)}));}
export function businessDeadline(start:Date,hours:number,calendar:BusinessCalendar){
  if(hours===0)return new Date(start);let remaining=hours*3600000,date=localParts(start,calendar.timezone).date;
  for(let day=0;day<15000;day++,date=addDay(date)){for(const window of windowsFor(date,calendar)){const begin=Math.max(+start,+window.start),available=+window.end-begin;if(available<=0)continue;if(remaining<=available)return new Date(begin+remaining);remaining-=available;}}
  throw new Error('The business calendar cannot satisfy the configured target');
}
export function helpdeskDeadline(start:Date,hours:number,policy?:HelpdeskAutomationPolicy|null){return policy?.config.clockMode==='business'?businessDeadline(start,hours,policy.config.calendar):new Date(+start+hours*3600000);}
export function helpdeskBusinessOpen(now:Date,calendar:BusinessCalendar){return windowsFor(localParts(now,calendar.timezone).date,calendar).some(window=>+now>=+window.start&&+now<+window.end);}
export async function helpdeskAutomationPolicy(tx:any):Promise<HelpdeskAutomationPolicy>{const row=(await tx.execute(sql`SELECT version,created_by,config FROM helpdesk_automation_policies ORDER BY version DESC LIMIT 1`)).rows[0];return row?{version:Number(row.version),createdBy:Number(row.created_by),config:helpdeskAutomationConfig.parse(row.config)}:{version:0,createdBy:null,config:structuredClone(defaultHelpdeskAutomation)};}
export async function pinCaseAutomation(tx:any,id:number,policy:HelpdeskAutomationPolicy){await tx.execute(sql`UPDATE helpdesk_cases SET automation_snapshot=${JSON.stringify(policy)}::jsonb,automation_next_check_at=now() WHERE id=${id}`);}
export async function caseAutomationSnapshot(tx:any,id:number):Promise<HelpdeskAutomationPolicy|null>{const row=(await tx.execute(sql`SELECT automation_snapshot FROM helpdesk_cases WHERE id=${id}`)).rows[0];return row?.automation_snapshot||null;}
export async function restartCaseAutomation(tx:any,id:number){await tx.execute(sql`UPDATE helpdesk_cases SET automation_cycle=automation_cycle+1,automation_next_check_at=now() WHERE id=${id}`);}
async function eligibleHandler(tx:any,id:number|null,confidential:boolean,requesterId:number,explicit=false){if(!id||id===requesterId)return null;const [person]=await tx.select({id:users.id,role:users.role}).from(users).where(and(eq(users.id,id),eq(users.isActive,true),eq(users.approvalStatus,'approved')));return person&&helpdeskResponder(person.role)&&(!confidential||explicit||helpdeskTriage(person.role,true))?person:null;}
async function recipients(tx:WorkforceTransaction,row:any):Promise<number[]>{const assigned=await eligibleHandler(tx,Number(row.assignee_id)||null,row.confidential,Number(row.requester_id),true);if(assigned)return [Number(assigned.id)];const roles:(typeof users.$inferSelect)['role'][]=row.confidential?['super_admin','hr_director']:['super_admin','admin','hr_director','hr'];const people=await tx.select({id:users.id}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved'),inArray(users.role,roles),ne(users.id,Number(row.requester_id)))).orderBy(users.id).limit(50);return people.map(person=>person.id);}
async function notification(tx:any,row:any,userId:number,kind:string,due:Date,occurrence:number,message:string,now:Date){
  const inserted=(await tx.execute(sql`INSERT INTO helpdesk_automation_deliveries(case_id,cycle,kind,target_due_at,occurrence,recipient_id,created_at) VALUES(${row.id},${row.automation_cycle},${kind},${due},${occurrence},${userId},${now}) ON CONFLICT DO NOTHING RETURNING id`)).rows[0];if(!inserted)return false;
  const [created]=await tx.insert(notifications).values({userId,message,channel:'push',status:'pending',data:{type:'helpdesk_reminder',caseId:row.id,url:'/helpdesk',automationKind:kind},timestamp:now,createdAt:now,updatedAt:now}).returning({id:notifications.id});await tx.execute(sql`UPDATE helpdesk_automation_deliveries SET notification_id=${created.id} WHERE id=${inserted.id}`);return true;
}
async function automatedEvent(tx:any,row:any,kind:string,details:string,now:Date){await tx.execute(sql`INSERT INTO helpdesk_automation_events(case_id,cycle,kind,details,created_at) VALUES(${row.id},${row.automation_cycle},${kind},${details},${now}) ON CONFLICT DO NOTHING`);}

// Uses the application database and in-process scheduling; no paid scheduler or
// external delivery provider is required. All delivery keys are transactional.
export async function runHelpdeskAutomation(now=new Date()){
  return db.transaction(async tx=>{
    const lock=(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(7331033) AS locked`)).rows[0];if(!lock?.locked)return {skipped:true,checked:0,notifications:0,escalated:0};
    const current=await helpdeskAutomationPolicy(tx);await tx.execute(sql`UPDATE helpdesk_automation_runtime SET last_started_at=${now},enabled=${current.config.enabled} WHERE id=1`);
    let checked=0,created=0,escalated=0;
    if(current.config.enabled){
      const rows=(await tx.execute(sql`SELECT * FROM helpdesk_cases WHERE status NOT IN ('resolved','closed') AND automation_snapshot->'config'->>'enabled'='true' AND automation_next_check_at<=${now} ORDER BY automation_next_check_at,id LIMIT 200 FOR UPDATE SKIP LOCKED`)).rows;
      for(const row of rows){checked++;const snapshot=row.automation_snapshot as unknown as HelpdeskAutomationPolicy,config=helpdeskAutomationConfig.parse(snapshot.config);await tx.execute(sql`UPDATE helpdesk_cases SET automation_next_check_at=${new Date(+now+5*minute)} WHERE id=${row.id}`);
        if(config.clockMode==='business'&&!helpdeskBusinessOpen(now,config.calendar))continue;
        const targets:{kind:string;due:Date}[]=[];if(!row.first_responded_at&&row.first_response_due_at)targets.push({kind:'first_response',due:new Date(String(row.first_response_due_at))});if(row.resolution_due_at)targets.push({kind:'resolution',due:new Date(String(row.resolution_due_at))});
        let targetsForPeople:number[]|undefined;
        for(const target of targets){if(!config.remindersEnabled||+target.due-+now>config.reminderLeadMinutes*minute)continue;targetsForPeople??=await recipients(tx,row);const overdue=+target.due<=+now,kind=target.kind+(overdue?'_overdue':'_due_soon');
          for(const userId of targetsForPeople){const previous=(await tx.execute(sql`SELECT count(*)::int AS count,max(created_at) AS last FROM helpdesk_automation_deliveries WHERE case_id=${row.id} AND cycle=${row.automation_cycle} AND kind=${kind} AND target_due_at=${target.due} AND recipient_id=${userId}`)).rows[0],count=Number(previous.count);if(count>=(overdue?config.maxOverdueReminders:1)||previous.last&&+now-+new Date(String(previous.last))<config.reminderRepeatMinutes*minute)continue;
            if(await notification(tx,row,userId,kind,target.due,count+1,`Helpdesk case #${row.id}: ${target.kind==='first_response'?'first response':'resolution'} ${overdue?'is overdue':'is due soon'}. Open your HR helpdesk queue.`,now))created++;
          }
        }
        const overdue=targets.filter(target=>+helpdeskDeadline(target.due,config.escalationDelayMinutes/60,snapshot)<=+now).sort((a,b)=>+a.due-+b.due)[0];
        if(config.autoEscalate&&!row.escalated_at&&overdue){const routing=row.policy_snapshot as {escalationAssigneeId?:number}|null,target=await eligibleHandler(tx,routing?.escalationAssigneeId||null,Boolean(row.confidential),Number(row.requester_id));
          if(!target){await automatedEvent(tx,row,'escalation_blocked','Automatic escalation is waiting for an eligible configured handler. HR triage can assign the case.',now);continue;}
          await tx.update(helpdeskCases).set({assigneeId:target.id,escalatedAt:now,status:row.status==='open'?'in_progress':row.status as any,version:Number(row.version)+1,updatedAt:now}).where(eq(helpdeskCases.id,Number(row.id)));
          await automatedEvent(tx,row,'escalated','Case automatically escalated after its saved response target was exceeded.',now);escalated++;
          if(await notification(tx,row,target.id,'escalated',overdue.due,1,`Helpdesk case #${row.id} was escalated to you. Open your HR helpdesk queue.`,now))created++;
          if(config.notifyRequesterOnEscalation){const [requester]=await tx.select({id:users.id}).from(users).where(and(eq(users.id,Number(row.requester_id)),eq(users.isActive,true),eq(users.approvalStatus,'approved')));if(requester&&await notification(tx,row,requester.id,'requester_escalated',overdue.due,1,`Your helpdesk case #${row.id} has been escalated for attention.`,now))created++;}
        }
      }
    }
    await tx.execute(sql`UPDATE helpdesk_automation_runtime SET last_finished_at=${new Date()},cases_checked=${checked},notifications_created=${created},cases_escalated=${escalated} WHERE id=1`);return {skipped:false,checked,notifications:created,escalated};
  });
}
