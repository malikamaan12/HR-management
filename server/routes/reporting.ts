import {Router} from 'express';
import {authenticate} from '../middleware/auth';
import snapshots from './reportSnapshots';
const router=Router();
router.use(authenticate);
router.use('/snapshots',snapshots);
router.use((_req,res)=>res.status(410).set('Cache-Control','no-store').json({message:'Use the Reports & Analytics workspace and its saved snapshots. Legacy report endpoints are retired.'}));
export default router;
