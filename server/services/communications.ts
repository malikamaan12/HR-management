import { sql, type SQL } from 'drizzle-orm';
import type { TokenPayload } from './auth';
import { WorkflowError } from './workflowRecords';
import { commAdmin, commPublisher, commManager, communicationPolicy, defaultCommunicationPolicy } from '@shared/communications';
import { userRoleEnum } from '@shared/schema';

export const searchTerm = (value: string) => '%' + value.replace(/[\\%_]/g, '\\$&') + '%';
export const activePerson = (alias: string) => sql`${sql.raw(alias)}.is_active AND ${sql.raw(alias)}.approval_status='approved' AND NOT EXISTS(SELECT 1 FROM employees ep WHERE ep.user_id=${sql.raw(alias)}.id AND (ep.status='inactive' OR ep.joining_date>(now() AT TIME ZONE 'Asia/Qatar')::date OR ep.termination_date<=(now() AT TIME ZONE 'Asia/Qatar')::date))`;
export const teamGrant = (team: SQL, uid: SQL, manage = false) => sql`EXISTS(SELECT 1 FROM workforce_grants g WHERE g.team_id=${team} AND g.user_id=${uid} AND g.revoked_at IS NULL AND g.start_at<=now() AND g.end_at>now() ${manage ? sql`AND g.permission='schedule'` : sql``})`;
export const teamMember = (team: SQL, uid: SQL) => sql`EXISTS(SELECT 1 FROM workforce_members wm JOIN employees e ON e.id=wm.employee_id WHERE e.user_id=${uid} AND e.status<>'inactive' AND wm.team_id=${team} AND wm.start_at<=now() AND wm.end_at>now()) OR EXISTS(SELECT 1 FROM workforce_assignments wa JOIN workforce_shifts ws ON ws.id=wa.shift_id JOIN employees e ON e.id=wa.employee_id WHERE e.user_id=${uid} AND e.status<>'inactive' AND ws.team_id=${team} AND wa.status='accepted' AND ws.status='scheduled' AND ws.start_at<=now()+interval '24 hours' AND ws.end_at>now()) OR ${teamGrant(team, uid)}`;
export function channelScope(uid: SQL, role: string, alias = 'c') {
  const c = sql.raw(alias);
  return sql`((${c}.owner_id=${uid} AND ${c}.kind IN ('group','workforce') AND (EXISTS(SELECT 1 FROM users owner WHERE owner.id=${uid} AND owner.role IN ('admin','super_admin','hr_director','hr')) OR (${c}.kind='group' AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=${uid} AND owner.role IN ('hr_manager','department_head','manager','event_manager'))) OR (${c}.kind='workforce' AND ${teamGrant(sql`${c}.team_id`, uid, true)}))) OR
    (${c}.starts_at<=now() AND (${c}.ends_at IS NULL OR ${c}.ends_at>now()) AND (
    (${c}.kind='workforce' AND (${teamMember(sql`${c}.team_id`, uid)})) OR
    (${c}.kind<>'workforce' AND EXISTS(SELECT 1 FROM comm_members cm WHERE cm.channel_id=${c}.id AND cm.user_id=${uid} AND cm.removed_at IS NULL AND cm.starts_at<=now() AND (cm.ends_at IS NULL OR cm.ends_at>now()))))))`;
}
export function directWritable(user: TokenPayload, alias = 'c') {
  const c = sql.raw(alias);
  return sql`(${c}.kind<>'direct' OR EXISTS(SELECT 1 FROM comm_members peer JOIN users u ON u.id=peer.user_id WHERE peer.channel_id=${c}.id AND peer.removed_at IS NULL AND peer.starts_at<=now() AND (peer.ends_at IS NULL OR peer.ends_at>now()) AND ${directoryScope(user)}))`;
}
export function channelManage(uid: number, role: string, alias = 'c') {
  const c = sql.raw(alias);
  return sql`(${c}.kind='group' AND ${c}.owner_id=${uid} AND ${commManager(role)}) OR (${c}.kind='workforce' AND ((${c}.owner_id=${uid} AND ${commPublisher(role)}) OR ${teamGrant(sql`${c}.team_id`, sql`${uid}`, true)}))`;
}
export async function policy(tx: any) {
  const row = (await tx.execute(sql`SELECT * FROM comm_policies ORDER BY version DESC LIMIT 1`)).rows[0];
  return { version: row ? Number(row.version) : 0, definition: row ? communicationPolicy.parse(row.definition) : defaultCommunicationPolicy };
}
export async function channel(tx: any, user: TokenPayload, id: number, lock = false) {
  const row = (await tx.execute(sql`SELECT c.*,coalesce(st.favorite,false) AS favorite,coalesce(st.muted,false) AS muted,(${channelManage(user.userId, user.role)}) AS can_manage,${directWritable(user)} AS can_contact FROM comm_channels c LEFT JOIN comm_channel_state st ON st.channel_id=c.id AND st.user_id=${user.userId} WHERE c.id=${id} AND ${channelScope(sql`${user.userId}`, user.role)} ${lock ? sql`FOR UPDATE OF c` : sql``}`)).rows[0];
  if (!row) throw new WorkflowError(404, 'Conversation not found or access has ended');
  const p = await policy(tx);
  return { ...row, can_post: row.can_contact && new Date(row.starts_at)<=new Date() && (!row.ends_at || new Date(row.ends_at)>new Date()) && !row.archived_at && (!row.managers_only || !!row.can_manage) && (row.kind !== 'direct' || p.definition.directMessages), policy: p.definition };
}
export function directoryScope(user: TokenPayload) {
  // Permanent colleagues can find one another. Temporary contacts require shared current work or HR.
  const shared = sql`EXISTS(SELECT 1 FROM workforce_teams t WHERE (${teamMember(sql`t.id`, sql`${user.userId}`)}) AND (${teamMember(sql`t.id`, sql`u.id`)}))`;
  return sql`${activePerson('u')} AND u.role<>'finance_audit' AND u.id<>${user.userId} AND (
    ${commPublisher(user.role)} OR u.role IN ('admin','super_admin','hr_director','hr') OR
    (${user.role !== 'temporary_staff'} AND u.role<>'temporary_staff' AND NOT EXISTS(SELECT 1 FROM employees e WHERE e.user_id IN (${user.userId},u.id) AND e.type='temporary')) OR ${shared})`;
}
export async function requireContact(tx: any, user: TokenPayload, id: number) {
  const row = (await tx.execute(sql`SELECT u.id,u.first_name || ' ' || u.last_name AS name,EXISTS(SELECT 1 FROM employees e WHERE e.user_id=u.id AND e.type='temporary') OR u.role='temporary_staff' AS temporary FROM users u WHERE u.id=${id} AND ${directoryScope(user)}`)).rows[0];
  if (!row) throw new WorkflowError(404, 'Person is not available within your communication scope');
  return row;
}
export function bulletinAudience(user: TokenPayload, alias = 'b') {
  const b = sql.raw(alias);
  return sql`${b}.audience='all' OR (${b}.audience='department' AND ${b}.target=${user.department || ''} AND ${!!user.department}) OR (${b}.audience='role' AND ${b}.target=${user.role}) OR (${b}.audience='channel' AND EXISTS(SELECT 1 FROM comm_channels c WHERE c.id::text=${b}.target AND ${channelScope(sql`${user.userId}`, user.role)}))`;
}
export const liveBulletin = (alias = 'b') => sql`${sql.raw(alias)}.status='published' AND ${sql.raw(alias)}.publish_at<=now() AND (${sql.raw(alias)}.expires_at IS NULL OR ${sql.raw(alias)}.expires_at>now())`;
export async function canPublishAudience(tx: any, user: TokenPayload, audience: string, target: string) {
  if (!commManager(user.role)) throw new WorkflowError(403, 'HR or assigned team publishing access required');
  if (audience === 'channel') {
    if (!/^\d+$/.test(target)) throw new WorkflowError(400, 'Choose a conversation');
    const c = await channel(tx, user, Number(target));
    if (!c.can_manage || c.archived_at) throw new WorkflowError(403, 'Only managers of an active channel can publish its briefings');
  } else if (!commPublisher(user.role) && !(user.role === 'hr_manager' && audience === 'department' && !!user.department && target === user.department)) throw new WorkflowError(403, 'Use your assigned channel or department audience');
  if (audience === 'role' && !userRoleEnum.enumValues.includes(target as any)) throw new WorkflowError(400, 'Choose a valid role');
}
export async function bulletin(tx: any, user: TokenPayload, id: number, manage = false, lock = false) {
  const row = (await tx.execute(sql`SELECT b.*,u.first_name || ' ' || u.last_name AS author_name FROM comm_bulletins b JOIN users u ON u.id=b.author_id WHERE b.id=${id} ${lock ? sql`FOR UPDATE OF b` : sql``}`)).rows[0];
  if (!row) throw new WorkflowError(404, 'Announcement not found');
  let allowed = false;
  if (commAdmin(user.role) || Number(row.author_id) === user.userId) {
    try { await canPublishAudience(tx, user, row.audience, row.target); allowed = true; } catch { /* current authority may have expired */ }
  }
  if (manage && !allowed) throw new WorkflowError(403, 'Announcement management access required');
  if (!allowed) {
    const visible = (await tx.execute(sql`SELECT b.id FROM comm_bulletins b WHERE b.id=${id} AND ${liveBulletin()} AND (${bulletinAudience(user)})`)).rows[0];
    if (!visible) throw new WorkflowError(404, 'Announcement not found');
  }
  return { ...row, can_manage: allowed };
}
export function safeMessage(row: any) {
  const { attachment_key, content_hash, request_key, retraction_reason, ...safe } = row;
  return row.retracted_at ? { ...safe, body: 'Message withdrawn', attachment_name: null, attachment_size: null, mentions: [] } : safe;
}
export function notificationLink(data: any) {
  const value = typeof data?.url === 'string' ? data.url : '';
  return /^\/(documents|learning|handbook|equipment|team-overview|helpdesk|leave|attendance|payroll|workforce|hr-letters|benefits|expenses)(\/[a-zA-Z0-9_-]+)*$/.test(value) ? value : null;
}
