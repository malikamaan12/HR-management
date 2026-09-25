import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '../db';
import {runHelpdeskAutomation} from './helpdesk-automation';
import {runOperationalReminders} from './operational-reminders';
import {runReportSchedules} from './reportWorkspace';

// Work itself retains its existing transaction/advisory locks and deduplication.
// Committed leases survive restarts; failed/crashed work becomes eligible again.
const jobs=[{name:'helpdesk',minutes:5,run:runHelpdeskAutomation},{name:'reminders',minutes:15,run:runOperationalReminders},{name:'reports',minutes:15,run:runReportSchedules}];
export async function runScheduledJobs(){
 const results:{name:string;status:string}[]=[];
 for(const job of jobs){
  const lease=randomUUID();
  const claimed=(await db.execute(sql`UPDATE scheduled_job_runtime SET lease_id=${lease}::uuid,lease_until=now()+interval '30 minutes',last_started_at=now(),last_status='running' WHERE name=${job.name} AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING name`)).rows;
  if(!claimed.length){results.push({name:job.name,status:'not_due_or_running'});continue;}
  try{
   const result=await job.run();
   if(result&&'skipped' in result&&result.skipped&&(!('reason' in result)||result.reason!=='disabled'))throw new Error('Existing worker owns the job');
   if(result&&'failed' in result&&Number(result.failed)>0)throw new Error('One or more scheduled reports failed');
   await db.execute(sql`UPDATE scheduled_job_runtime SET lease_id=NULL,lease_until=NULL,last_finished_at=now(),last_status='succeeded',consecutive_failures=0,next_run_at=now()+${job.minutes}*interval '1 minute' WHERE name=${job.name} AND lease_id=${lease}::uuid`);
   results.push({name:job.name,status:'succeeded'});
  }catch{
   await db.execute(sql`UPDATE scheduled_job_runtime SET lease_id=NULL,lease_until=NULL,last_finished_at=now(),last_status='failed',consecutive_failures=consecutive_failures+1,next_run_at=now()+interval '1 minute' WHERE name=${job.name} AND lease_id=${lease}::uuid`);
   results.push({name:job.name,status:'failed'});
  }
 }
 return results;
}
