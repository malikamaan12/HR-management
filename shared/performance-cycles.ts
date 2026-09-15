import { z } from 'zod';

const id = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(5000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Choose a valid date');
export const rubricInput = z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), label: text.max(120), weight: z.number().int().min(1).max(100) }).strict()).min(1).max(12)
  .refine(rows => rows.reduce((n,r) => n+r.weight,0) === 100, 'Rubric weights must total 100')
  .refine(rows => new Set(rows.map(r => r.key)).size === rows.length, 'Rubric keys must be unique');
export const cycleInput = z.object({ name: text.max(160), periodStart: day, periodEnd: day, dueDate: day, selfRequired: z.boolean(), rubric: rubricInput,
  ratingLabels: z.array(text.max(80)).length(5) }).strict().refine(v => v.periodEnd >= v.periodStart && v.dueDate >= v.periodEnd, 'Review deadline must follow the review period');
export const participantInput = z.object({ employeeId: id, reviewerId: id, dueDate: day, selfRequired: z.boolean() }).strict();
export const scoresInput = z.array(z.object({ key: z.string(), score: z.number().int().min(1).max(5), comment: z.string().trim().max(2000) }).strict()).min(1).max(12);
export const assessmentInput = z.object({ version: id, action: z.enum(['save_self','submit_self','save_manager','submit_manager','publish','return_manager','acknowledge','reassign']),
  scores: scoresInput.optional(), summary: z.string().trim().max(10000).optional(), reason: z.string().trim().max(3000).optional(), reviewerId: id.optional() }).strict();
export const objectiveInput = z.object({ kind: z.enum(['objective','development']), title: text.max(200), measure: text.max(3000), dueDate: day }).strict();
export const objectiveProgressInput = z.object({ version: id, progress: z.number().int().min(0).max(100), status: z.enum(['active','completed','cancelled']), note: text.max(3000) }).strict()
  .refine(v => v.status !== 'completed' || v.progress === 100, 'Completed objectives require 100% progress');
export type Rubric = z.infer<typeof rubricInput>;
export type Scores = z.infer<typeof scoresInput>;
export const performanceAdmin = (role: string) => ['super_admin','admin','hr_director','hr'].includes(role);
export const cycleStates = ['draft','open','closed','cancelled'] as const;
export const assessmentStates = ['pending','self_review','manager_review','calibration','published','acknowledged'] as const;
