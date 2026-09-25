import {pathToFileURL} from 'node:url';

// Run from an external scheduler. Credentials belong in its secret environment.
export async function invokeScheduledJobs(environment=process.env,fetcher=fetch){
  let target;
  try { target=new URL(environment.APP_URL||''); } catch { throw new Error('APP_URL must be the deployed HTTPS application origin'); }
  if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw new Error('APP_URL must be an HTTPS origin without credentials, path or query');
  const secret=environment.SCHEDULER_SECRET||'';
  if(secret.length<32||/[\r\n]/.test(secret))throw new Error('SCHEDULER_SECRET must contain at least 32 characters and no line breaks');
  target.pathname='/internal/scheduled-jobs';
  let response;
  try { response=await fetcher(target,{method:'POST',headers:{Authorization:'Bearer '+secret,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(120000)}); }
  catch { throw new Error('Scheduled job invocation failed or timed out; inspect the application job status before retrying'); }
  if(!response.ok)throw new Error('Scheduled job endpoint returned HTTP '+response.status);
  let body;
  try { body=await response.json(); } catch { throw new Error('Scheduled job endpoint returned an invalid response'); }
  const expected=['helpdesk','reminders','reports'];
  if(!Array.isArray(body?.jobs)||body.jobs.length!==expected.length||expected.some(name=>body.jobs.filter(job=>job?.name===name).length!==1)||body.jobs.some(job=>!['succeeded','not_due_or_running'].includes(job.status)))throw new Error('Scheduled job results were incomplete or unsuccessful');
  return body.jobs.map(({name,status})=>({name,status}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try { console.log(JSON.stringify({jobs:await invokeScheduledJobs()})); }
  catch(error){ console.error(error.message);process.exitCode=1; }
}
