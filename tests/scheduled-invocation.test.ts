import {expect,test,vi} from 'vitest';
import {invokeScheduledJobs} from '../scripts/invoke-scheduled-jobs.mjs';
const environment={APP_URL:'https://example.test',SCHEDULER_SECRET:'synthetic-private-scheduler-secret-32'};
const jobs=[{name:'helpdesk',status:'succeeded'},{name:'reminders',status:'not_due_or_running'},{name:'reports',status:'succeeded'}];
test('scheduler invocation confines credentials to an HTTPS origin and rejects redirects',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({jobs})});
 expect(await invokeScheduledJobs(environment,fetcher)).toEqual(jobs);
 const [url,init]=fetcher.mock.calls[0];expect(String(url)).toBe('https://example.test/internal/scheduled-jobs');expect(init.redirect).toBe('error');expect(init.method).toBe('POST');expect(init.headers.Authorization).toBe('Bearer '+environment.SCHEDULER_SECRET);
 for(const APP_URL of ['http://example.test','https://name:password@example.test','https://example.test/path','https://example.test?secret=private'])await expect(invokeScheduledJobs({...environment,APP_URL},fetcher)).rejects.toThrow('HTTPS');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
test('scheduler failures are non-successful and never reflect private response content',async()=>{
 await expect(invokeScheduledJobs(environment,async()=>({ok:false,status:503,text:async()=>environment.SCHEDULER_SECRET}))).rejects.toThrow('HTTP 503');
 await expect(invokeScheduledJobs(environment,async()=>{throw Error(environment.SCHEDULER_SECRET);})).rejects.toThrow('failed or timed out');
 for(const result of [{jobs:[]},{jobs:[jobs[0],jobs[0],jobs[2]]},{jobs:[...jobs.slice(0,2),{name:'reports',status:'failed'}]}])await expect(invokeScheduledJobs(environment,async()=>({ok:true,json:async()=>result}))).rejects.toThrow('incomplete or unsuccessful');
});
