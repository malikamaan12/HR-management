import { Router } from 'express';
import { eq,sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, pool } from '../db';
import { appSettings, activityLogs } from '@shared/schema';
import { storageCheckResult, type SystemReadiness } from '@shared/system-readiness';
import { authenticate, authorize } from '../middleware/auth';
import { getAppUrl } from '../config';
import { privateStorageConfigured } from '../services/r2';
import { storageConfigurationFingerprint, verifyPrivateStorage, retryStorageCheckCleanup } from '../services/storage-verification';
import { WorkflowError, recordHandler } from '../services/workflowRecords';
import {fileScanStatus} from '../services/file-scan';
import {mfaConfigured} from '../services/mfa';

const router = Router(), key = 'system:storage-verification';
const stateSchema = z.object({ runId: z.string().uuid().nullable(), startedAt: z.string().datetime().nullable(), fingerprint: z.string(), result: storageCheckResult.nullable() });
const initialState = { runId: null, startedAt: null, fingerprint: '', result: null };
const recent = (date: string | null, milliseconds: number) => !!date && Date.now() - Date.parse(date) < milliseconds;
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(authenticate, authorize(['admin', 'super_admin']));

router.get('/recovery-guide', recordHandler(async (_req, res) => {
  const guide = await readFile(path.resolve('docs/Backup-Recovery-Guide.md'), 'utf8');
  res.attachment('E3-HR-Backup-Recovery-Guide.md').type('text/markdown').send(guide);
}));

router.get('/', recordHandler(async (_req, res) => {
  let database: SystemReadiness['database']['status'] = 'unavailable';
  const query = { text: 'SELECT 1 FROM users LIMIT 0', query_timeout: 2000 };
  try { await pool.query(query); database = 'available'; } catch { /* sanitized state */ }
  let originConfigured = false;
  try { originConfigured = !!getAppUrl(); } catch { /* invalid origin is actionable */ }
  const missing = [];
  if (!process.env.RESEND_API_KEY?.trim()) missing.push('Resend API key');
  if (!process.env.EMAIL_FROM?.trim() || !/^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(process.env.EMAIL_FROM.trim().replace(/^.*<([^<>]+)>$/, '$1'))) missing.push('Valid sender email');
  if (!originConfigured) missing.push('Application URL');
  const timezone = process.env.APP_TIMEZONE || 'UTC'; let timezoneValid = true;
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { timezoneValid = false; }
  let state = initialState as z.infer<typeof stateSchema>, historyAvailable = true;
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
    if (row) state = stateSchema.parse(row.value);
  } catch { historyAvailable = false; }
  const configured = privateStorageConfigured();
  const scanner=fileScanStatus();
  let expectedMigrations:number|null=null,appliedMigrations:number|null=null;
  try{expectedMigrations=JSON.parse(await readFile(path.resolve('migrations/meta/_journal.json'),'utf8')).entries.length;appliedMigrations=Number((await db.execute(sql`SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations`)).rows[0].count);}catch{ /* Unknown migration evidence is displayed as unknown, never successful. */ }
  const suppliedRevision=process.env.RENDER_GIT_COMMIT||process.env.APP_RELEASE||'';
  let jobRows:Record<string,unknown>[]=[],jobHistoryAvailable=true;
  try{jobRows=(await db.execute(sql`SELECT name,last_status,last_finished_at,next_run_at,consecutive_failures FROM scheduled_job_runtime ORDER BY name`)).rows;}catch{jobHistoryAvailable=false;}
  const response: SystemReadiness = {
    release:{revision:/^[a-f0-9]{7,40}$/i.test(suppliedRevision)?suppliedRevision:null,expectedMigrations,appliedMigrations},
    security:{mfaConfigured:mfaConfigured(),mfaEnforced:process.env.MFA_ENFORCE_PRIVILEGED==='true',scannerConfigured:scanner.configured,scannerRequired:scanner.required},
    scheduler:{mode:process.env.SCHEDULER_MODE==='external'?'external':'in_process',externalConfigured:(process.env.SCHEDULER_SECRET||'').length>=32,historyAvailable:jobHistoryAvailable,jobs:jobRows.map(row=>({name:String(row.name),lastStatus:row.last_status?String(row.last_status):null,lastFinishedAt:row.last_finished_at?String(row.last_finished_at):null,nextRunAt:String(row.next_run_at),failures:Number(row.consecutive_failures)}))},
    checkedAt: new Date().toISOString(), database: { status: database },
    storage: { configured, provider: process.env.STORAGE_PROVIDER === 'supabase' ? 'Supabase' : process.env.STORAGE_PROVIDER === 'r2' || !process.env.STORAGE_PROVIDER ? 'R2' : 'Unsupported',
      canVerify: configured && process.env.STORAGE_PROVIDER === 'supabase', historyAvailable,
      running: !!state.runId && recent(state.startedAt, 120000), lastCheck: state.result,
      configurationChanged: !!state.result && state.fingerprint !== storageConfigurationFingerprint() },
    email: { configured: !missing.length, missing, delivery: 'not_verified' },
    application: { originConfigured, timezone, timezoneValid },
  };
  res.json(response);
}));

