import { z } from 'zod';
import { positiveId, reason } from './hr-rules';

export const retentionPolicyInput = z.object({
  documentType: z.string().trim().min(1).max(100),
  version: z.number().int().min(0), enabled: z.boolean(),
  anchor: z.enum(['expiry', 'employment_end']),
  retentionDays: z.number().int().min(0).max(36500),
  reviewDays: z.number().int().min(1).max(365), reason,
}).strict();
export const retentionHoldInput = z.object({ employeeId: positiveId, documentId: positiveId.nullable(), reason }).strict();
export const retentionRequestInput = z.object({ documentId: positiveId, action: z.enum(['archive', 'restore']), reason }).strict();
export const retentionDecisionInput = z.object({ version: positiveId, decision: z.enum(['approve', 'reject', 'withdraw']), reason }).strict();
export const retentionListInput = z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0), q: z.string().trim().max(100).default(''), view: z.enum(['eligible', 'archived', 'held', 'all']).default('eligible') }).strict();
export const retentionReviewInput = z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0), status: z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'all']).default('pending') }).strict();
