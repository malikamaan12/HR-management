import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Readable } from 'node:stream';
const mock = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), signed: vi.fn() }));
vi.mock('../server/services/r2', () => ({ configuration: () => ({ client: { send: mock.send, destroy: mock.destroy }, bucket: 'private-hr' }) }));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mock.signed }));
import { verifyPrivateStorage, retryStorageCheckCleanup, storageConfigurationFingerprint } from '../server/services/storage-verification';
let content: Buffer;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STORAGE_PROVIDER', 'supabase'); vi.stubEnv('SUPABASE_S3_ENDPOINT', 'https://synthetic.storage.supabase.co/storage/v1/s3');
  mock.signed.mockResolvedValue('https://synthetic.storage.supabase.co/signed?secret=PRIVATE');
  mock.send.mockImplementation(async command => {
    if (command.constructor.name === 'PutObjectCommand') content = command.input.Body;
    if (command.constructor.name === 'GetObjectCommand') return { Body: Readable.from([content]) };
    return {};
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/public/') ? new Response('', { status: 403 }) : new Response(content, { headers: { 'content-disposition': 'attachment' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test('verifies only a synthetic key and removes it after all private-storage checks', async () => {
  const result = await verifyPrivateStorage();
  expect(result.status).toBe('passed'); expect(result.steps.every(step => step.status === 'passed')).toBe(true); expect(result.cleanupKey).toBeNull();
  const inputs = mock.send.mock.calls.map(([command]) => command.input);
  expect(inputs.every(input => /^deployment-checks\/[a-f0-9-]+\.txt$/.test(input.Key))).toBe(true);
  expect(new Set(inputs.map(input => input.Key)).size).toBe(1);
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(mock.destroy).toHaveBeenCalledOnce();
});

test('public access causes a failed privacy stage even when reads work', async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response(content, { headers: { 'content-disposition': 'attachment' } }));
  const result = await verifyPrivateStorage();
  expect(result.status).toBe('failed'); expect(result.steps.find(step => step.id === 'privacy')?.status).toBe('failed');
  expect(result.steps.find(step => step.id === 'cleanup')?.status).toBe('passed');
});

test('a read failure does not run later checks and still removes the upload without exposing provider errors', async () => {
  mock.send.mockImplementation(async command => { if (command.constructor.name === 'GetObjectCommand') throw new Error('PRIVATE credentials and signed URL'); return {}; });
  const result = await verifyPrivateStorage();
  expect(result.steps.map(step => step.status)).toEqual(['passed', 'failed', 'not_run', 'not_run', 'passed']);
  expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(fetch).not.toHaveBeenCalled();
});

test('an ambiguous upload failure still attempts cleanup and preserves a cleanup reference when removal fails', async () => {
  mock.send.mockRejectedValue(new Error('PRIVATE provider error'));
  const result = await verifyPrivateStorage();
  expect(result.steps.map(step => step.status)).toEqual(['failed', 'not_run', 'not_run', 'not_run', 'failed']);
  expect(result.cleanupKey).toMatch(/^deployment-checks\//); expect(mock.send.mock.calls[1][0].constructor.name).toBe('DeleteObjectCommand');
});

test('oversized or mismatched download fails without reporting success', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('x'.repeat(2048), { headers: { 'content-disposition': 'attachment' } }));
  const result = await verifyPrivateStorage(); expect(result.steps.find(step => step.id === 'download')?.status).toBe('failed'); expect(result.status).toBe('failed');
});

test('cleanup rejects business object keys and configuration fingerprints change with credentials', async () => {
  await expect(retryStorageCheckCleanup('documents/1/123.pdf')).rejects.toThrow(); expect(mock.send).not.toHaveBeenCalled();
  const before = storageConfigurationFingerprint(); vi.stubEnv('SUPABASE_S3_SECRET_ACCESS_KEY', 'changed-secret'); expect(storageConfigurationFingerprint()).not.toBe(before);
});
