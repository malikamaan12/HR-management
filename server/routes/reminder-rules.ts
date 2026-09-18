import {Router} from 'express';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {operationalReminderConfig} from '@shared/reminders';
import {operationalReminderPolicy} from '../services/operational-reminders';
import {recordHandler,recordHistory,requireAdmin,WorkflowError} from '../services/workflowRecords';

const router=Router();
router.use(authenticate);
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/',recordHandler(async(req,res)=>{
  requireAdmin(req);
  const policy=await operationalReminderPolicy(db);
  const runtime=(await db.execute(sql`SELECT * FROM operational_reminder_runtime WHERE id=1`)).rows[0]||null;
  const recent=(await db.execute(sql`SELECT kind,count(*)::integer AS count,max(created_at) AS last_created_at FROM operational_reminder_deliveries WHERE created_at>=now()-interval '7 days' GROUP BY kind ORDER BY kind`)).rows;
  res.json({policy,runtime,recent});
}));
router.post('/',recordHandler(async(req,res)=>{
  requireAdmin(req);
  const input=z.object({version:z.number().int().min(0),config:operationalReminderConfig,reason:z.string().trim().min(5).max(2000)}).strict().parse(req.body);
  const row=await db.transaction(async tx=>{
    await tx.execute(sql`LOCK TABLE operational_reminder_policies IN SHARE ROW EXCLUSIVE MODE`);
    const current=await operationalReminderPolicy(tx);
    if(input.version!==current.version)throw new WorkflowError(409,'Reminder rules changed. Reload before saving your revision.');
    const created=(await tx.execute(sql`INSERT INTO operational_reminder_policies(version,config,created_by,reason) VALUES(${current.version+1},${JSON.stringify(input.config)}::jsonb,${req.user.userId},${input.reason}) RETURNING *`)).rows[0];
    await recordHistory(tx,req,'operational_reminder_policy',created,input.reason);return created;
  });res.status(201).json(row);
}));
router.get('/history',recordHandler(async(req,res)=>{
  requireAdmin(req);const offset=z.coerce.number().int().min(0).max(1000000).default(0).parse(req.query.offset);
  const items=(await db.execute(sql`SELECT id,version,config,created_by,reason,created_at FROM operational_reminder_policies ORDER BY version DESC LIMIT 25 OFFSET ${offset}`)).rows;
  const total=(await db.execute(sql`SELECT count(*)::integer AS total FROM operational_reminder_policies`)).rows[0].total;
  res.json({items,total});
}));
export default router;
