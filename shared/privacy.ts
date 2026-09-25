import {z} from 'zod';

// Identity, bank, employment and compensation changes retain their dedicated workflows.
export const privacyCorrectionSchema=z.object({
  fullNameArabic:z.string().trim().min(1).max(200).nullable().optional(),
  personalEmail:z.string().trim().email().max(254).nullable().optional(),
  primaryMobile:z.string().trim().regex(/^\+?[0-9 ().-]{6,30}$/,'Enter a valid telephone number').optional(),
  residentialAddress:z.string().trim().min(3).max(1000).optional(),
}).strict().refine(value=>Object.keys(value).length>0,'Provide at least one correction');
export type PrivacyCorrection=z.infer<typeof privacyCorrectionSchema>;
