import {Router} from 'express';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {candidates} from '@shared/schema';
import {getAccessScope,hasPermission} from '@shared/permissions';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {recordHandler as handle,recordHistory} from '../services/reportRecords';
import {WorkforceError as OnboardingError} from '../services/workforce';
const router=Router(),id=z.coerce.number().int().positive();
const text=z.string().trim().min(1).max(200);
const fields=z.object({fullNameEn:text.optional(),fullNameAr:text.nullable().optional(),qidNumber:z.string().regex(/^\d{11}$/,'QID must contain 11 digits').nullable().optional(),email:z.string().trim().email().max(254).optional(),phone:text.optional(),linkedinProfile:z.string().url().max(500).refine(url=>/^https?:\/\//i.test(url),'Use an HTTP or HTTPS URL').nullable().optional(),visaStatus:text.nullable().optional()}).strict().refine(v=>Object.keys(v).length>0,'Enter a correction');
function access(req:any,edit=false){if(!hasPermission(req.user.role,'recruitment_onboarding',edit?'update':'read')||getAccessScope(req.user.role,'recruitment_onboarding')!=='all')throw new OnboardingError(403,'Organization-wide recruitment access required');}
async function identityLocked(tx:any,candidateId:number){const r=await tx.execute(sql`SELECT o.id FROM job_offers o JOIN job_applications a ON a.id=o.application_id WHERE a.candidate_id=${candidateId} LIMIT 1`);return r.rows.length>0;}
router.get('/candidates/:id/correction-record',authenticate,handle(async(req,res)=>{
 access(req);const [row]=await db.select().from(candidates).where(eq(candidates.id,id.parse(req.params.id)));if(!row)throw new OnboardingError(404,'Candidate not found');
 res.set('Cache-Control','no-store').json({candidate:row,identityLocked:await identityLocked(db,row.id),canCorrect:hasPermission(req.user.role,'recruitment_onboarding','update')});
}));
router.get('/candidates/:id/corrections',authenticate,handle(async(req,res)=>{
 access(req);const candidateId=id.parse(req.params.id),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
 const r=await db.execute(sql`SELECT version,reason,created_at,snapshot FROM report_correction_history WHERE kind='candidate_correction' AND record_id=${candidateId} ORDER BY version DESC LIMIT 21 OFFSET ${(page-1)*20}`);
 res.set('Cache-Control','no-store').json({items:r.rows.slice(0,20),hasMore:r.rows.length>20});
}));
router.post('/candidates/:id/corrections',authenticate,handle(async(req,res)=>{
 access(req,true);const candidateId=id.parse(req.params.id),input=z.object({expectedVersion:z.number().int().positive(),fields,reason:z.string().trim().min(5).max(1000)}).strict().parse(req.body);
 const saved=await db.transaction(async tx=>{
  const [old]=await tx.select().from(candidates).where(eq(candidates.id,candidateId)).for('update');if(!old)throw new OnboardingError(404,'Candidate not found');
  if(old.recordVersion!==input.expectedVersion)throw new OnboardingError(409,'Candidate changed; reopen the record before saving');
  const changes=Object.fromEntries(Object.entries(input.fields).filter(([key,value])=>old[key as keyof typeof old]!==value)) as z.infer<typeof fields>;
  if(!Object.keys(changes).length)throw new OnboardingError(400,'No changed fields');
  if(['fullNameEn','fullNameAr','qidNumber'].some(key=>key in changes)&&await identityLocked(tx,candidateId))throw new OnboardingError(409,'Candidate identity is frozen once an offer exists; only contact and visa details can be corrected');
  if(changes.qidNumber){const duplicate=await tx.execute(sql`SELECT id FROM candidates WHERE id<>${candidateId} AND regexp_replace(qid_number,'\s','','g')=${changes.qidNumber} LIMIT 1`);if(duplicate.rows.length)throw new OnboardingError(409,'A candidate already uses this QID');}
  // Capture the original state once. Later entries retain the saved version,
  // reason and actor in a private history, in the same transaction as the edit.
  await tx.execute(sql`INSERT INTO report_correction_history(kind,record_id,version,snapshot,actor_id,reason) VALUES ('candidate_correction',${candidateId},${old.recordVersion},${JSON.stringify(old)}::jsonb,${req.user.userId},'Prior candidate state before controlled correction') ON CONFLICT DO NOTHING`);
  const [row]=await tx.update(candidates).set(changes).where(and(eq(candidates.id,candidateId),eq(candidates.recordVersion,input.expectedVersion))).returning();
  await recordHistory(tx,req,'candidate_correction',{...row,version:row.recordVersion},input.reason);return row;
 });res.json(saved);
}));
export default router;
