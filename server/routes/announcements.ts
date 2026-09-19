import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { authenticate } from '../middleware/auth';
import { requireCommunicationAccess } from '../middleware/communicationsAccess';
import { db } from '../db';
import { recordHandler } from '../services/workflowRecords';
import { bulletinAudience, liveBulletin } from '../services/communications';
const router = Router();
router.use(authenticate);
router.use(requireCommunicationAccess);
// Legacy readers use the same audience and publication boundary as the new Hub.
router.get('/', recordHandler(async(req,res)=>res.json((await db.execute(sql`SELECT b.id,b.title,b.body AS content,b.author_id AS "authorId",b.audience AS "targetAudience",b.pinned AS "isPinned",b.created_at AS "createdAt" FROM comm_bulletins b WHERE ${liveBulletin()} AND (${bulletinAudience(req.user)}) ORDER BY b.pinned DESC,b.publish_at DESC LIMIT 25`)).rows)));
router.use((_req,res)=>res.status(410).json({message:'Manage announcements through the internal Communication Hub.'}));
export default router;
