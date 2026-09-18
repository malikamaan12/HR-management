import { z } from 'zod';
import { reason } from './hr-rules';

export const taskKinds = ['general', 'document', 'asset_return'] as const;
export const lifecycleTaskDefinition = z.object({
  title: z.string().trim().min(1).max(200), kind: z.enum(taskKinds),
  required: z.boolean(), offsetDays: z.number().int().min(-90).max(365),
  reviewRequired: z.boolean().default(false),
  documentType: z.string().trim().max(100).default(''),
}).strict().refine(t => t.kind === 'document' || !t.documentType, 'Document type applies only to document tasks');
export const lifecycleTemplateInput = z.object({
  name: z.string().trim().min(1).max(150), kind: z.enum(['onboarding', 'offboarding']),
  tasks: z.array(lifecycleTaskDefinition).min(1).max(100),
  reason: reason.optional(),
}).strict();
export const lifecyclePolicyInput = z.object({
  version: z.number().int().min(0),
  taskKinds: z.array(z.enum(taskKinds)).max(3).refine(a => new Set(a).size === a.length, 'Choose each type once'),
  reviewDays: z.number().int().min(1).max(365), reason,
}).strict();
export type LifecycleTaskDefinition = z.infer<typeof lifecycleTaskDefinition>;
export const defaultLifecyclePolicy = { version: 0, taskKinds: [] as typeof taskKinds[number][], reviewDays: 7 };
