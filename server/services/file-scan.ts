import {createConnection} from 'node:net';

export function fileScanStatus(){return {configured:!!process.env.CLAMD_HOST?.trim(),required:process.env.FILE_SCAN_REQUIRED==='true'};}
// Only administrators configure this trusted, private-network daemon. Never accept a host from a request.
// Files remain in upload memory until ClamAV positively reports clean; no quarantined public objects.
export async function scanUpload(data:Buffer):Promise<void>{
 const {configured,required}=fileScanStatus();
 if(!configured){if(required)throw new Error('Uploads are unavailable until malware scanning is configured.');return;}
 const port=Number(process.env.CLAMD_PORT||3310);
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Malware scanning is unavailable.');
 if(data.length<1||data.length>40*1024*1024)throw new Error('File exceeds the malware scanning limit.');
 await new Promise<void>((resolve,reject)=>{
  const socket=createConnection({host:process.env.CLAMD_HOST!.trim(),port});let response='',settled=false;
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve();};
  const unavailable=()=>finish(new Error('Malware scanning could not verify this file. Try again later.'));
  const timer=setTimeout(unavailable,30000);
  socket.once('connect',()=>{const length=Buffer.alloc(4);length.writeUInt32BE(data.length);socket.write(Buffer.from('zINSTREAM\0'));socket.write(length);socket.write(data);socket.write(Buffer.alloc(4));});
  socket.on('data',chunk=>{response+=chunk.toString('utf8');if(response.length>4096){unavailable();return;}const end=response.indexOf('\0');if(end<0)return;const result=response.slice(0,end);if(result==='stream: OK')finish();else if(/^stream: .+ FOUND$/.test(result))finish(new Error('This file was rejected by malware scanning.'));else unavailable();});
  socket.once('error',unavailable);socket.once('close',()=>{if(!settled)unavailable();});
 });
}
