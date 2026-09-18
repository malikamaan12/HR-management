import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export class StorageUnavailableError extends Error {}
export function privateStorageConfigured(){try{const {client}=configuration();client.destroy();return true;}catch{return false;}}
function configuration(){
  const provider=process.env.STORAGE_PROVIDER || 'r2';
  if(provider==='supabase'){
    const {SUPABASE_S3_ENDPOINT,SUPABASE_S3_REGION,SUPABASE_S3_ACCESS_KEY_ID,SUPABASE_S3_SECRET_ACCESS_KEY,SUPABASE_STORAGE_BUCKET}=process.env;
    if(!SUPABASE_S3_ENDPOINT || !SUPABASE_S3_REGION || !SUPABASE_S3_ACCESS_KEY_ID || !SUPABASE_S3_SECRET_ACCESS_KEY || !SUPABASE_STORAGE_BUCKET)throw new StorageUnavailableError('Document storage is not configured');
    let endpoint:URL;
    try{endpoint=new URL(SUPABASE_S3_ENDPOINT);}catch{throw new StorageUnavailableError('Invalid Supabase storage configuration');}
    if(endpoint.protocol!=='https:' || !/^[a-z0-9-]+\.(storage\.)?supabase\.co$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/storage\/v1\/s3\/?$/.test(endpoint.pathname))throw new StorageUnavailableError('Invalid Supabase storage configuration');
    return {bucket:SUPABASE_STORAGE_BUCKET,client:new S3Client({region:SUPABASE_S3_REGION,endpoint:endpoint.toString().replace(/\/$/,''),forcePathStyle:true,
      credentials:{accessKeyId:SUPABASE_S3_ACCESS_KEY_ID,secretAccessKey:SUPABASE_S3_SECRET_ACCESS_KEY},maxAttempts:2,
      requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'})};
  }
  if(provider!=='r2')throw new StorageUnavailableError('Unsupported document storage provider');
  const {R2_ACCOUNT_ID,R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY,R2_BUCKET_NAME}=process.env;
  if(!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME)throw new StorageUnavailableError('Document storage is not configured');
  if(!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID))throw new StorageUnavailableError('Invalid R2 account configuration');
  return {bucket:R2_BUCKET_NAME,client:new S3Client({region:'auto',endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:R2_ACCESS_KEY_ID,secretAccessKey:R2_SECRET_ACCESS_KEY},maxAttempts:2})};
}
export function validateDocumentFile(file: Pick<Express.Multer.File,'buffer'|'size'>): 'pdf'|'png'|'jpg' {
  if(file.size<1 || file.size>10*1024*1024)throw new Error('Choose a file between 1 byte and 10 MB');
  const data=file.buffer;
  if(data.subarray(0,5).toString()==='%PDF-')return 'pdf';
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(data[0]===255 && data[1]===216 && data[2]===255)return 'jpg';
  throw new Error('Choose a PDF, PNG, or JPEG document');
}
export async function uploadDocument(employeeId:number,file:Express.Multer.File){
  const extension=validateDocumentFile(file),{client,bucket}=configuration();
  const key=`documents/${employeeId}/${randomUUID()}.${extension}`;
  try {await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:file.buffer,ContentType:'application/octet-stream',ContentDisposition:'attachment'}));return key;}
  finally {client.destroy();}
}
export async function deleteDocumentObject(key:string){
  if(!/^documents\/\d+\/[a-f0-9-]+\.(pdf|png|jpg)$/.test(key))throw new Error('Invalid document object');
  const {client,bucket}=configuration();try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}finally{client.destroy();}
}
export async function documentDownloadUrl(key:string){
  if(!/^documents\/\d+\/[a-f0-9-]+\.(pdf|png|jpg)$/.test(key))throw new Error('This legacy document needs to be uploaded again');
  const {client,bucket}=configuration();try{return await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:'attachment',ResponseContentType:'application/octet-stream'}),{expiresIn:60});}finally{client.destroy();}
}

