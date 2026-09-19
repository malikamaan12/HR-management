import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {sql} from 'drizzle-orm';
import {activityLogs} from '@shared/schema';
import {getAccessScope} from '@shared/permissions';
import {reportInput,datedReports,type ReportInput,type ReportKind} from '@shared/reporting';
import {db} from '../db';
import {availableReports,buildReport,reportingPolicy} from './reportSnapshots';
import {reportScopeStamp,reportScopeCovered,reportSources} from './reportAccess';
import {WorkforceError} from './workforce';
import type {TokenPayload} from './auth';
import {activePerson} from './communications';

export function requireReport(user:TokenPayload,kind?:ReportKind){
 const kinds=availableReports(user.role);
 if(!kinds.length||(kind&&!kinds.includes(kind)))throw new WorkforceError(403,'Report and source-module access required');
 return kinds;
}
export async function verifyRunScope(tx:any,user:TokenPayload,row:any){
 const kind=row.report_type as ReportKind;requireReport(user,kind);
 if(row.access_stamp){if(!reportScopeCovered(row.access_stamp,await reportScopeStamp(tx,user,kind)))throw new WorkforceError(403,'Your reporting scope changed. Generate a new snapshot with your current access.');}
 else if(getAccessScope(user.role,'reports_analytics')!=='all'||getAccessScope(user.role,reportSources[kind])!=='all')throw new WorkforceError(403,'This older organization-wide snapshot is outside your current scope');
}
export async function saveReport(tx:any,user:TokenPayload,input:ReportInput){
 requireReport(user,input.kind);
 const old=(await tx.execute(sql`SELECT * FROM report_runs WHERE owner_id=${user.userId} AND request_key=${input.requestKey}`)).rows[0];
 if(old){if(old.report_type!==input.kind||!isDeepStrictEqual(old.snapshot.filters,input.filters)||!!old.snapshot.comparison!==!!input.comparePrevious)throw new WorkforceError(409,'This request key belongs to a different report');await verifyRunScope(tx,user,old);return {id:old.id,report_type:old.report_type,created_at:old.created_at,snapshot:old.snapshot};}
 const snapshot=await buildReport(tx,input,user),stamp=await reportScopeStamp(tx,user,input.kind);
 const run=(await tx.execute(sql`INSERT INTO report_runs(owner_id,request_key,report_type,filters,snapshot,access_stamp) VALUES (${user.userId},${input.requestKey},${input.kind},${JSON.stringify(input.filters)}::jsonb,${JSON.stringify(snapshot)}::jsonb,${stamp}) RETURNING id,report_type,created_at,snapshot`)).rows[0];
 await tx.insert(activityLogs).values({userId:user.userId,action:'create',entityType:'report_run',entityId:Number(run.id),details:'Generated '+input.kind+' snapshot'});
 return run;
}
export async function ownReport(tx:any,user:TokenPayload,id:number){
 const row=(await tx.execute(sql`SELECT * FROM report_runs WHERE id=${id} AND owner_id=${user.userId}`)).rows[0];
 if(!row)throw new WorkforceError(404,'Report not found');await verifyRunScope(tx,user,row);return row;
}
// Completed calendar periods in Asia/Qatar. Weekly periods run Sunday–Saturday.
export function scheduledPeriod(cadence:'daily'|'weekly'|'monthly',hour:number,now=new Date()){
 const local=new Date(now.getTime()+3*3600000);if(local.getUTCHours()<hour)return null;
 const end=new Date(local.toISOString().slice(0,10)+'T00:00:00Z');let start:Date;
 if(cadence==='monthly'){end.setUTCDate(1);start=new Date(end);start.setUTCMonth(start.getUTCMonth()-1);}
 else if(cadence==='weekly'){end.setUTCDate(end.getUTCDate()-end.getUTCDay());start=new Date(end);start.setUTCDate(start.getUTCDate()-7);}
 else{start=new Date(end);start.setUTCDate(start.getUTCDate()-1);}
 end.setUTCDate(end.getUTCDate()-1);return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
}
export async function runReportSchedules(now=new Date(),ownerId?:number){
 return db.transaction(async tx=>{
  const lock=(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(7331044) AS locked`)).rows[0];
  if(!lock.locked||!(await reportingPolicy(tx)).config.schedulesEnabled)return {created:0,failed:0,skipped:true};
  const jobs=(await tx.execute(sql`SELECT * FROM analytics_schedules WHERE enabled AND (${!ownerId} OR owner_id=${ownerId||0}) AND (last_attempt_at IS NULL OR last_attempt_at<${now.toISOString()}::timestamptz-interval '30 minutes') ORDER BY last_attempt_at NULLS FIRST,id LIMIT 10 FOR UPDATE SKIP LOCKED`)).rows;
  let created=0,failed=0;
  for(const row of jobs){
   // Advance the scan even for a completed job so older jobs cannot starve the queue.
   await tx.execute(sql`UPDATE analytics_schedules SET last_attempt_at=${now.toISOString()}::timestamptz WHERE id=${row.id}`);
   const definition=row.definition as any,period=scheduledPeriod(definition.cadence,definition.hour,now);if(!period)continue;
   const key='v'+row.version+':'+definition.cadence+':'+period.to;
   if(row.last_period===key)continue;
   await tx.execute(sql`SAVEPOINT analytics_job`);
   try{
    const owner=(await tx.execute(sql`SELECT u.* FROM users u WHERE u.id=${row.owner_id} AND ${activePerson('u')}`)).rows[0];
    if(!owner)throw new WorkforceError(403,'Schedule paused because its owner is no longer active');
    const user={userId:owner.id,username:owner.username,role:owner.role,department:owner.department,email:owner.email} as TokenPayload;
    const input=reportInput.parse({kind:definition.kind,filters:{...definition.filters,...(datedReports.includes(definition.kind)?period:{})},requestKey:randomUUID()});
    const run=await saveReport(tx,user,input);
    await tx.execute(sql`INSERT INTO analytics_schedule_runs(schedule_id,period_key,report_run_id,status) VALUES (${row.id},${key},${run.id},'completed') ON CONFLICT(schedule_id,period_key) DO UPDATE SET report_run_id=excluded.report_run_id,status='completed',error=NULL,created_at=now()`);
    await tx.execute(sql`UPDATE analytics_schedules SET last_period=${key},last_run_id=${run.id},last_error=NULL WHERE id=${row.id}`);
    await tx.execute(sql`RELEASE SAVEPOINT analytics_job`);created++;
   }catch(error){
    await tx.execute(sql`ROLLBACK TO SAVEPOINT analytics_job`);await tx.execute(sql`RELEASE SAVEPOINT analytics_job`);
    const denied=error instanceof WorkforceError&&error.status===403,message=error instanceof WorkforceError?error.message:'Report generation failed. Review filters or contact your administrator.';
    await tx.execute(sql`INSERT INTO analytics_schedule_runs(schedule_id,period_key,status,error) VALUES (${row.id},${key},'failed',${message}) ON CONFLICT(schedule_id,period_key) DO UPDATE SET status='failed',error=excluded.error,created_at=now()`);
    await tx.execute(sql`UPDATE analytics_schedules SET last_error=${message},enabled=CASE WHEN ${denied} THEN false ELSE enabled END WHERE id=${row.id}`);failed++;
   }
  }
  return {created,failed,skipped:false};
 },{isolationLevel:'repeatable read'});
}
