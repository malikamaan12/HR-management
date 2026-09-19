import { sql } from 'drizzle-orm';
import { userRoleEnum } from '@shared/schema';
import { canAccessModule } from '@shared/permissions';
import { commAdmin, commPublisher } from '@shared/communications';
import type { TokenPayload } from './auth';
import { activePerson, channelScope, channelManage, liveBulletin, bulletinAudience } from './communications';

const recipientRoles = userRoleEnum.enumValues.filter(role => canAccessModule(role, 'communication_hub'));
export const eligibleRecipient = () => sql`${activePerson('u')} AND u.account_state='active' AND NOT u.password_setup_required AND u.role IN (${sql.join(recipientRoles.map(role => sql`${role}`), sql`,`)})`;

// Evaluate the same audience rules against each recipient's current work identity.
// This is a current audience estimate, not a frozen publication-time delivery list.
export function recipientAudience(audience: string, target: string) {
  if (audience === 'all') return sql`true`;
  if (audience === 'department') return sql`u.department=${target} AND ${!!target}`;
  if (audience === 'role') return sql`u.role=${target}`;
  if (audience === 'channel') return sql`EXISTS(SELECT 1 FROM comm_channels c WHERE c.id::text=${target} AND ${channelScope(sql`u.id`, '')})`;
  return sql`false`;
}

export function bulletinManagement(user: TokenPayload) {
  return sql`(${commAdmin(user.role)} OR b.author_id=${user.userId}) AND (
    (${commPublisher(user.role)} AND b.audience<>'channel') OR
    (b.audience='department' AND ${user.role === 'hr_manager' && !!user.department} AND b.target=${user.department || ''}) OR
    (b.audience='channel' AND EXISTS(SELECT 1 FROM comm_channels c WHERE c.id::text=b.target AND c.archived_at IS NULL AND ${channelScope(sql`${user.userId}`, user.role)} AND (${channelManage(user.userId, user.role)}))))`;
}

export const bulletinStage = () => sql`CASE WHEN b.status='draft' THEN 'draft' WHEN b.status='archived' THEN 'archived' WHEN b.expires_at<=now() THEN 'expired' WHEN b.publish_at>now() THEN 'scheduled' ELSE 'live' END`;
export const bulletinLabel = () => sql`CASE WHEN b.audience='all' THEN 'Whole company' WHEN b.audience='channel' THEN coalesce((SELECT c.name FROM comm_channels c WHERE c.id::text=b.target),'Team channel') WHEN b.audience='role' THEN replace(b.target,'_',' ') ELSE b.target END`;
export const bulletinVisible = (user: TokenPayload) => sql`${liveBulletin()} AND (${bulletinAudience(user)})`;

export function bulletinFilter(filter: string) {
  if (filter === 'unread') return sql`r.read_at IS NULL`;
  if (filter === 'needs_ack') return sql`b.requires_acknowledgement AND r.acknowledged_at IS NULL`;
  if (filter === 'pinned') return sql`b.pinned`;
  if (['draft', 'scheduled', 'live', 'expired', 'archived'].includes(filter)) return sql`${bulletinStage()}=${filter}`;
  return sql`true`;
}
