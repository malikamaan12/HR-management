import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {db} from '../db';
import {WorkflowError} from './workflowRecords';

export const mfaConfigured=()=>/^[a-fA-F0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY||'');
export const mfaRequired=(role:string)=>process.env.MFA_ENFORCE_PRIVILEGED==='true'&&['admin','super_admin','hr','hr_director','hr_manager','payroll_specialist','finance','finance_audit'].includes(role);
function encryptionKey(){if(!mfaConfigured())throw new WorkflowError(503,'MFA setup requires the service encryption key. Contact your administrator.');return Buffer.from(process.env.MFA_ENCRYPTION_KEY!,'hex');}
function seal(secret:Buffer,userId:number){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from(String(userId)));return [iv,cipher.update(secret),cipher.final(),cipher.getAuthTag()].map(b=>b.toString('hex')).join(':');}
function open(value:string,userId:number){const [iv,data,tail,tag]=value.split(':').map(v=>Buffer.from(v,'hex'));const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),iv);cipher.setAAD(Buffer.from(String(userId)));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.update(tail),cipher.final()]);}
export function totp(secret:Buffer,step:number,digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',secret).update(counter).digest(),offset=h[h.length-1]&15;return String((h.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function base32(value:Buffer){let bits=0,acc=0,out='';const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';for(const byte of value){acc=(acc<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(acc>>>bits)&31];}}if(bits)out+=alphabet[(acc<<(5-bits))&31];return out;}
const digest=(code:string)=>createHash('sha256').update(code).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function mfaState(tx:any,userId:number){return (await tx.execute(sql`SELECT enabled,version FROM account_mfa WHERE user_id=${userId}`)).rows[0] as {enabled:boolean;version:number}|undefined;}
export async function verifyMfa(userId:number,code:string):Promise<number|null>{
 const result=await db.transaction(async tx=>{
  const row=(await tx.execute(sql`SELECT * FROM account_mfa WHERE user_id=${userId} FOR UPDATE`)).rows[0];
  if(!row?.enabled)return {version:null};
  if(row.locked_until&&new Date(String(row.locked_until))>new Date())return {error:true};
  let step=-1;const recovery=(row.recovery_hashes||[]) as string[];let recoveryIndex=-1;
  if(/^\d{6}$/.test(code)){const current=Math.floor(Date.now()/30000),secret=open(String(row.secret_ciphertext),userId);for(const n of [current,current-1,current+1])if(n>Number(row.last_step)&&equal(totp(secret,n),code)){step=n;break;}}
  else if(/^[a-f0-9]{24}$/i.test(code))recoveryIndex=recovery.indexOf(digest(code.toLowerCase()));
  if(step<0&&recoveryIndex<0){await tx.execute(sql`UPDATE account_mfa SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE user_id=${userId}`);return {error:true};}
  if(recoveryIndex>=0)recovery.splice(recoveryIndex,1);
  await tx.execute(sql`UPDATE account_mfa SET last_step=${step>=0?step:Number(row.last_step)},recovery_hashes=${JSON.stringify(recovery)}::jsonb,failed_attempts=0,locked_until=NULL WHERE user_id=${userId}`);
  return {version:Number(row.version)};
 });
 if('error' in result)throw new WorkflowError(401,'Enter a valid authenticator or unused recovery code. Wait 15 minutes after repeated failures.');return result.version;
}
export async function startMfa(tx:any,userId:number,username:string,replacementVersion?:number){
 const secret=randomBytes(20),ciphertext=seal(secret,userId);
 const current=(await tx.execute(sql`SELECT * FROM account_mfa WHERE user_id=${userId} FOR UPDATE`)).rows[0];
 if(current?.locked_until&&new Date(current.locked_until)>new Date())throw new WorkflowError(429,'Wait 15 minutes before retrying authenticator setup.');
 if(current?.enabled&&Number(current.version)!==replacementVersion)throw new WorkflowError(409,'Verify the current authenticator or a recovery code before replacing it.');
 await tx.execute(sql`INSERT INTO account_mfa(user_id,pending_ciphertext,pending_expires_at) VALUES(${userId},${ciphertext},now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET pending_ciphertext=excluded.pending_ciphertext,pending_expires_at=excluded.pending_expires_at`);
 const key=base32(secret);return {secret:key,uri:`otpauth://totp/${encodeURIComponent('E3 HR:'+username)}?secret=${key}&issuer=E3%20HR&algorithm=SHA1&digits=6&period=30`};
}
export async function finishMfa(tx:any,userId:number,code:string){
 const row=(await tx.execute(sql`SELECT * FROM account_mfa WHERE user_id=${userId} FOR UPDATE`)).rows[0];
 if(!row||!row.pending_ciphertext||new Date(row.pending_expires_at)<=new Date())throw new WorkflowError(409,'MFA setup expired or is already complete. Start again.');
 if(row.locked_until&&new Date(row.locked_until)>new Date())return {error:true as const};
 const secret=open(String(row.pending_ciphertext),userId),current=Math.floor(Date.now()/30000);
 const step=[current,current-1,current+1].find(n=>/^\d{6}$/.test(code)&&equal(totp(secret,n),code));
 if(step===undefined){await tx.execute(sql`UPDATE account_mfa SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts>=4 THEN now()+interval '15 minutes' ELSE NULL END WHERE user_id=${userId}`);return {error:true as const};}
 const recovery=Array.from({length:10},()=>randomBytes(12).toString('hex'));
 await tx.execute(sql`UPDATE account_mfa SET enabled=true,secret_ciphertext=pending_ciphertext,pending_ciphertext=NULL,pending_expires_at=NULL,version=version+1,last_step=${step},recovery_hashes=${JSON.stringify(recovery.map(digest))}::jsonb,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE user_id=${userId}`);
 return {codes:recovery};
}
