import { Router } from 'express';
import { positiveId } from '@shared/hr-rules';
import { operationsTrainingList, operationsTrainingUpdate } from '@shared/operations-training';
import { db } from '../db';
import { authenticate, authorize } from '../middleware/auth';
import { operationsTrainingCatalogue, publishOperationsTrainingRequirements } from '../services/operations-training';
import { handle } from './hr-rules';

const router = Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(authenticate);
router.use(authorize(['admin', 'super_admin']));
router.get('/courses', handle(async (req, res) => {
  res.json(await operationsTrainingCatalogue(db, req.user!, operationsTrainingList.parse(req.query)));
}));
router.post('/courses/:id/requirements', handle(async (req, res) => {
  const id = positiveId.parse(req.params.id), input = operationsTrainingUpdate.parse(req.body);
  res.json(await db.transaction(tx => publishOperationsTrainingRequirements(tx, req.user!, id, input)));
}));
export default router;
