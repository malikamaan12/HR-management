import {Router} from 'express';
import {z} from 'zod';
import {civilDate} from '@shared/hr-rules';
import {authenticate} from '../middleware/auth';
import {businessToday,isRuleAdmin} from '../services/hr-rules';
import {operationsSetup} from '../services/operations-setup';
import {fail} from '../services/workforce';
import {handle} from './hr-rules';

const router=Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.use(authenticate);
router.get('/',handle(async(req,res)=>{
  if(!isRuleAdmin(req.user!))fail(403,'Administrator access is required for operational setup');
  const query=z.object({asOf:civilDate.optional()}).strict().parse(req.query);
  res.json(await operationsSetup(query.asOf||businessToday()));
}));
export default router;
