import {sql} from 'drizzle-orm';
import {safeMessage} from './communications';
// This projection is used only after the caller verifies channel scope and history dates.
export function chatColumns(uid:number,days:number){return sql`
 EXISTS(SELECT 1 FROM comm_saved_messages s WHERE s.message_id=m.id AND s.user_id=${uid}) AS saved,
 EXISTS(SELECT 1 FROM comm_pinned_messages p WHERE p.message_id=m.id) AS pinned,
 (SELECT count(*)::int FROM comm_messages r WHERE r.reply_to=m.id AND r.channel_id=m.channel_id AND r.created_at>=now()-${days}*interval '1 day' AND r.retracted_at IS NULL) AS reply_count,
 coalesce((SELECT jsonb_agg(r) FROM (SELECT emoji,count(*)::int AS count,bool_or(user_id=${uid}) AS mine FROM comm_message_reactions WHERE message_id=m.id GROUP BY emoji ORDER BY emoji) r),'[]'::jsonb) AS reactions,
 (SELECT jsonb_build_object('id',r.id,'body',CASE WHEN r.retracted_at IS NULL THEN left(r.body,240) ELSE 'Message withdrawn' END,'author_name',u.first_name||' '||u.last_name) FROM comm_messages r JOIN users u ON u.id=r.author_id WHERE r.id=m.reply_to AND r.channel_id=m.channel_id AND r.created_at>=now()-${days}*interval '1 day') AS reply_preview`;
}
export function safeChatMessage(row:any){const safe=safeMessage(row);return row.retracted_at?{...safe,reactions:[],pinned:false,saved:false,reply_preview:null}:safe;}
