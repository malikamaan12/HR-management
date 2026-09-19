import {Router} from 'express';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {rateLimit} from 'express-rate-limit';
import {db} from '../db';
import {activityLogs} from '@shared/schema';
import {positiveId} from '@shared/hr-rules';
import {pageQuery,chatReactions} from '@shared/communications';
import {channel,channelScope,policy,searchTerm,liveBulletin,bulletinAudience} from '../services/communications';
import {chatColumns,safeChatMessage} from '../services/chat';
import {recordHandler,WorkflowError} from '../services/workflowRecords';

// Mounted after the existing authentication and current-employment guards.
const router=Router(),page=(rows:any[])=>({items:rows.slice(0,25).map(safeChatMessage),hasMore:rows.length>25});
router.get('/summary',recordHandler(async(req,res)=>{
 const days=(await policy(db)).definition.historyDays;
 const row=(await db.execute(sql`SELECT
 (SELECT count(*)::int FROM comm_channels c LEFT JOIN comm_channel_state st ON st.channel_id=c.id AND st.user_id=${req.user.userId} WHERE ${channelScope(sql`${req.user.userId}`,req.user.role)} AND NOT coalesce(st.muted,false) AND c.archived_at IS NULL AND EXISTS(SELECT 1 FROM comm_messages m WHERE m.channel_id=c.id AND m.author_id<>${req.user.userId} AND m.id>coalesce(st.last_read_id,0) AND m.retracted_at IS NULL AND m.created_at>=now()-${days}*interval '1 day')) AS "unreadConversations",
 (SELECT count(*)::int FROM comm_messages m JOIN comm_channels c ON c.id=m.channel_id LEFT JOIN comm_channel_state st ON st.channel_id=c.id AND st.user_id=${req.user.userId} WHERE ${channelScope(sql`${req.user.userId}`,req.user.role)} AND m.author_id<>${req.user.userId} AND m.id>coalesce(st.last_read_id,0) AND m.mentions @> ${JSON.stringify([req.user.userId])}::jsonb AND m.retracted_at IS NULL AND m.created_at>=now()-${days}*interval '1 day') AS mentions,
 (SELECT count(*)::int FROM comm_bulletins b WHERE ${liveBulletin()} AND (${bulletinAudience(req.user)}) AND b.requires_acknowledgement AND NOT EXISTS(SELECT 1 FROM comm_bulletin_receipts r WHERE r.bulletin_id=b.id AND r.user_id=${req.user.userId} AND r.acknowledged_at IS NOT NULL)) AS "pendingAcknowledgements",
 (SELECT count(*)::int FROM notifications n WHERE n.user_id=${req.user.userId} AND NOT EXISTS(SELECT 1 FROM comm_notification_reads r WHERE r.notification_id=n.id AND r.user_id=${req.user.userId})) AS "unreadActions"`)).rows[0];res.json(row);
}));
router.get('/search',recordHandler(async(req,res)=>{
 const q=pageQuery.extend({mode:z.enum(['all','saved','files']).default('all')}).parse(req.query),days=(await policy(db)).definition.historyDays;
 if(q.mode==='all'&&q.q.length<2)throw new WorkflowError(400,'Enter at least two characters to search messages');
 const rows=(await db.execute(sql`SELECT m.*,u.first_name||' '||u.last_name AS author_name,c.name AS channel_name,${chatColumns(req.user.userId,days)} FROM comm_messages m JOIN comm_channels c ON c.id=m.channel_id JOIN users u ON u.id=m.author_id
 WHERE ${channelScope(sql`${req.user.userId}`,req.user.role)} AND m.retracted_at IS NULL AND m.created_at>=now()-${days}*interval '1 day'
 AND (m.body ILIKE ${searchTerm(q.q)} OR m.attachment_name ILIKE ${searchTerm(q.q)})
 AND (${q.mode!=='saved'} OR EXISTS(SELECT 1 FROM comm_saved_messages s WHERE s.message_id=m.id AND s.user_id=${req.user.userId}))
 AND (${q.mode!=='files'} OR m.attachment_key IS NOT NULL) ORDER BY m.id DESC LIMIT 26 OFFSET ${q.offset}`)).rows;res.json(page(rows));
}));
router.get('/channels/:id/messages/:messageId/replies',recordHandler(async(req,res)=>{
 const c=await channel(db,req.user,positiveId.parse(req.params.id)),mid=positiveId.parse(req.params.messageId),q=pageQuery.parse(req.query);
 const root=(await db.execute(sql`SELECT m.*,u.first_name||' '||u.last_name AS author_name,${chatColumns(req.user.userId,c.policy.historyDays)} FROM comm_messages m JOIN users u ON u.id=m.author_id WHERE m.channel_id=${c.id} AND m.id=${mid} AND m.created_at>=now()-${c.policy.historyDays}*interval '1 day'`)).rows[0];
 if(!root)throw new WorkflowError(404,'This message is no longer available');
 const replies=(await db.execute(sql`SELECT m.*,u.first_name||' '||u.last_name AS author_name,${chatColumns(req.user.userId,c.policy.historyDays)} FROM comm_messages m JOIN users u ON u.id=m.author_id WHERE m.channel_id=${c.id} AND m.reply_to=${mid} AND m.created_at>=now()-${c.policy.historyDays}*interval '1 day' ORDER BY m.id DESC LIMIT 26 OFFSET ${q.offset}`)).rows;
 res.json({root:safeChatMessage(root),...page(replies)});
}));
const interactionLimit=rateLimit({windowMs:60000,limit:120,keyGenerator:req=>String(req.user!.userId),standardHeaders:'draft-8',legacyHeaders:false});
router.post('/channels/:id/messages/:messageId/:action(reaction|save|pin)',interactionLimit,recordHandler(async(req,res)=>{
 const action=req.params.action,input=z.object({active:z.boolean(),...(action==='reaction'?{emoji:z.enum(chatReactions)}:{})}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{
  const c=await channel(tx,req.user,positiveId.parse(req.params.id),true),mid=positiveId.parse(req.params.messageId);
  const m=(await tx.execute(sql`SELECT id FROM comm_messages WHERE id=${mid} AND channel_id=${c.id} AND retracted_at IS NULL AND created_at>=now()-${c.policy.historyDays}*interval '1 day' FOR UPDATE`)).rows[0];
  if(!m)throw new WorkflowError(404,'This message is no longer available');
  if(action==='save'){
   if(input.active)await tx.execute(sql`INSERT INTO comm_saved_messages(message_id,user_id) VALUES(${mid},${req.user.userId}) ON CONFLICT DO NOTHING`);
   else await tx.execute(sql`DELETE FROM comm_saved_messages WHERE message_id=${mid} AND user_id=${req.user.userId}`);
  }else if(action==='reaction'){
   if(!c.can_post)throw new WorkflowError(403,'Reactions are unavailable in this read-only conversation');
   if(input.active)await tx.execute(sql`INSERT INTO comm_message_reactions(message_id,user_id,emoji) VALUES(${mid},${req.user.userId},${input.emoji}) ON CONFLICT DO NOTHING`);
   else await tx.execute(sql`DELETE FROM comm_message_reactions WHERE message_id=${mid} AND user_id=${req.user.userId} AND emoji=${input.emoji}`);
  }else{
   if(!c.can_manage||!c.can_post)throw new WorkflowError(403,'Only current channel managers can change pins');
   let changed:any[];
   if(input.active)changed=(await tx.execute(sql`INSERT INTO comm_pinned_messages(message_id,pinned_by) VALUES(${mid},${req.user.userId}) ON CONFLICT DO NOTHING RETURNING message_id`)).rows;
   else changed=(await tx.execute(sql`DELETE FROM comm_pinned_messages WHERE message_id=${mid} RETURNING message_id`)).rows;
   if(changed.length)await tx.insert(activityLogs).values({userId:req.user.userId,action:'update',entityType:'comm_message_pin',entityId:mid,details:input.active?'Pinned a conversation message':'Unpinned a conversation message'});
  }
  return {ok:true};
 }));
}));
export default router;
