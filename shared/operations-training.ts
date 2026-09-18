import { z } from 'zod';
import { positiveId, reason } from './hr-rules';
import { inductionSettings } from './induction';

export const publishedOperationsTrainingSettings = inductionSettings.pick({
  mandatoryForOnboarding: true,
  employeeTypes: true,
  departments: true,
  defaultDueDays: true,
}).strict();

export const operationsTrainingSettings = publishedOperationsTrainingSettings.superRefine((settings, context) => {
  if (new Set(settings.employeeTypes).size !== settings.employeeTypes.length) {
    context.addIssue({ code: 'custom', path: ['employeeTypes'], message: 'Choose each employee type once' });
  }
  if (new Set(settings.departments).size !== settings.departments.length) {
    context.addIssue({ code: 'custom', path: ['departments'], message: 'Choose each department once' });
  }
});

export const operationsTrainingList = z.object({
  q: z.string().trim().max(100).default(''),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();

export const operationsTrainingUpdate = z.object({
  courseVersion: positiveId,
  draftVersion: positiveId,
  publishedReleaseId: positiveId,
  settings: operationsTrainingSettings,
  reason,
}).strict();

export type OperationsTrainingSettings = z.infer<typeof operationsTrainingSettings>;
export type OperationsTrainingUpdate = z.infer<typeof operationsTrainingUpdate>;
export type OperationsTrainingCourse = {
  id: number;
  title: string;
  courseVersion: number;
  draftVersion: number | null;
  publishedReleaseId: number;
  releaseNumber: number;
  hasDraft: boolean;
  settings: OperationsTrainingSettings;
  canPublish: boolean;
  blockedReason: string | null;
};

export function sameOperationsTrainingSettings(left: OperationsTrainingSettings, right: OperationsTrainingSettings) {
  return left.mandatoryForOnboarding === right.mandatoryForOnboarding
    && left.defaultDueDays === right.defaultDueDays
    && JSON.stringify([...left.employeeTypes].sort()) === JSON.stringify([...right.employeeTypes].sort())
    && JSON.stringify([...left.departments].sort()) === JSON.stringify([...right.departments].sort());
}