// Case files never share the general employee-document download namespace.
const caseKey=/^helpdesk\/\d+\/[a-f0-9-]+\.(pdf|png|jpg)$/;
export async function uploadCaseAttachment(caseId:number,file:Express.Multer.File){
  const extension=validateDocumentFile(file),{client,bucket}=configuration();
  const key=`helpdesk/${caseId}/${randomUUID()}.${extension}`;
  try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:file.buffer,ContentType:'application/octet-stream',ContentDisposition:'attachment'}));return key;}finally{client.destroy();}
}
export async function deleteCaseAttachment(key:string){
  if(!caseKey.test(key))throw new Error('Invalid case attachment');
  const {client,bucket}=configuration();try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}finally{client.destroy();}
}
export async function caseAttachmentUrl(key:string){
  if(!caseKey.test(key))throw new Error('Invalid case attachment');
  const {client,bucket}=configuration();try{return await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:'attachment',ResponseContentType:'application/octet-stream'}),{expiresIn:60});}finally{client.destroy();}
}

const serviceKey=/^employee-services\/(learning|benefit|expense)\/\d+\/[a-f0-9-]+\.(pdf|png|jpg)$/;
export async function uploadServiceFile(kind:'learning'|'benefit'|'expense',id:number,file:Express.Multer.File){
  const extension=validateDocumentFile(file),{client,bucket}=configuration(),key=`employee-services/${kind}/${id}/${randomUUID()}.${extension}`;
  try{await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:file.buffer,ContentType:'application/octet-stream',ContentDisposition:'attachment'}));return key;}finally{client.destroy();}
}
export async function deleteServiceFile(key:string){if(!serviceKey.test(key))throw new Error('Invalid service file');const {client,bucket}=configuration();try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));}finally{client.destroy();}}
export async function serviceFileUrl(key:string){if(!serviceKey.test(key))throw new Error('Invalid service file');const {client,bucket}=configuration();try{return await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentDisposition:'attachment',ResponseContentType:'application/octet-stream'}),{expiresIn:60});}finally{client.destroy();}}

// Internal training media shares the configured private storage, with its own
// namespace. No public bucket, external video host or transcoding service.
const inductionKey=/^induction\/(course-\d+|branding)\/[a-f0-9-]+\.(pdf|png|jpg|mp4|webm)$/;
export function validateInductionFile(file:Pick<Express.Multer.File,'buffer'|'size'>,logo=false){
 const data=file.buffer;
 if(file.size<1||file.size>(logo?2:40)*1024*1024)throw new Error(logo?'Choose a logo up to 2 MB':'Choose a training asset up to 40 MB');
 if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {extension:'png',mime:'image/png'};
 if(data[0]===255&&data[1]===216&&data[2]===255)return {extension:'jpg',mime:'image/jpeg'};
 if(!logo){
  if(data.subarray(0,5).toString()==='%PDF-')return {extension:'pdf',mime:'application/pdf'};
  if(data.length>=12&&data.subarray(4,8).toString()==='ftyp')return {extension:'mp4',mime:'video/mp4'};
  if(data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&data.subarray(0,4096).includes(Buffer.from('webm')))return {extension:'webm',mime:'video/webm'};
 }
 throw new Error(logo?'Use a PNG or JPEG logo':'Use a PDF, PNG, JPEG, MP4 or WebM file');
}
export async function uploadInductionAsset(courseId:number|null,file:Express.Multer.File){
 const type=validateInductionFile(file,courseId===null),{client,bucket}=configuration();
 const key=`induction/${courseId===null?'branding':'course-'+courseId}/${randomUUID()}.${type.extension}`;
 try{
  await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:file.buffer,ContentType:type.mime,ContentDisposition:'inline'}),{abortSignal:AbortSignal.timeout(45000)});
  return {key,mime:type.mime};
 }catch(error){try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(10000)});}catch{console.error('Training asset upload cleanup pending');}throw error;}
 finally{client.destroy();}
}
export async function deleteInductionAsset(key:string){if(!inductionKey.test(key))throw new Error('Invalid training asset');const {client,bucket}=configuration();try{await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:AbortSignal.timeout(10000)});}finally{client.destroy();}}
export async function inductionAssetUrl(key:string,mime:string){
 if(!inductionKey.test(key)||!['application/pdf','image/png','image/jpeg','video/mp4','video/webm'].includes(mime))throw new Error('Invalid training asset');
 const {client,bucket}=configuration();try{return await getSignedUrl(client,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentType:mime,ResponseContentDisposition:'inline'}),{expiresIn:900});}finally{client.destroy();}
}
