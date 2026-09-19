import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { db } from '../db';
import { userRoleEnum } from '@shared/schema';
import { authenticate } from '../middleware/auth';
import { requireCommunicationAccess } from '../middleware/communicationsAccess';
import { positiveId, reason } from '@shared/hr-rules';
import { commAdmin, commManager, commPublisher, channelInput, memberInput, messageInput, bulletinInput, versionReason, pageQuery, communicationPolicy } from '@shared/communications';
import { WorkflowError, recordHandler, recordHistory } from '../services/workflowRecords';
import { policy, channel, channelScope, channelManage, directWritable, teamGrant, activePerson, directoryScope, requireContact, bulletinAudience, liveBulletin, canPublishAudience, bulletin, safeMessage, searchTerm, notificationLink } from '../services/communications';
import { uploadCommunicationFile, deleteCommunicationFile, communicationFileUrl, validateDocumentFile, StorageUnavailableError } from '../services/r2';

const router = Router();
router.use(authenticate);
router.use(requireCommunicationAccess);
const sameVersion = (row: any, version: number) => { if (Number(row.version) !== version) throw new WorkflowError(409, 'This record changed; reload before continuing'); };
const page = (rows: any[]) => ({ items: rows.slice(0, 25), hasMore: rows.length > 25 });
const sendLimit = rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => String(req.user!.userId), standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Wait a moment before sending more messages' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, fieldSize: 15000 } }).single('file');

