import {Router} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {runScheduledJobs} from '../services/scheduled-jobs';
const router=Router();
router.post('/',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const secret=process.env.SCHEDULER_SECRET||'',supplied=req.get('authorization')||'';
 if(secret.length<32){res.status(503).json({message:'External scheduler is not configured'});return;}
 const expected=Buffer.from('Bearer '+secret),actual=Buffer.from(supplied);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.status(401).json({message:'Unauthorized'});return;}
 try{const jobs=await runScheduledJobs();res.status(jobs.some(j=>j.status==='failed')?503:200).json({jobs});}
 catch{res.status(503).json({message:'Scheduled jobs could not run'});}
});
export default router;
