import { randomUUID, createHmac } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { configuration } from './r2';
import { storageStepNames, type StorageCheckResult } from '@shared/system-readiness';

export function storageConfigurationFingerprint() {
  return createHmac('sha256', process.env.JWT_SECRET || 'local-readiness')
    .update(JSON.stringify(['STORAGE_PROVIDER', 'SUPABASE_S3_ENDPOINT', 'SUPABASE_S3_REGION', 'SUPABASE_S3_ACCESS_KEY_ID', 'SUPABASE_S3_SECRET_ACCESS_KEY', 'SUPABASE_STORAGE_BUCKET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'].map(key => process.env[key] || ''))).digest('hex');
}

export async function retryStorageCheckCleanup(key: string) {
  if (!/^deployment-checks\/[a-f0-9-]+\.txt$/.test(key) || process.env.STORAGE_PROVIDER !== 'supabase') throw new Error('Invalid cleanup request');
  const { client, bucket } = configuration();
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) }); }
  finally { client.destroy(); }
}

async function boundedBody(body: AsyncIterable<Uint8Array> | null | undefined) {
  if (!body) throw new Error('Missing response');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > 1024) throw new Error('Unexpected response size');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Fixed server configuration and a fresh synthetic key only; callers cannot
// choose destinations or inspect an existing employee file.
export async function verifyPrivateStorage(): Promise<StorageCheckResult> {
  if (process.env.STORAGE_PROVIDER !== 'supabase') throw new Error('Supabase private storage is required');
  const { client, bucket } = configuration();
  const key = `deployment-checks/${randomUUID()}.txt`, object = { Bucket: bucket, Key: key };
  const content = Buffer.from(`E3 HR temporary storage check ${randomUUID()}`);
  const result: StorageCheckResult = { checkedAt: new Date().toISOString(), status: 'failed',
    steps: Object.keys(storageStepNames).map(id => ({ id: id as keyof typeof storageStepNames, status: 'not_run' })), cleanupKey: null };
  const mark = (id: keyof typeof storageStepNames, status: 'passed' | 'failed') => { result.steps.find(step => step.id === id)!.status = status; };
  let step: keyof typeof storageStepNames = 'upload', attempted = false;
  const signal = AbortSignal.timeout(45000);
  try {
    attempted = true;
    await client.send(new PutObjectCommand({ ...object, Body: content, ContentType: 'application/octet-stream', ContentDisposition: 'attachment' }), { abortSignal: signal });
    mark(step, 'passed'); step = 'read';
    const stored = await client.send(new GetObjectCommand(object), { abortSignal: signal });
    if (!content.equals(await boundedBody(stored.Body as AsyncIterable<Uint8Array>))) throw new Error('Content mismatch');
    mark(step, 'passed'); step = 'download';
    const signedUrl = await getSignedUrl(client, new GetObjectCommand({ ...object, ResponseContentType: 'application/octet-stream', ResponseContentDisposition: 'attachment' }), { expiresIn: 60 });
    const download = await fetch(signedUrl, { signal, redirect: 'error' });
    if (!download.ok || !download.headers.get('content-disposition')?.includes('attachment')) { await download.body?.cancel(); throw new Error('Attachment unavailable'); }
    if (!content.equals(await boundedBody(download.body as unknown as AsyncIterable<Uint8Array>))) throw new Error('Download mismatch');
    mark(step, 'passed'); step = 'privacy';
    const endpoint = new URL(process.env.SUPABASE_S3_ENDPOINT!);
    const origin = `https://${endpoint.hostname.replace('.storage.supabase.co', '.supabase.co')}`;
    const anonymous = await fetch(`${origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`, { signal, redirect: 'manual' });
    await anonymous.body?.cancel();
    if (![400, 401, 403, 404].includes(anonymous.status)) throw new Error('Anonymous access not denied');
    mark(step, 'passed');
  } catch {
    // SDK errors and response URLs may contain credentials. Return stage status only.
    mark(step, 'failed');
  } finally {
    try {
      if (attempted) { await client.send(new DeleteObjectCommand(object), { abortSignal: AbortSignal.timeout(10000) }); mark('cleanup', 'passed'); }
    } catch { mark('cleanup', 'failed'); result.cleanupKey = key; }
    client.destroy();
  }
  result.checkedAt = new Date().toISOString();
  result.status = result.steps.every(item => item.status === 'passed') ? 'passed' : 'failed';
  return result;
}
