import { z } from 'zod';

export const categoryIdInput = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'Use a category key containing lowercase letters, numbers and underscores');
export const workspaceInput = z.object({
  title: z.string().trim().min(2).max(100),
  introduction: z.string().trim().max(1000),
  requestGuidance: z.string().trim().max(2000),
  contactInstructions: z.string().trim().max(2000),
  attachmentMegabytes: z.number().int().min(1).max(10),
  categories: z.array(z.object({
    id: categoryIdInput, label: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500), enabled: z.boolean(), confidential: z.boolean(),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.categories.map(c => c.id)).size !== value.categories.length)
    ctx.addIssue({code: 'custom', path: ['categories'], message: 'Category keys must be unique'});
  if (!value.categories.some(c => c.enabled))
    ctx.addIssue({code: 'custom', path: ['categories'], message: 'Keep at least one category enabled'});
});
export const workspaceSaveInput = z.object({version: z.number().int().positive(), workspace: workspaceInput, reason: z.string().trim().min(5).max(1000)}).strict();
export type HelpdeskWorkspace = z.infer<typeof workspaceInput>;
export type WorkspaceRecord = {version: number; workspace: HelpdeskWorkspace};
export const categoryName = (workspace: HelpdeskWorkspace, id: string) => workspace.categories.find(c => c.id === id)?.label || id;
export interface HelpdeskOverview {
  total: number; active: number; waiting: number; completed: number; overdue: number; unassigned: number;
  statuses: {status: string; count: number}[];
}
