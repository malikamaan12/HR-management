import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const transport=vi.hoisted(()=>({send:vi.fn(),sign:vi.fn(),configure:vi.fn()}));
vi.mock('@aws-sdk/client-s3',()=>({S3Client:class{constructor(configuration:unknown){transport.configure(configuration);}send=transport.send;destroy(){}},PutObjectCommand:class{constructor(public input:unknown){}},DeleteObjectCommand:class{constructor(public input:unknown){}},GetObjectCommand:class{constructor(public input:unknown){}}}));
vi.mock('@aws-sdk/s3-request-presigner',()=>({getSignedUrl:transport.sign}));
import { privateStorageConfigured, validateDocumentFile, uploadDocument, documentDownloadUrl, uploadCaseAttachment, caseAttachmentUrl, deleteCaseAttachment } from '../server/services/r2';
beforeEach(()=>{vi.stubEnv('STORAGE_PROVIDER','r2');vi.stubEnv('R2_ACCOUNT_ID','a'.repeat(32));vi.stubEnv('R2_ACCESS_KEY_ID','test');vi.stubEnv('R2_SECRET_ACCESS_KEY','test');vi.stubEnv('R2_BUCKET_NAME','private-hr');transport.configure.mockReset();transport.send.mockReset().mockResolvedValue({});transport.sign.mockReset().mockResolvedValue('https://signed.example/download');});
afterEach(()=>vi.unstubAllEnvs());
test('validates file signatures and bounds before storage',()=>{
  expect(validateDocumentFile({buffer:Buffer.from('%PDF-test'),size:9})).toBe('pdf');
  expect(()=>validateDocumentFile({buffer:Buffer.from('<script>'),size:8})).toThrow(/PDF/);
  expect(()=>validateDocumentFile({buffer:Buffer.alloc(1),size:11*1024*1024})).toThrow(/10 MB/);
});
test('uses a unique employee object key and private attachment metadata',async()=>{
  const key=await uploadDocument(7,{buffer:Buffer.from('%PDF-test'),size:9} as Express.Multer.File);
  expect(key).toMatch(/^documents\/7\/[a-f0-9-]+\.pdf$/);
  expect(transport.send.mock.calls[0][0].input).toMatchObject({Bucket:'private-hr',Key:key,ContentDisposition:'attachment'});
});
test('refuses missing storage configuration and foreign object paths',async()=>{
  vi.stubEnv('R2_BUCKET_NAME','');
  await expect(uploadDocument(1,{buffer:Buffer.from('%PDF-test'),size:9} as Express.Multer.File)).rejects.toThrow(/not configured/);
  await expect(documentDownloadUrl('https://untrusted.example/file')).rejects.toThrow(/uploaded again/);
  expect(transport.send).not.toHaveBeenCalled();
});
test('download links expire in one minute and force attachment handling',async()=>{
  await documentDownloadUrl('documents/7/1234-abcd.pdf');
  expect(transport.sign.mock.calls[0][1].input).toMatchObject({ResponseContentDisposition:'attachment',ResponseContentType:'application/octet-stream'});
  expect(transport.sign.mock.calls[0][2]).toEqual({expiresIn:60});
});
test('helpdesk objects use their own namespace and remain private attachments',async()=>{
  const key=await uploadCaseAttachment(9,{buffer:Buffer.from('%PDF-test'),size:9} as Express.Multer.File);
  expect(key).toMatch(/^helpdesk\/9\/[a-f0-9-]+\.pdf$/);
  expect(transport.send.mock.calls[0][0].input).toMatchObject({Key:key,ContentDisposition:'attachment',ContentType:'application/octet-stream'});
  await caseAttachmentUrl(key);expect(transport.sign.mock.calls[0][2]).toEqual({expiresIn:60});
  await expect(documentDownloadUrl(key)).rejects.toThrow(/uploaded again/);
  await expect(caseAttachmentUrl('documents/9/abcd.pdf')).rejects.toThrow(/Invalid/);
  await expect(deleteCaseAttachment('helpdesk/9/../../documents/9/abcd.pdf')).rejects.toThrow(/Invalid/);
});

function configureSupabase(){
  vi.stubEnv('STORAGE_PROVIDER','supabase');vi.stubEnv('SUPABASE_S3_ENDPOINT','https://project-ref.storage.supabase.co/storage/v1/s3');
  vi.stubEnv('SUPABASE_S3_REGION','eu-central-1');vi.stubEnv('SUPABASE_S3_ACCESS_KEY_ID','supabase-test-id');
  vi.stubEnv('SUPABASE_S3_SECRET_ACCESS_KEY','supabase-test-secret');vi.stubEnv('SUPABASE_STORAGE_BUCKET','private-hr');
}

test('Supabase storage preserves private document and case uploads, signed downloads and cleanup',async()=>{
  configureSupabase();expect(privateStorageConfigured()).toBe(true);
  const file={buffer:Buffer.from('%PDF-test'),size:9} as Express.Multer.File;
  const document=await uploadDocument(7,file),attachment=await uploadCaseAttachment(9,file);
  expect(transport.configure.mock.calls[0][0]).toMatchObject({region:'eu-central-1',endpoint:'https://project-ref.storage.supabase.co/storage/v1/s3',forcePathStyle:true,credentials:{accessKeyId:'supabase-test-id',secretAccessKey:'supabase-test-secret'},requestChecksumCalculation:'WHEN_REQUIRED'});
  for(const [command] of transport.send.mock.calls)expect(command.input).toMatchObject({Bucket:'private-hr',ContentDisposition:'attachment',ContentType:'application/octet-stream'});
  await documentDownloadUrl(document);await caseAttachmentUrl(attachment);
  for(const [,command,options] of transport.sign.mock.calls){expect(command.input).toMatchObject({Bucket:'private-hr',ResponseContentDisposition:'attachment'});expect(options.expiresIn).toBe(60);}
  await deleteCaseAttachment(attachment);expect(transport.send.mock.calls.at(-1)?.[0].input).toEqual({Bucket:'private-hr',Key:attachment});
});

test('missing Supabase configuration cannot silently send HR files to configured R2 credentials',async()=>{
  configureSupabase();vi.stubEnv('SUPABASE_S3_SECRET_ACCESS_KEY','');
  expect(privateStorageConfigured()).toBe(false);
  await expect(uploadDocument(1,{buffer:Buffer.from('%PDF-test'),size:9} as Express.Multer.File)).rejects.toThrow(/not configured/);
  expect(transport.send).not.toHaveBeenCalled();expect(transport.configure).not.toHaveBeenCalled();
});

test('invalid providers and Supabase endpoints fail before transmitting credentials or documents',async()=>{
  configureSupabase();
  for(const endpoint of ['http://project.supabase.co/storage/v1/s3','https://project.supabase.co.evil.example/storage/v1/s3','https://user:pass@project.supabase.co/storage/v1/s3','https://project.supabase.co:444/storage/v1/s3','https://project.supabase.co/storage/v1/s3?x=1','https://project.supabase.co/other']){
    vi.stubEnv('SUPABASE_S3_ENDPOINT',endpoint);expect(privateStorageConfigured()).toBe(false);
  }
  vi.stubEnv('STORAGE_PROVIDER','unknown');expect(privateStorageConfigured()).toBe(false);
  expect(transport.send).not.toHaveBeenCalled();expect(transport.configure).not.toHaveBeenCalled();
});
