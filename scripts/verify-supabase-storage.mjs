import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

if (existsSync('.env')) loadEnvFile('.env');

// A disposable synthetic object only. Never accepts an existing object key.
async function verify() {
  const { STORAGE_PROVIDER, SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION,
    SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY, SUPABASE_STORAGE_BUCKET } = process.env;
  if (STORAGE_PROVIDER !== 'supabase' || !SUPABASE_S3_ENDPOINT || !SUPABASE_S3_REGION ||
      !SUPABASE_S3_ACCESS_KEY_ID || !SUPABASE_S3_SECRET_ACCESS_KEY || !SUPABASE_STORAGE_BUCKET) {
    throw new Error('Configure the Supabase server storage variables first.');
  }
  const endpoint = new URL(SUPABASE_S3_ENDPOINT);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.(storage\.)?supabase\.co$/.test(endpoint.hostname) ||
      endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/storage\/v1\/s3\/?$/.test(endpoint.pathname)) throw new Error('Invalid storage endpoint.');
  const client = new S3Client({ region: SUPABASE_S3_REGION, endpoint: endpoint.toString().replace(/\/$/, ''),
    forcePathStyle: true, maxAttempts: 2, credentials: { accessKeyId: SUPABASE_S3_ACCESS_KEY_ID, secretAccessKey: SUPABASE_S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const key = `deployment-checks/${randomUUID()}.png`;
  const object = { Bucket: SUPABASE_STORAGE_BUCKET, Key: key };
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6dscAAAAASUVORK5CYII=', 'base64');
  let uploadAttempted = false;
  const send = command => client.send(command, { abortSignal: AbortSignal.timeout(20000) });
  try {
    uploadAttempted = true;
    await send(new PutObjectCommand({ ...object, Body: bytes, ContentType: 'application/octet-stream', ContentDisposition: 'attachment' }));
    const stored = await send(new GetObjectCommand(object));
    if (!Buffer.from(await stored.Body.transformToByteArray()).equals(bytes)) throw new Error('Stored bytes did not match.');
    const signed = await getSignedUrl(client, new GetObjectCommand({ ...object,
      ResponseContentDisposition: 'attachment', ResponseContentType: 'application/octet-stream' }), { expiresIn: 60 });
    const downloaded = await fetch(signed, { signal: AbortSignal.timeout(20000) });
    if (!downloaded.ok || !Buffer.from(await downloaded.arrayBuffer()).equals(bytes)) throw new Error('Signed download failed.');
    if (!downloaded.headers.get('content-disposition')?.includes('attachment')) throw new Error('Download was not an attachment.');
    const publicOrigin = `https://${endpoint.hostname.replace('.storage.supabase.co', '.supabase.co')}`;
    const publicUrl = `${publicOrigin}/storage/v1/object/public/${encodeURIComponent(object.Bucket)}/${key}`;
    const anonymous = await fetch(publicUrl, { signal: AbortSignal.timeout(20000), redirect: 'manual' });
    if (![400, 401, 403, 404].includes(anonymous.status)) throw new Error('Public access was not denied.');
    await anonymous.body?.cancel();
    console.log('Private storage verified: upload, byte-for-byte read, signed attachment download, and public-access denial.');
  } finally {
    try {
      if (uploadAttempted) {
        await send(new DeleteObjectCommand(object));
        console.log('Disposable storage verification object removed.');
      }
    } finally { client.destroy(); }
  }
}

try { await verify(); }
catch {
  // SDK and fetch errors can contain signed URLs; never print the raw error.
  console.error('Private storage verification failed. Check server configuration, bucket privacy, and connectivity.');
  process.exitCode = 1;
}
