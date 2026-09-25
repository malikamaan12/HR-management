import {createServer,type Server} from 'node:net';
import {test,expect,afterEach,vi} from 'vitest';
import {scanUpload} from '../server/services/file-scan';
let server:Server|undefined;
afterEach(async()=>{if(server)await new Promise<void>(r=>server!.close(()=>r()));server=undefined;vi.unstubAllEnvs();});
async function scanner(reply:string){
 let received=Buffer.alloc(0);
 server=createServer(socket=>{socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.length>=14){const length=received.readUInt32BE(10);if(received.length>=18+length)socket.end(reply);}});});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));vi.stubEnv('CLAMD_HOST','127.0.0.1');vi.stubEnv('CLAMD_PORT',String((server.address() as any).port));return ()=>received;
}
test('required scanning fails closed if the daemon is not provisioned',async()=>{vi.stubEnv('CLAMD_HOST','');vi.stubEnv('FILE_SCAN_REQUIRED','true');await expect(scanUpload(Buffer.from('test'))).rejects.toThrow('configured');});
test('streams bytes using ClamAV INSTREAM framing and accepts only a clean response',async()=>{const bytes=Buffer.from('synthetic test file'),received=await scanner('stream: OK\0');await expect(scanUpload(bytes)).resolves.toBeUndefined();expect(received().subarray(0,10).toString()).toBe('zINSTREAM\0');expect(received().readUInt32BE(10)).toBe(bytes.length);expect(received().subarray(14,-4)).toEqual(bytes);expect(received().readUInt32BE(received().length-4)).toBe(0);});
test.each(['stream: Synthetic-Signature FOUND\0','INSTREAM size limit exceeded. ERROR\0','invalid\0','stream: OK'])('rejects malware, errors and incomplete responses: %s',async(reply)=>{await scanner(reply);await expect(scanUpload(Buffer.from('test'))).rejects.toThrow();});
