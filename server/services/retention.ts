import { sql } from 'drizzle-orm';
import { WorkflowError, qatarToday } from './workflowRecords';

export const canManageRetention = (req: any) => ['admin','super_admin','hr_director','hr','hr_manager'].includes(req.user.role);
export function requireRetentionManager(req: any) { if (!canManageRetention(req)) throw new WorkflowError(403, 'HR retention access required'); }
export const documentIsArchived = sql<boolean>`EXISTS(SELECT 1 FROM hr_document_archives WHERE document_id=documents.id AND archived)`;
export async function isDocumentArchived(tx: any, documentId: number) {
  return !!(await tx.execute(sql`SELECT id FROM hr_document_archives WHERE document_id=${documentId} AND archived`)).rows.length;
}
export async function retentionPolicy(tx: any, type: string) {
  return (await tx.execute(sql`SELECT * FROM hr_retention_policies WHERE document_type IN (${type},'*') ORDER BY (document_type=${type}) DESC LIMIT 1`)).rows[0] || null;
}
export async function retentionState(tx: any, document: any, employee: any) {
  const policy = await retentionPolicy(tx, document.documentType);
  const archive = (await tx.execute(sql`SELECT * FROM hr_document_archives WHERE document_id=${document.id}`)).rows[0];
  const holds = (await tx.execute(sql`SELECT id FROM hr_retention_holds WHERE active AND employee_id=${employee.id} AND (document_id IS NULL OR document_id=${document.id})`)).rows;
  const anchor = policy?.anchor === 'employment_end' ? (employee.status === 'inactive' ? employee.terminationDate : null) : document.expiryDate;
  const retainUntil = policy && anchor ? new Date(Date.parse(anchor) + Number(policy.retention_days) * 86400000).toISOString().slice(0,10) : null;
  const pendingRenewal = !!(await tx.execute(sql`SELECT id FROM document_renewal_requests WHERE document_id=${document.id} AND status='pending'`)).rows.length;
  const currentVersion = Number((await tx.execute(sql`SELECT coalesce(max(version),0) AS version FROM document_versions WHERE document_id=${document.id}`)).rows[0].version);
  return { policy, archived: !!archive?.archived, holds: holds.length, retainUntil, pendingRenewal,
    eligible: !!policy?.enabled && !!retainUntil && retainUntil <= qatarToday() && !holds.length && !pendingRenewal && !archive?.archived,
    snapshot: { id: document.id, documentType: document.documentType, expiryDate: document.expiryDate, issueDate: document.issueDate,
      currentVersion, updatedAt: new Date(document.updatedAt).toISOString(), employeeVersion: employee.recordVersion, archiveVersion: Number(archive?.version || 0) } };
}
