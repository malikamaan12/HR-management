import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

export class StorageUnavailableError extends Error {}
function configuration(){
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
