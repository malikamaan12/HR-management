import {Router} from 'express';
import {authenticate} from '../middleware/auth';
const router=Router();
router.use(authenticate);
router.use((_req,res)=>res.status(410).set('Cache-Control','no-store').json({message:'Operational analytics are available in Reports & Analytics. Legacy custom queries and speculative employee risk scores are retired.'}));
export default router;
