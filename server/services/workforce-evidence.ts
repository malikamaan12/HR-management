import {and,eq,sql} from 'drizzle-orm';
import {documents,documentVersions,employees} from '@shared/schema';
import {renewalPolicy,type RenewalPolicy} from '@shared/workforce-renewals';
import {employeeScope} from './access';
import {isDocumentArchived} from './retention';
import {fail,type WorkforceTransaction} from './workforce';
import type {TokenPayload} from './auth';
import {localDate} from '@shared/workforce';

export type RenewalEvidence={id:number;version:number;documentType:string;documentFile:string;issueDate:string;expiryDate:string;updatedAt:string};
export async function readRenewalEvidence(tx:WorkforceTransaction,id:number){
  const row=(await tx.execute(sql`SELECT snapshot FROM workforce_renewal_evidence WHERE renewal_id=${id}`)).rows[0];return (row?.snapshot as RenewalEvidence)||null;
}
export const publicRenewalEvidence=(v:RenewalEvidence|null)=>v?{id:v.id,version:v.version,documentType:v.documentType,issueDate:v.issueDate,expiryDate:v.expiryDate}:null;
export async function pinRenewalEvidence(tx:WorkforceTransaction,user:TokenPayload,employeeId:number,documentId:number|null,config:RenewalPolicy,previous?:RenewalEvidence|null){
  const policy=renewalPolicy.parse(config);
  if(!documentId){if(policy.evidenceRequired)fail(400,'Attach a private certificate document required by the renewal policy');return null;}
  const [employee]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,employeeId),employeeScope(user,'compliance_documents')));
  if(!employee)fail(403,'Private document access is required to use certificate evidence');
  const [document]=await tx.select().from(documents).where(and(eq(documents.id,documentId),eq(documents.employeeId,employeeId))).for('share');
  if(!document?.documentFile||!new RegExp(`^documents/${employeeId}/[a-f0-9-]+\\.(pdf|png|jpg)$`).test(document.documentFile))fail(400,'Choose a privately uploaded document belonging to this employee');
  if(await isDocumentArchived(tx,documentId))fail(409,'Restore the archived document before submitting it as qualification evidence');
  if(policy.documentType&&document.documentType!==policy.documentType)fail(400,'The renewal policy requires document type '+policy.documentType);
  const today=localDate(new Date(),policy.timezone);
  if(document.issueDate>today||document.expiryDate<today)fail(400,'Choose a certificate document that is currently valid');
  const [version]=await tx.select({version:sql<number>`coalesce(max(${documentVersions.version}),0)::integer`}).from(documentVersions).where(eq(documentVersions.documentId,document.id));
  const snapshot:RenewalEvidence={id:document.id,version:version.version,documentType:document.documentType,documentFile:document.documentFile,issueDate:document.issueDate,expiryDate:document.expiryDate,updatedAt:document.updatedAt.toISOString()};
  if(previous&&Object.entries(snapshot).some(([key,value])=>previous[key as keyof RenewalEvidence]!==value))fail(409,'Certificate evidence changed after submission. Return the renewal so the current document can be submitted again.');
  return snapshot;
}
export async function saveRenewalEvidence(tx:WorkforceTransaction,user:TokenPayload,renewalId:number,evidence:RenewalEvidence|null){
  if(!evidence){await tx.execute(sql`DELETE FROM workforce_renewal_evidence WHERE renewal_id=${renewalId}`);return;}
  await tx.execute(sql`INSERT INTO workforce_renewal_evidence(renewal_id,document_id,snapshot,attached_by) VALUES (${renewalId},${evidence.id},${JSON.stringify(evidence)}::jsonb,${user.userId}) ON CONFLICT(renewal_id) DO UPDATE SET document_id=excluded.document_id,snapshot=excluded.snapshot,attached_by=excluded.attached_by,updated_at=now()`);
}
