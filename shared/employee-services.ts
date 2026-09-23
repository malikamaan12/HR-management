import { z } from 'zod';
import { civilDate, positiveId, reason } from './hr-rules';
export const serviceKind = z.enum(['benefit', 'expense']);
export type ServiceKind = z.infer<typeof serviceKind>;
export const serviceModule = (kind: ServiceKind) => kind === 'benefit' ? 'benefits_perks' as const : 'expense_management' as const;
export const policyAdmin = (role: string) => ['super_admin', 'admin'].includes(role);
export const learningAdmin = (role: string) => ['super_admin', 'admin', 'hr_director', 'hr'].includes(role);
export const quantity = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Use an amount with up to two decimals').refine(v => Number(v) > 0, 'Amount must be positive');
export const courseDefinition = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().trim().min(5).max(5000), provider: z.string().trim().min(2).max(150),
  format: z.enum(['online', 'in_person', 'hybrid', 'self_paced']), url: z.union([z.literal(''), z.string().url().max(2000).refine(v => new URL(v).protocol === 'https:', 'Use an HTTPS course link')]),
  durationMinutes: z.number().int().min(1).max(100000), capacity: z.number().int().min(1).max(100000).nullable(),
  passScore: z.number().int().min(0).max(100), requiresEvidence: z.boolean(), validMonths: z.number().int().min(1).max(120).nullable(),
  approverId: positiveId, status: z.enum(['draft', 'published', 'archived']),
  delivery:z.enum(['record','internal']).default('record'),
  coverImage:z.enum(['auto','welcome','safety','service','leadership','fire','first-aid']).optional(),
  coverImageUrl:z.union([z.literal(''),z.string().url().max(2000).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}},'Use an HTTPS image URL without credentials')]).optional(),
}).strict();
export type CourseDefinition = z.infer<typeof courseDefinition>;
export const learningOverride = courseDefinition.pick({passScore: true, requiresEvidence: true, validMonths: true}).extend({reason}).strict();
export const enrollmentInput = z.object({employeeId: positiveId, courseId: positiveId, dueDate: civilDate.nullable(), reason, override: learningOverride.optional()}).strict();
export const eligibilityRule = z.object({
  enabled: z.boolean(), employeeTypes: z.array(z.enum(['permanent', 'temporary', 'contract'])).min(1).max(3),
  departments: z.array(z.string().trim().min(1).max(150)).max(100), minServiceDays: z.number().int().min(0).max(3650),
  annualLimit: quantity, perRequestLimit: quantity, unit: z.string().trim().min(1).max(20),
  receiptRequired: z.boolean(), submissionDays: z.number().int().min(1).max(366), approverId: positiveId,
}).strict().refine(v => Number(v.perRequestLimit) <= Number(v.annualLimit), 'Per-request limit cannot exceed the annual limit');
export type EligibilityRule = z.infer<typeof eligibilityRule>;
export const policyInput = z.object({kind: serviceKind, key: z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/, 'Use a short program code with lowercase letters, numbers or hyphens'),
  name: z.string().trim().min(3).max(150), employeeId: positiveId.nullable(), effectiveFrom: civilDate, config: eligibilityRule, reason,
}).strict().superRefine((v,ctx)=>{if(v.kind==='expense'&&!/^[A-Z]{3}$/.test(v.config.unit))ctx.addIssue({code:'custom',path:['config','unit'],message:'Expense currency must be a three-letter code'});});
export const serviceDraft = z.object({employeeId:positiveId,policyKey:z.string().min(2).max(60),requestDate:civilDate,title:z.string().trim().min(3).max(200),details:reason,
  quantity:quantity.optional(),items:z.array(z.object({description:z.string().trim().min(3).max(200),amount:quantity}).strict()).min(1).max(50).optional(),
}).strict();
export const versionInput=z.number().int().positive();
export type WorkflowEvent={action:string;actorId:number;at:string;reason:string;version:number;snapshot?:unknown};
