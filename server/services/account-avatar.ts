import {createHash} from 'node:crypto';
export const avatarPrefix='data:image/png;base64,';
export const avatarVersion=(avatar:string|null)=>createHash('sha256').update(avatar||'').digest('hex');
export const accountAvatar=(avatar:string|null)=>({version:avatarVersion(avatar),url:avatar?.startsWith(avatarPrefix)?`/api/auth/avatar/image?v=${avatarVersion(avatar)}`:null});
