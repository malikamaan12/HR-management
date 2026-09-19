import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db';
import { positiveId } from '@shared/hr-rules';
import { commManager, commPublisher, pageQuery } from '@shared/communications';
import { recordHandler, WorkflowError } from '../services/workflowRecords';
import { bulletin, canPublishAudience, channelScope, channelManage, searchTerm } from '../services/communications';
import { eligibleRecipient, recipientAudience, bulletinManagement, bulletinStage, bulletinVisible } from '../services/bulletins';

// This router is mounted behind the shared Hub authentication and employment guards.
const router = Router();
const page = (rows: any[]) => ({ items: rows.slice(0, 25), hasMore: rows.length > 25 });
router.get('/bulletins/overview', recordHandler(async (req, res) => {
  const mine = (await db.execute(sql`SELECT count(*)::int AS all,
    count(*) FILTER(WHERE r.read_at IS NULL)::int AS unread,
    count(*) FILTER(WHERE b.requires_acknowledgement AND r.acknowledged_at IS NULL)::int AS needs_ack,
    count(*) FILTER(WHERE b.pinned)::int AS pinned
    FROM comm_bulletins b LEFT JOIN comm_bulletin_receipts r ON r.bulletin_id=b.id AND r.user_id=${req.user.userId}
    WHERE ${bulletinVisible(req.user)}`)).rows[0];
  const managed = commManager(req.user.role) ? (await db.execute(sql`SELECT ${bulletinStage()} AS stage,count(*)::int AS total FROM comm_bulletins b WHERE ${bulletinManagement(req.user)} GROUP BY ${bulletinStage()}`)).rows : [];
  res.json({ mine, managed: Object.fromEntries(managed.map((r: any) => [r.stage, r.total])) });
}));

router.get('/bulletins/audience-options', recordHandler(async (req, res) => {
  const q = pageQuery.extend({ kind: z.enum(['department', 'channel']) }).parse(req.query);
  if (!commManager(req.user.role)) throw new WorkflowError(403, 'Publishing access required');
  if (q.kind === 'department') {
    if (!commPublisher(req.user.role) && req.user.role !== 'hr_manager') throw new WorkflowError(403, 'Department publishing access required');
    res.json(page((await db.execute(sql`SELECT DISTINCT u.department AS id,u.department AS name FROM users u WHERE ${eligibleRecipient()} AND coalesce(u.department,'')<>'' AND (${commPublisher(req.user.role)} OR u.department=${req.user.department || ''}) AND u.department ILIKE ${searchTerm(q.q)} ORDER BY u.department LIMIT 26 OFFSET ${q.offset}`)).rows));
  } else {
    res.json(page((await db.execute(sql`SELECT c.id::text AS id,c.name FROM comm_channels c WHERE c.archived_at IS NULL AND ${channelScope(sql`${req.user.userId}`, req.user.role)} AND (${channelManage(req.user.userId, req.user.role)}) AND c.name ILIKE ${searchTerm(q.q)} ORDER BY c.name,c.id LIMIT 26 OFFSET ${q.offset}`)).rows));
  }
}));

router.get('/bulletins/audience-preview', recordHandler(async (req, res) => {
  const q = z.object({ audience: z.enum(['all', 'department', 'role', 'channel']), target: z.string().max(150).default('') }).strict().parse(req.query);
  if (q.audience === 'all' ? !!q.target : !q.target) throw new WorkflowError(400, 'Choose an audience and its target');
  await canPublishAudience(db, req.user, q.audience, q.target);
  res.json((await db.execute(sql`SELECT count(*)::int AS eligible FROM users u WHERE ${eligibleRecipient()} AND (${recipientAudience(q.audience, q.target)})`)).rows[0]);
}));

router.get('/bulletins/:id/recipients', recordHandler(async (req, res) => {
  const b = await bulletin(db, req.user, positiveId.parse(req.params.id), true);
  const q = pageQuery.extend({ filter: z.enum(['all', 'unread', 'read', 'pending', 'acknowledged']).default('all') }).parse(req.query);
  const scope = sql`${eligibleRecipient()} AND (${recipientAudience(b.audience, b.target)})`;
  const totals = (await db.execute(sql`SELECT count(*)::int AS eligible,count(r.read_at)::int AS read,count(r.acknowledged_at)::int AS acknowledged FROM users u LEFT JOIN comm_bulletin_receipts r ON r.user_id=u.id AND r.bulletin_id=${b.id} WHERE ${scope}`)).rows[0];
  const rows = (await db.execute(sql`SELECT u.id,u.first_name||' '||u.last_name AS name,u.department,r.read_at,r.acknowledged_at FROM users u LEFT JOIN comm_bulletin_receipts r ON r.user_id=u.id AND r.bulletin_id=${b.id}
    WHERE ${scope} AND (u.first_name||' '||u.last_name) ILIKE ${searchTerm(q.q)}
    AND (${q.filter !== 'unread'} OR r.read_at IS NULL) AND (${q.filter !== 'read'} OR r.read_at IS NOT NULL)
    AND (${q.filter !== 'pending'} OR ${b.requires_acknowledgement} AND r.acknowledged_at IS NULL)
    AND (${q.filter !== 'acknowledged'} OR r.acknowledged_at IS NOT NULL)
    ORDER BY u.first_name,u.last_name,u.id LIMIT 26 OFFSET ${q.offset}`)).rows;
  res.json({ ...page(rows), totals });
}));

router.post('/inbox/read', recordHandler(async (req, res) => {
  const input = z.object({ ids: z.array(positiveId).min(1).max(25) }).strict().parse(req.body);
  const ids = [...new Set(input.ids)];
  res.json(await db.transaction(async tx => {
    const owned = (await tx.execute(sql`SELECT id FROM notifications WHERE user_id=${req.user.userId} AND id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)}) FOR UPDATE`)).rows;
    if (owned.length !== ids.length) throw new WorkflowError(404, 'One or more reminders are no longer available');
    await tx.execute(sql`INSERT INTO comm_notification_reads(notification_id,user_id) SELECT id,user_id FROM notifications WHERE user_id=${req.user.userId} AND id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)}) ON CONFLICT DO NOTHING`);
    return { ok: true, marked: ids.length };
  }));
}));

router.post('/inbox/:id/unread', recordHandler(async (req, res) => {
  z.object({}).strict().parse(req.body);
  const id = positiveId.parse(req.params.id);
  if (!(await db.execute(sql`SELECT id FROM notifications WHERE id=${id} AND user_id=${req.user.userId}`)).rows.length) throw new WorkflowError(404, 'Reminder not found');
  await db.execute(sql`DELETE FROM comm_notification_reads WHERE notification_id=${id} AND user_id=${req.user.userId}`);
  res.json({ ok: true });
}));
export default router;
