import { and, eq, sql } from 'drizzle-orm';
import { documents, documentVersions, employees, lifecycleCases as cases, lifecycleTasks as tasks, users } from '@shared/schema';
import { defaultLifecyclePolicy } from '@shared/lifecycle';
import { employeeScope } from './access';
import { fail, type WorkforceTransaction } from './workforce';
import { businessToday, audit } from './hr-rules';
import type { TokenPayload } from './auth';

export async function lifecyclePolicy(tx: WorkforceTransaction | any) {
  const result = await tx.execute(sql`SELECT version, task_kinds, review_days FROM lifecycle_review_policies ORDER BY version DESC LIMIT 1`);
  const row = result.rows[0];
  return row ? { version: Number(row.version), taskKinds: row.task_kinds as string[], reviewDays: Number(row.review_days) } : defaultLifecyclePolicy;
}
export async function lifecycleHistory(tx: WorkforceTransaction, user: TokenPayload, kind: string, row: {id:number;version:number}, note: string, preserve = false) {
  const entry=sql`INSERT INTO hr_workflow_history(kind,record_id,version,snapshot,actor_id,reason) VALUES (${kind},${row.id},${row.version},${JSON.stringify(row)}::jsonb,${user.userId},${note})`;
  await tx.execute(preserve?sql`${entry} ON CONFLICT(kind,record_id,version) DO NOTHING`:entry);
  if (!preserve) await audit(tx, user, kind, row.id, 'Recorded version ' + row.version);
}
export async function requireLifecycleOwner(tx: WorkforceTransaction, id: number) {
  const [owner] = await tx.select({id:users.id}).from(users).where(and(eq(users.id,id),eq(users.isActive,true),eq(users.approvalStatus,'approved'))).for('share');
  if (!owner) fail(400,'Choose an active, approved task owner');
}
export async function lifecyclePermission(tx: WorkforceTransaction | any, user: TokenPayload, employeeId: number, permission: 'read'|'update'|'approve') {
  const [row] = await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(user,'recruitment_onboarding',permission)));
  return !!row;
}
// All case mutations take the same employee -> case lock order as final offboarding.
export async function lockedLifecycle(tx: WorkforceTransaction, id: number) {
  const [lookup] = await tx.select().from(cases).where(eq(cases.id,id));
  if (!lookup) fail(404,'Workflow not found');
  const [employee] = await tx.select().from(employees).where(eq(employees.id,lookup.employeeId)).for('update');
  const [record] = await tx.select().from(cases).where(eq(cases.id,id)).for('update');
  return {record,employee};
}
export function independentLifecycleReviewer(user: TokenPayload, employee: {userId:number|null}, task: typeof tasks.$inferSelect) {
  return user.userId !== employee.userId && user.userId !== task.ownerId && user.userId !== task.submittedBy;
}
export function publicLifecycleTask(task: typeof tasks.$inferSelect) {
  const {documentSnapshot, ...rest} = task;
  // Storage keys and document numbers are never exposed by the task APIs.
  const snapshot = documentSnapshot as any;
  return {...rest, documentEvidence: snapshot ? {id:snapshot.id,version:snapshot.version,documentType:snapshot.documentType,expiryDate:snapshot.expiryDate} : null};
}
export async function validateLifecycleEvidence(tx: WorkforceTransaction, employeeId: number, task: typeof tasks.$inferSelect, pin: boolean) {
  if (!task.evidence || task.evidence.trim().length < 5) fail(400,'Record completion evidence');
  if (task.kind === 'asset_return' && !task.assetTag) fail(400,'Record the returned asset identifier');
  if (task.kind !== 'document') return null;
  const [doc] = task.documentId ? await tx.select().from(documents).where(and(eq(documents.id,task.documentId),eq(documents.employeeId,employeeId))).for('share') : [];
  if (!doc?.documentFile || !new RegExp(`^documents/${employeeId}/[a-f0-9-]+\\.(pdf|png|jpg)$`).test(doc.documentFile)) fail(400,'Select a privately uploaded document for this employee');
  if (task.documentType && doc.documentType !== task.documentType) fail(400,'Select a document of type ' + task.documentType);
  const today = businessToday();
  if (doc.issueDate > today || doc.expiryDate < today) fail(409,'The evidence document must be currently valid');
  const [versions] = await tx.select({version:sql<number>`coalesce(max(${documentVersions.version}),0)::int`}).from(documentVersions).where(eq(documentVersions.documentId,doc.id));
  const snapshot = {id:doc.id,version:versions.version,documentType:doc.documentType,documentFile:doc.documentFile,issueDate:doc.issueDate,expiryDate:doc.expiryDate,updatedAt:doc.updatedAt.toISOString()};
  if (!pin && task.documentSnapshot && JSON.stringify(task.documentSnapshot) !== JSON.stringify(snapshot)) {
    // JSONB key ordering differs from JS insertion order, so compare individual fields.
    const previous = task.documentSnapshot as any;
    if (Object.entries(snapshot).some(([key,value]) => previous[key] !== value)) fail(409,'Document changed after submission; reopen the task and submit current evidence');
  }
  return snapshot;
}