router.get('/context', recordHandler(async (req, res) => res.json({ userId: req.user.userId, department: req.user.department, roles: userRoleEnum.enumValues, canManage: commManager(req.user.role), canPublishCompany: commPublisher(req.user.role), canPublishDepartment: commPublisher(req.user.role) || req.user.role === 'hr_manager' && !!req.user.department, canConfigure: commAdmin(req.user.role), policy: await policy(db) })));
router.get('/directory', recordHandler(async (req, res) => {
  const q = pageQuery.parse(req.query);
  res.json(page((await db.execute(sql`SELECT u.id,u.first_name || ' ' || u.last_name AS name,u.department FROM users u WHERE ${directoryScope(req.user)} AND (u.first_name || ' ' || u.last_name) ILIKE ${searchTerm(q.q)} ORDER BY u.first_name,u.id LIMIT 26 OFFSET ${q.offset}`)).rows));
}));
router.get('/teams', recordHandler(async (req, res) => {
  const q = pageQuery.parse(req.query);
  res.json(page((await db.execute(sql`SELECT t.id,t.name,t.kind FROM workforce_teams t WHERE (${commPublisher(req.user.role)} OR ${teamGrant(sql`t.id`, sql`${req.user.userId}`, true)}) AND t.name ILIKE ${searchTerm(q.q)} ORDER BY t.name,t.id LIMIT 26 OFFSET ${q.offset}`)).rows));
}));
router.put('/policy', recordHandler(async (req, res) => {
  if (!commAdmin(req.user.role)) throw new WorkflowError(403, 'Administrator access required');
  const input = z.object({ version: z.number().int().nonnegative(), definition: communicationPolicy, reason }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    await tx.execute(sql`LOCK TABLE comm_policies IN SHARE ROW EXCLUSIVE MODE`);
    const current = await policy(tx); sameVersion(current, input.version);
    const row = (await tx.execute(sql`INSERT INTO comm_policies(version,definition,created_by) VALUES(${input.version + 1},${JSON.stringify(input.definition)}::jsonb,${req.user.userId}) RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_policy', row, input.reason); return row;
  }));
}));
router.get('/policy/history', recordHandler(async (req, res) => {
  if (!commAdmin(req.user.role)) throw new WorkflowError(403, 'Administrator access required');
  const q = pageQuery.parse(req.query);
  res.json(page((await db.execute(sql`SELECT version,snapshot,reason,created_at FROM hr_workflow_history WHERE kind='comm_policy' ORDER BY version DESC LIMIT 26 OFFSET ${q.offset}`)).rows));
}));

router.get('/channels', recordHandler(async (req, res) => {
  const q = pageQuery.parse(req.query), p = await policy(db);
  const rows = (await db.execute(sql`SELECT c.*,(${channelManage(req.user.userId, req.user.role)}) AS can_manage,${directWritable(req.user)} AS can_contact,coalesce(st.muted,false) AS muted,
    (SELECT count(*)::int FROM comm_messages m WHERE m.channel_id=c.id AND m.author_id<>${req.user.userId} AND m.id>coalesce(st.last_read_id,0) AND m.retracted_at IS NULL AND m.created_at>=now()-${p.definition.historyDays}*interval '1 day') AS unread,
    (SELECT count(*)::int FROM comm_messages m WHERE m.channel_id=c.id AND m.author_id<>${req.user.userId} AND m.id>coalesce(st.last_read_id,0) AND m.retracted_at IS NULL AND m.mentions @> ${JSON.stringify([req.user.userId])}::jsonb AND m.created_at>=now()-${p.definition.historyDays}*interval '1 day') AS mentions
    FROM comm_channels c LEFT JOIN comm_channel_state st ON st.channel_id=c.id AND st.user_id=${req.user.userId}
    WHERE ${channelScope(sql`${req.user.userId}`, req.user.role)} AND c.name ILIKE ${searchTerm(q.q)} ORDER BY c.archived_at NULLS FIRST,c.id DESC LIMIT 26 OFFSET ${q.offset}`)).rows;
  res.json(page(rows.map((r: any) => ({ ...r, can_post: r.can_contact && new Date(r.starts_at)<=new Date() && (!r.ends_at || new Date(r.ends_at)>new Date()) && !r.archived_at && (!r.managers_only || r.can_manage) && (r.kind !== 'direct' || p.definition.directMessages) }))));
}));
router.post('/channels', recordHandler(async (req, res) => {
  const input = channelInput.parse(req.body);
  if (!commManager(req.user.role)) throw new WorkflowError(403, 'Team channel creation requires management access');
  res.status(201).json(await db.transaction(async tx => {
    const p = await policy(tx);
    if (input.kind === 'group' && !p.definition.groupCreation) throw new WorkflowError(409, 'Group creation is disabled by the administrator');
    if (input.teamId && !(await tx.execute(sql`SELECT t.id FROM workforce_teams t WHERE t.id=${input.teamId} AND (${commPublisher(req.user.role)} OR ${teamGrant(sql`t.id`, sql`${req.user.userId}`, true)})`)).rows.length) throw new WorkflowError(404, 'Team is outside your scheduling scope');
    const row = (await tx.execute(sql`INSERT INTO comm_channels(name,description,kind,team_id,owner_id,starts_at,ends_at,managers_only) VALUES(${input.name},${input.description},${input.kind},${input.teamId},${req.user.userId},${input.startsAt},${input.endsAt},${input.managersOnly}) RETURNING *`)).rows[0];
    if (input.kind === 'group') await tx.execute(sql`INSERT INTO comm_members(channel_id,user_id,starts_at,ends_at) VALUES(${row.id},${req.user.userId},${input.startsAt},${input.endsAt})`);
    await recordHistory(tx, req, 'comm_channel', row, input.reason); return row;
  }));
}));
router.post('/direct', recordHandler(async (req, res) => {
  const input = z.object({ userId: positiveId }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    if (!(await policy(tx)).definition.directMessages) throw new WorkflowError(409, 'Direct messaging is disabled by the administrator');
    const contact = await requireContact(tx, req.user, input.userId), key = [req.user.userId, input.userId].sort((a, b) => a - b).join(':');
    await tx.execute(sql`LOCK TABLE comm_channels IN SHARE ROW EXCLUSIVE MODE`);
    const existing = (await tx.execute(sql`SELECT id FROM comm_channels WHERE direct_key=${key}`)).rows[0];
    if (existing) return existing;
    const me = (await tx.execute(sql`SELECT first_name || ' ' || last_name AS name FROM users WHERE id=${req.user.userId}`)).rows[0];
    const row = (await tx.execute(sql`INSERT INTO comm_channels(name,kind,owner_id,direct_key) VALUES(${String(me.name) + ' / ' + String(contact.name)},'direct',${req.user.userId},${key}) RETURNING *`)).rows[0];
    for (const id of [req.user.userId, input.userId]) await tx.execute(sql`INSERT INTO comm_members(channel_id,user_id) VALUES(${row.id},${id})`);
    await recordHistory(tx, req, 'comm_channel', { id: row.id, version: 1, kind: 'direct' }, 'Opened a direct conversation'); return row;
  }));
}));
router.get('/channels/:id', recordHandler(async (req, res) => res.json(await channel(db, req.user, positiveId.parse(req.params.id)))));
router.post('/channels/:id/settings', recordHandler(async (req, res) => {
  const input = versionReason.extend({ managersOnly: z.boolean(), archived: z.boolean() }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    const c = await channel(tx, req.user, positiveId.parse(req.params.id), true); sameVersion(c, input.version);
    if (!c.can_manage) throw new WorkflowError(403, 'Channel manager access required');
    const row = (await tx.execute(sql`UPDATE comm_channels SET managers_only=${input.managersOnly},archived_at=${input.archived ? sql`now()` : sql`NULL`},version=version+1 WHERE id=${c.id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_channel', row, input.reason); return row;
  }));
}));
router.get('/channels/:id/members', recordHandler(async (req, res) => {
  const c = await channel(db, req.user, positiveId.parse(req.params.id)), q = pageQuery.parse(req.query);
  res.json(page((await db.execute(sql`SELECT u.id,u.first_name || ' ' || u.last_name AS name,u.department,cm.starts_at,cm.ends_at,cm.removed_at,(${channelScope(sql`u.id`, '')}) AS current FROM users u CROSS JOIN comm_channels c LEFT JOIN comm_members cm ON cm.channel_id=c.id AND cm.user_id=u.id WHERE c.id=${c.id} AND ${activePerson('u')} AND ((${c.can_manage && c.kind === 'group'} AND cm.user_id IS NOT NULL) OR ${channelScope(sql`u.id`, '')}) AND (u.first_name || ' ' || u.last_name) ILIKE ${searchTerm(q.q)} ORDER BY u.first_name,u.id LIMIT 26 OFFSET ${q.offset}`)).rows));
}));
router.post('/channels/:id/members', recordHandler(async (req, res) => {
  const value = z.object({ version: positiveId, member: memberInput }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    const c = await channel(tx, req.user, positiveId.parse(req.params.id), true); sameVersion(c, value.version);
    if (!c.can_manage || c.kind !== 'group' || c.archived_at) throw new WorkflowError(403, 'Membership changes require an active group you manage');
    const contact = await requireContact(tx, req.user, value.member.userId);
    if (!commPublisher(req.user.role) && !(await tx.execute(sql`SELECT u.id FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.id=${contact.id} AND ((u.department=${req.user.department || ''} AND ${req.user.role === 'hr_manager' && !!req.user.department}) OR e.reporting_manager_id=(SELECT id FROM employees WHERE user_id=${req.user.userId}) OR EXISTS(SELECT 1 FROM workforce_members wm WHERE wm.employee_id=e.id AND wm.start_at<=now() AND wm.end_at>now() AND ${teamGrant(sql`wm.team_id`, sql`${req.user.userId}`, true)}))`)).rows.length) throw new WorkflowError(403, 'Invite employees only from your assigned department or team');
    if (contact.temporary && !value.member.endsAt) throw new WorkflowError(400, 'Temporary employees require a membership end date');
    await tx.execute(sql`INSERT INTO comm_members(channel_id,user_id,starts_at,ends_at) VALUES(${c.id},${contact.id},${value.member.startsAt},${value.member.endsAt}) ON CONFLICT(channel_id,user_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,removed_at=NULL`);
    const row = (await tx.execute(sql`UPDATE comm_channels SET version=version+1 WHERE id=${c.id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_channel', { ...row, memberUserId: contact.id, memberStartsAt: value.member.startsAt, memberEndsAt: value.member.endsAt }, value.member.reason); return row;
  }));
}));
router.post('/channels/:id/members/:userId/remove', recordHandler(async (req, res) => {
  const input = versionReason.parse(req.body), uid = positiveId.parse(req.params.userId);
  res.json(await db.transaction(async tx => {
    const c = await channel(tx, req.user, positiveId.parse(req.params.id), true); sameVersion(c, input.version);
    if (!c.can_manage || c.kind !== 'group' || Number(c.owner_id) === uid) throw new WorkflowError(403, 'Only group managers can remove other members');
    await tx.execute(sql`UPDATE comm_members SET removed_at=now() WHERE channel_id=${c.id} AND user_id=${uid}`);
    const row = (await tx.execute(sql`UPDATE comm_channels SET version=version+1 WHERE id=${c.id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_channel', { ...row, removedUserId: uid }, input.reason); return row;
  }));
}));
router.get('/channels/:id/history', recordHandler(async (req, res) => {
  const c = await channel(db, req.user, positiveId.parse(req.params.id)), q = pageQuery.parse(req.query);
  if (!c.can_manage) throw new WorkflowError(403, 'Channel manager access required');
  res.json(page((await db.execute(sql`SELECT version,reason,created_at FROM hr_workflow_history WHERE kind='comm_channel' AND record_id=${c.id} ORDER BY version DESC LIMIT 26 OFFSET ${q.offset}`)).rows));
}));

router.get('/channels/:id/messages', recordHandler(async (req, res) => {
  const c = await channel(db, req.user, positiveId.parse(req.params.id));
  const q = pageQuery.extend({ before: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
  const rows = (await db.execute(sql`SELECT m.*,u.first_name || ' ' || u.last_name AS author_name FROM comm_messages m JOIN users u ON u.id=m.author_id WHERE m.channel_id=${c.id} AND m.created_at>=now()-${c.policy.historyDays}*interval '1 day' AND (${!q.before} OR m.id<${q.before || 2147483647}) AND (${q.q === ''} OR (m.retracted_at IS NULL AND m.body ILIKE ${searchTerm(q.q)})) ORDER BY m.id DESC LIMIT 26`)).rows;
  res.json(page(rows.map(safeMessage)));
}));
router.post('/channels/:id/messages', sendLimit, (req, res, next) => upload(req, res, error => error ? res.status(400).json({ message: 'Attach one PDF, PNG or JPEG within the configured size limit' }) : next()), recordHandler(async (req, res) => {
  let raw = req.body;
  if (req.is('multipart/form-data')) { try { raw = JSON.parse(String(req.body.message || '{}')); } catch { throw new WorkflowError(400, 'Invalid message payload'); } }
  const input = messageInput.parse(raw), id = positiveId.parse(req.params.id);
  let uploaded: string | null = null;
  try {
    const result = await db.transaction(async tx => {
      const c = await channel(tx, req.user, id, true);
      if (!c.can_post) throw new WorkflowError(403, 'Posting is disabled for this conversation');
      if (input.body.length > c.policy.maxMessageLength) throw new WorkflowError(400, 'Message exceeds the administrator limit');
      if (req.file) {
        try { validateDocumentFile(req.file); } catch { throw new WorkflowError(400, 'Attach a valid PDF, PNG or JPEG'); }
        if (req.file.size > c.policy.attachmentMegabytes * 1024 * 1024) throw new WorkflowError(400, 'Attachment exceeds the administrator limit');
      }
      const hash = createHash('sha256').update(JSON.stringify(input)).update(req.file?.buffer || '').update(req.file?.originalname || '').digest('hex');
      const prior = (await tx.execute(sql`SELECT * FROM comm_messages WHERE channel_id=${id} AND author_id=${req.user.userId} AND request_key=${input.requestKey}`)).rows[0];
      if (prior) { if (prior.content_hash !== hash) throw new WorkflowError(409, 'This send key was already used for different content'); return safeMessage(prior); }
      if (input.replyTo && !(await tx.execute(sql`SELECT id FROM comm_messages WHERE id=${input.replyTo} AND channel_id=${id} AND retracted_at IS NULL AND created_at>=now()-${c.policy.historyDays}*interval '1 day'`)).rows.length) throw new WorkflowError(404, 'Reply target is no longer available in this conversation');
      for (const uid of [...new Set(input.mentions)]) if (!(await tx.execute(sql`SELECT u.id FROM users u CROSS JOIN comm_channels c WHERE c.id=${id} AND u.id=${uid} AND ${activePerson('u')} AND ${channelScope(sql`u.id`, '')}`)).rows.length) throw new WorkflowError(400, 'Mention only current conversation members');
      if (req.file) uploaded = await uploadCommunicationFile(id, req.file);
      const filename = req.file ? (req.file.originalname.split(/[\\/]/).pop() || 'attachment').replace(/[\x00-\x1f\x7f]/g, '').slice(0,180) : null;
      const row = (await tx.execute(sql`INSERT INTO comm_messages(channel_id,author_id,body,request_key,reply_to,mentions,attachment_key,attachment_name,attachment_size,content_hash) VALUES(${id},${req.user.userId},${input.body},${input.requestKey},${input.replyTo},${JSON.stringify([...new Set(input.mentions)])}::jsonb,${uploaded},${filename},${req.file?.size || null},${hash}) RETURNING *`)).rows[0];
      // No message body or file name in the organization-wide activity log.
      await recordHistory(tx, req, 'comm_message', { id: row.id, version: 1, channelId: id, authorId: req.user.userId }, 'Sent internal message'); return safeMessage(row);
    });
    res.status(201).json(result);
  } catch (error) {
    if (uploaded) try { await deleteCommunicationFile(uploaded); } catch { console.error('Communication upload cleanup needs operator attention for object', uploaded); }
    if (error instanceof StorageUnavailableError) throw new WorkflowError(503, 'Private storage is unavailable; send a text-only message');
    throw error;
  }
}));
router.post('/channels/:id/messages/:messageId/retract', recordHandler(async (req, res) => {
  const input = z.object({ reason }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    const c = await channel(tx, req.user, positiveId.parse(req.params.id), true), mid = positiveId.parse(req.params.messageId);
    const row = (await tx.execute(sql`SELECT * FROM comm_messages WHERE channel_id=${c.id} AND id=${mid} FOR UPDATE`)).rows[0];
    if (!row || Number(row.author_id) !== req.user.userId && !c.can_manage) throw new WorkflowError(404, 'Message not found within your withdrawal access');
    if (row.retracted_at) return { ok: true };
    await tx.execute(sql`UPDATE comm_messages SET retracted_at=now(),retracted_by=${req.user.userId},retraction_reason=${input.reason} WHERE id=${mid}`);
    await recordHistory(tx, req, 'comm_message', { id: mid, version: 2, status: 'withdrawn' }, input.reason); return { ok: true };
  }));
}));
router.get('/channels/:id/messages/:messageId/file', recordHandler(async (req, res) => {
  const c = await channel(db, req.user, positiveId.parse(req.params.id)), mid = positiveId.parse(req.params.messageId);
  const row = (await db.execute(sql`SELECT attachment_key FROM comm_messages WHERE channel_id=${c.id} AND id=${mid} AND retracted_at IS NULL AND created_at>=now()-${c.policy.historyDays}*interval '1 day'`)).rows[0];
  if (!row?.attachment_key) throw new WorkflowError(404, 'Attachment not found');
  res.redirect(await communicationFileUrl(String(row.attachment_key)));
}));
router.post('/channels/:id/state', recordHandler(async (req, res) => {
  const input = z.object({ lastReadId: z.number().int().nonnegative().optional(), muted: z.boolean().optional() }).strict().parse(req.body);
  res.json(await db.transaction(async tx => {
    const c = await channel(tx, req.user, positiveId.parse(req.params.id), true);
    if (input.lastReadId && !(await tx.execute(sql`SELECT id FROM comm_messages WHERE channel_id=${c.id} AND id=${input.lastReadId}`)).rows.length) throw new WorkflowError(400, 'Read cursor must refer to this conversation');
    await tx.execute(sql`INSERT INTO comm_channel_state(channel_id,user_id,last_read_id,muted) VALUES(${c.id},${req.user.userId},${input.lastReadId || 0},${input.muted ?? false}) ON CONFLICT(channel_id,user_id) DO UPDATE SET last_read_id=greatest(comm_channel_state.last_read_id,excluded.last_read_id),muted=coalesce(${input.muted ?? null},comm_channel_state.muted)`);
    return { ok: true };
  }));
}));

router.get('/bulletins', recordHandler(async (req, res) => {
  const q = pageQuery.extend({ managed: z.enum(['true','false']).default('false') }).strict().parse(req.query);
  const visible = sql`${liveBulletin()} AND (${bulletinAudience(req.user)})`;
  const management = sql`(${commPublisher(req.user.role)} AND (${commAdmin(req.user.role)} OR b.author_id=${req.user.userId}) AND b.audience<>'channel') OR (b.author_id=${req.user.userId} AND ((b.audience='department' AND ${req.user.role === 'hr_manager'} AND b.target=${req.user.department || ''}) OR (b.audience='channel' AND EXISTS(SELECT 1 FROM comm_channels c WHERE c.id::text=b.target AND ${channelScope(sql`${req.user.userId}`, req.user.role)} AND (${channelManage(req.user.userId, req.user.role)})))))`;
  res.json(page((await db.execute(sql`SELECT b.*,u.first_name || ' ' || u.last_name AS author_name,r.read_at,r.acknowledged_at FROM comm_bulletins b JOIN users u ON u.id=b.author_id LEFT JOIN comm_bulletin_receipts r ON r.bulletin_id=b.id AND r.user_id=${req.user.userId} WHERE (${q.managed === 'true' ? management : visible}) AND (b.title ILIKE ${searchTerm(q.q)} OR b.body ILIKE ${searchTerm(q.q)}) ORDER BY b.pinned DESC,b.publish_at DESC,b.id DESC LIMIT 26 OFFSET ${q.offset}`)).rows));
}));
router.post('/bulletins', recordHandler(async (req, res) => {
  const input = bulletinInput.parse(req.body);
  res.status(201).json(await db.transaction(async tx => {
    await canPublishAudience(tx, req.user, input.audience, input.target);
    const row = (await tx.execute(sql`INSERT INTO comm_bulletins(title,body,audience,target,status,author_id,publish_at,expires_at,requires_acknowledgement,pinned) VALUES(${input.title},${input.body},${input.audience},${input.target},'draft',${req.user.userId},${input.publishAt},${input.expiresAt},${input.requiresAcknowledgement},${input.pinned}) RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_bulletin', row, input.reason); return row;
  }));
}));
router.get('/bulletins/:id', recordHandler(async (req, res) => {
  const row = await bulletin(db, req.user, positiveId.parse(req.params.id));
  const receipt = (await db.execute(sql`SELECT read_at,acknowledged_at FROM comm_bulletin_receipts WHERE bulletin_id=${row.id} AND user_id=${req.user.userId}`)).rows[0];
  res.json({ ...row, ...receipt });
}));
router.patch('/bulletins/:id', recordHandler(async (req, res) => {
  const input = z.object({ version: positiveId, definition: bulletinInput }).strict().parse(req.body), v = input.definition;
  res.json(await db.transaction(async tx => {
    const b = await bulletin(tx, req.user, positiveId.parse(req.params.id), true, true); sameVersion(b, input.version);
    if (b.status !== 'draft') throw new WorkflowError(409, 'Published content is immutable; create a new announcement');
    await canPublishAudience(tx, req.user, v.audience, v.target);
    const row = (await tx.execute(sql`UPDATE comm_bulletins SET title=${v.title},body=${v.body},audience=${v.audience},target=${v.target},publish_at=${v.publishAt},expires_at=${v.expiresAt},requires_acknowledgement=${v.requiresAcknowledgement},pinned=${v.pinned},version=version+1 WHERE id=${b.id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_bulletin', row, v.reason); return row;
  }));
}));
router.post('/bulletins/:id/:action', recordHandler(async (req, res) => {
  const action = z.enum(['publish','archive','pin','read','acknowledge']).parse(req.params.action), id = positiveId.parse(req.params.id);
  res.json(await db.transaction(async tx => {
    const b = await bulletin(tx, req.user, id, !['read','acknowledge'].includes(action), true);
    if (action === 'read' || action === 'acknowledge') {
      z.object({}).strict().parse(req.body);
      if (!(await tx.execute(sql`SELECT b.id FROM comm_bulletins b WHERE b.id=${id} AND ${liveBulletin()} AND (${bulletinAudience(req.user)})`)).rows.length) throw new WorkflowError(409, 'This announcement is not currently addressed to you');
      if (action === 'acknowledge') {
        if (!b.requires_acknowledgement) throw new WorkflowError(409, 'Acknowledgement is not required');
        if (!(await tx.execute(sql`SELECT user_id FROM comm_bulletin_receipts WHERE bulletin_id=${id} AND user_id=${req.user.userId}`)).rows.length) throw new WorkflowError(409, 'Open and mark the announcement read before acknowledging');
        await tx.execute(sql`UPDATE comm_bulletin_receipts SET acknowledged_at=coalesce(acknowledged_at,now()) WHERE bulletin_id=${id} AND user_id=${req.user.userId}`);
      } else await tx.execute(sql`INSERT INTO comm_bulletin_receipts(bulletin_id,user_id) VALUES(${id},${req.user.userId}) ON CONFLICT DO NOTHING`);
      return { ok: true };
    }
    const input = versionReason.parse(req.body); sameVersion(b, input.version);
    if (action === 'publish' && (b.status !== 'draft' || b.expires_at && new Date(b.expires_at) <= new Date())) throw new WorkflowError(409, 'Only an unexpired draft can be published');
    if (b.status === 'archived') throw new WorkflowError(409, 'Archived announcements cannot be changed');
    const row = (await tx.execute(sql`UPDATE comm_bulletins SET status=${action === 'publish' ? 'published' : action === 'archive' ? 'archived' : b.status},pinned=${action === 'pin' ? !b.pinned : b.pinned},version=version+1 WHERE id=${id} RETURNING *`)).rows[0];
    await recordHistory(tx, req, 'comm_bulletin', row, input.reason); return row;
  }));
}));
router.get('/bulletins/:id/receipts', recordHandler(async (req, res) => {
  const b = await bulletin(db, req.user, positiveId.parse(req.params.id), true), q = pageQuery.parse(req.query);
  res.json(page((await db.execute(sql`SELECT u.first_name || ' ' || u.last_name AS name,r.read_at,r.acknowledged_at FROM comm_bulletin_receipts r JOIN users u ON u.id=r.user_id WHERE r.bulletin_id=${b.id} ORDER BY r.read_at DESC,u.id LIMIT 26 OFFSET ${q.offset}`)).rows));
}));
router.get('/inbox', recordHandler(async (req, res) => {
  const q = pageQuery.extend({ unread: z.enum(['true','false']).default('false') }).strict().parse(req.query);
  const rows = (await db.execute(sql`SELECT n.id,n.message,n.timestamp,n.channel,n.status,n.data,r.read_at FROM notifications n LEFT JOIN comm_notification_reads r ON r.notification_id=n.id AND r.user_id=${req.user.userId} WHERE n.user_id=${req.user.userId} AND (${q.unread === 'false'} OR r.read_at IS NULL) AND n.message ILIKE ${searchTerm(q.q)} ORDER BY n.id DESC LIMIT 26 OFFSET ${q.offset}`)).rows;
  res.json(page(rows.map((r: any) => { const { data, ...safe } = r; return { ...safe, url: notificationLink(data) }; })));
}));
router.post('/inbox/:id/read', recordHandler(async (req, res) => {
  z.object({}).strict().parse(req.body); const id = positiveId.parse(req.params.id);
  const row = (await db.execute(sql`INSERT INTO comm_notification_reads(notification_id,user_id) SELECT id,user_id FROM notifications WHERE id=${id} AND user_id=${req.user.userId} ON CONFLICT DO NOTHING RETURNING notification_id`)).rows[0];
  if (!row && !(await db.execute(sql`SELECT id FROM notifications WHERE id=${id} AND user_id=${req.user.userId}`)).rows.length) throw new WorkflowError(404, 'Notification not found');
  res.json({ ok: true });
}));
export default router;
