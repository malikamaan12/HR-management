import { z } from 'zod';
import { civilDate, positiveId } from './hr-rules';

export const equipmentCondition = z.enum(['new', 'good', 'fair', 'damaged', 'lost']);
export const equipmentState = z.enum(['available', 'issued', 'maintenance', 'retired', 'lost']);
export const equipmentReason = z.string().trim().min(5).max(2000);
const optionalDate = civilDate.nullable().default(null);
export const equipmentAssetInput = z.object({
  assetTag: z.string().trim().min(2).max(100).transform(v => v.toUpperCase()),
  name: z.string().trim().min(2).max(200), category: z.string().trim().min(2).max(100),
  serialNumber: z.string().trim().max(150).default(''), location: z.string().trim().max(200).default(''),
  purchaseDate: optionalDate, warrantyUntil: optionalDate,
  condition: equipmentCondition.default('good'), notes: z.string().trim().max(2000).default(''),
}).strict().refine(v => !v.purchaseDate || !v.warrantyUntil || v.warrantyUntil >= v.purchaseDate,
  { message: 'Warranty expiry must be on or after purchase', path: ['warrantyUntil'] });
export const equipmentPolicyInput = z.object({
  acknowledgementRequired: z.boolean(), acknowledgementDays: z.number().int().min(1).max(365),
  maxLoanDays: z.number().int().min(1).max(3650).nullable(),
  requireReturnRequest: z.boolean(), independentReturnReview: z.boolean(),
  returnEvidenceRequired: z.boolean(), blockOffboarding: z.boolean(),
}).strict();
export type EquipmentPolicy = z.infer<typeof equipmentPolicyInput>;
export const defaultEquipmentPolicy: EquipmentPolicy = {
  acknowledgementRequired: true, acknowledgementDays: 7, maxLoanDays: null,
  requireReturnRequest: false, independentReturnReview: true,
  returnEvidenceRequired: true, blockOffboarding: true,
};
export const equipmentIssueInput = z.object({
  assetId: positiveId, assetVersion: positiveId, employeeId: positiveId,
  issuedOn: civilDate, dueOn: optionalDate, condition: equipmentCondition.exclude(['lost']),
  note: equipmentReason,
}).strict();
export type EquipmentAsset = {
  id: number; asset_tag: string; name: string; category: string; serial_number: string;
  location: string; purchase_date: string | null; warranty_until: string | null;
  condition: z.infer<typeof equipmentCondition>; state: z.infer<typeof equipmentState>;
  notes: string; version: number; created_by: number; created_at: string; updated_at: string;
};
export type EquipmentAssignment = {
  id: number; asset_id: number; employee_id: number; employee_name?: string; employee_code?: string;
  asset_name?: string; asset_tag?: string; issued_on: string; due_on: string | null;
  issued_condition: string; issue_note: string; issued_by: number;
  asset_snapshot: Pick<EquipmentAsset, 'asset_tag' | 'name' | 'category' | 'serial_number'>;
  policy_snapshot: EquipmentPolicy & { version: number };
  status: 'issued' | 'return_requested' | 'returned' | 'written_off';
  acknowledgement: 'pending' | 'accepted' | 'disputed' | 'not_required';
  acknowledgement_due_on: string | null; acknowledged_by: number | null; acknowledged_at: string | null;
  acknowledgement_note: string | null; requested_condition: string | null; return_request_note: string | null;
  return_requested_by: number | null; return_requested_at: string | null;
  returned_on: string | null; returned_condition: string | null; return_note: string | null;
  return_evidence: string | null; closed_by: number | null; closed_at: string | null;
  version: number; created_at: string; updated_at: string;
};
export type EquipmentHistory = { id: number; version: number; actor_id: number; reason: string; created_at: string; snapshot: Record<string, unknown> };
