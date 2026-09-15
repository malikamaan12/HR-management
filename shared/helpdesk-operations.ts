import { z } from 'zod';
import { caseCategories } from './helpdesk';
const id=z.coerce.number().int().positive();
export const helpdeskPolicyAdmin=(role:string)=>['super_admin','admin','hr_director','hr'].includes(role);
export const helpdeskPolicyInput=z.object({category:z.enum(caseCategories),confidential:z.boolean(),employeeId:id.nullable(),enabled:z.boolean(),
  effectiveAt:z.string().datetime({offset:true}),firstResponseHours:z.number().int().min(1).max(8760),resolutionHours:z.number().int().min(1).max(8760),
  defaultAssigneeId:id.nullable(),escalationAssigneeId:id.nullable(),reason:z.string().trim().min(5).max(1000)}).strict()
  .refine(v=>v.resolutionHours>=v.firstResponseHours,'Resolution target must be at least the first response target');
export const articleInput=z.object({title:z.string().trim().min(4).max(200),body:z.string().trim().min(10).max(30000),category:z.enum(caseCategories),
  audience:z.enum(['all','hr']),status:z.enum(['draft','published','archived'])}).strict();
export const articleRevisionInput=articleInput.extend({version:id,reason:z.string().trim().min(5).max(1000)});