router.post('/storage-check', recordHandler(async (req, res) => {
  z.object({}).strict().parse(req.body);
  if (process.env.STORAGE_PROVIDER !== 'supabase' || !privateStorageConfigured()) throw new WorkflowError(409, 'Configure Supabase private storage before running this check');
  const runId = randomUUID(), fingerprint = storageConfigurationFingerprint();
  await db.transaction(async tx => {
    await tx.insert(appSettings).values({ key, value: initialState }).onConflictDoNothing();
    const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key)).for('update');
    const state = stateSchema.parse(row.value);
    if (state.runId && recent(state.startedAt, 120000)) throw new WorkflowError(409, 'A storage check is already running. Refresh shortly.');
    if (recent(state.result?.checkedAt || null, 60000)) throw new WorkflowError(429, 'Wait one minute between storage checks');
    if (state.result?.cleanupKey) throw new WorkflowError(409, 'Retry temporary-file cleanup before running another check');
    await tx.update(appSettings).set({ value: { ...state, runId, startedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(appSettings.key, key));
    await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'create', entityType: 'storage_verification', details: 'Started a synthetic private storage check' });
  });
  const result = await verifyPrivateStorage();
  await db.transaction(async tx => {
    const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key)).for('update');
    const state = stateSchema.parse(row.value);
    if (state.runId !== runId) throw new WorkflowError(409, 'A newer storage check has started. Refresh the latest result.');
    await tx.update(appSettings).set({ value: { runId: null, startedAt: null, fingerprint, result }, updatedAt: new Date() }).where(eq(appSettings.key, key));
    await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'update', entityType: 'storage_verification', details: `Synthetic private storage check ${result.status}; cleanup ${result.steps.find(step => step.id === 'cleanup')!.status}` });
  });
  res.json(result);
}));

router.post('/storage-cleanup', recordHandler(async (req, res) => {
  const { checkedAt } = z.object({ checkedAt: z.string().datetime() }).strict().parse(req.body);
  const result = await db.transaction(async tx => {
    const [row] = await tx.select().from(appSettings).where(eq(appSettings.key, key)).for('update');
    if (!row) throw new WorkflowError(409, 'Refresh the latest storage check');
    const state = stateSchema.parse(row.value);
    if (state.runId || !state.result?.cleanupKey || state.result.checkedAt !== checkedAt) throw new WorkflowError(409, 'Refresh the latest storage check');
    if (state.fingerprint !== storageConfigurationFingerprint()) throw new WorkflowError(409, 'Storage configuration changed. Restore the original configuration before retrying cleanup.');
    await retryStorageCheckCleanup(state.result.cleanupKey);
    state.result.cleanupKey = null;
    state.result.steps.find(step => step.id === 'cleanup')!.status = 'passed';
    // Preserve the failed full-check status and timestamp until a fresh check.
    await tx.update(appSettings).set({ value: state, updatedAt: new Date() }).where(eq(appSettings.key, key));
    await tx.insert(activityLogs).values({ userId: req.user!.userId, action: 'update', entityType: 'storage_verification', details: 'Removed the pending synthetic storage-check object' });
    return state.result;
  });
  res.json(result);
}));

export default router;
