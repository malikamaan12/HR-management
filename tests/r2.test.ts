import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const transport=vi.hoisted(()=>({send:vi.fn(),sign:vi.fn()}));
vi.mock('@aws-sdk/client-s3',()=>({S3Client:class{send=transport.send;destroy(){}},PutObjectCommand:class{constructor(public input:unknown){}},DeleteObjectCommand:class{constructor(public input:unknown){}},GetObjectCommand:class{constructor(public input:unknown){}}}));
vi.mock('@aws-sdk/s3-request-presigner',()=>({getSignedUrl:transport.sign}));
import { validateDocumentFile, uploadDocument, documentDownloadUrl, uploadCaseAttachment, caseAttachmentUrl, deleteCaseAttachment } from '../server/services/r2';
beforeEach(()=>{vi.stubEnv('R2_ACCOUNT_ID','a'.repeat(32));vi.stubEnv('R2_ACCESS_KEY_ID','test');vi.stubEnv('R2_SECRET_ACCESS_KEY','test');vi.stubEnv('R2_BUCKET_NAME','private-hr');transport.send.mockReset().mockResolvedValue({});transport.sign.mockReset().mockResolvedValue('https://signed.example/download');});
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
