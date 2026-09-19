import { z } from 'zod';
import { positiveId, reason } from './hr-rules';

export const commAdmin = (role: string) => ['admin', 'super_admin'].includes(role);
export const commPublisher = (role: string) => ['admin', 'super_admin', 'hr_director', 'hr'].includes(role);
export const commManager = (role: string) => commPublisher(role) || ['hr_manager', 'department_head', 'manager', 'event_manager'].includes(role);
export const communicationPolicy = z.object({
  directMessages: z.boolean(), groupCreation: z.boolean(),
  maxMessageLength: z.number().int().min(200).max(12000),
  attachmentMegabytes: z.number().int().min(1).max(10),
  historyDays: z.number().int().min(30).max(3650),
}).strict();
export const defaultCommunicationPolicy = { directMessages: true, groupCreation: true, maxMessageLength: 4000, attachmentMegabytes: 5, historyDays: 365 };
export type CommunicationPolicy = z.infer<typeof communicationPolicy>;
export const pageQuery = z.object({ q: z.string().trim().max(100).default(''), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict();
const dateTime = z.string().datetime({ offset: true });
export const channelInput = z.object({
  name: z.string().trim().min(3).max(120), description: z.string().trim().max(1500),
  kind: z.enum(['group', 'workforce']), teamId: positiveId.nullable(),
  startsAt: dateTime, endsAt: dateTime.nullable(), managersOnly: z.boolean(), reason,
}).strict().superRefine((v, ctx) => {
  if ((v.kind === 'workforce') !== !!v.teamId || v.kind === 'workforce' && !v.endsAt) ctx.addIssue({ code: 'custom', message: 'Workforce channels require a team and end date; group channels have no team' });
  if (v.endsAt && Date.parse(v.endsAt) <= Date.parse(v.startsAt)) ctx.addIssue({ code: 'custom', message: 'End must follow start' });
});
export const memberInput = z.object({ userId: positiveId, startsAt: dateTime, endsAt: dateTime.nullable(), reason }).strict().refine(v => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), 'End must follow start');
export const messageInput = z.object({ body: z.string().trim().min(1).max(12000), requestKey: z.string().uuid(), replyTo: positiveId.nullable().default(null), mentions: z.array(positiveId).max(10).default([]) }).strict();
export const bulletinInput = z.object({
  title: z.string().trim().min(3).max(180), body: z.string().trim().min(3).max(20000),
  audience: z.enum(['all', 'department', 'role', 'channel']), target: z.string().trim().max(150),
  publishAt: dateTime, expiresAt: dateTime.nullable(), requiresAcknowledgement: z.boolean(), pinned: z.boolean(), reason,
}).strict().superRefine((v, ctx) => {
  if (v.audience !== 'all' && !v.target) ctx.addIssue({ code: 'custom', message: 'Choose a target audience' });
  if (v.audience === 'all' && v.target) ctx.addIssue({ code: 'custom', message: 'Company announcements have no target value' });
  if (v.expiresAt && Date.parse(v.expiresAt) <= Date.parse(v.publishAt)) ctx.addIssue({ code: 'custom', message: 'Expiry must follow publication' });
});
export const versionReason = z.object({ version: positiveId, reason }).strict();
export type Channel = { id: number; name: string; description: string; kind: string; team_id: number | null; version: number; starts_at: string; ends_at: string | null; managers_only: boolean; archived_at: string | null; can_manage: boolean; can_post: boolean; muted: boolean; unread: number; mentions: number };
export type CommMessage = { id: number; author_id: number; author_name: string; body: string; created_at: string; reply_to: number | null; mentions: number[]; retracted_at: string | null; attachment_name: string | null; attachment_size: number | null };
export type Bulletin = { id: number; title: string; body: string; audience: string; target: string; status: string; version: number; author_id: number; author_name: string; publish_at: string; expires_at: string | null; requires_acknowledgement: boolean; pinned: boolean; read_at: string | null; acknowledged_at: string | null; can_manage: boolean };
export const chatReactions=['👍','❤️','🎉','👀','✅'] as const;
export type ChatReaction=typeof chatReactions[number];
export type ChatMessage=CommMessage & {channel_id:number;channel_name?:string;saved:boolean;pinned:boolean;reply_count:number;reactions:{emoji:ChatReaction;count:number;mine:boolean}[];reply_preview:{id:number;body:string;author_name:string}|null};
export type ChatChannel=Channel & {favorite:boolean;last_message:string|null;last_author:string|null;last_activity:string|null;display_name:string};
export type HubSummary={unreadConversations:number;mentions:number;pendingAcknowledgements:number;unreadActions:number};
