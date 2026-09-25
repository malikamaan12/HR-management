import {Router} from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {users,activityLogs} from '@shared/schema';
import {authenticate} from '../middleware/auth';
import {sameOriginWrites} from '../middleware/security';
import {validateBrandingPng} from '../services/branding';
import {scanUpload} from '../services/file-scan';
import {accountAvatar,avatarPrefix,avatarVersion} from '../services/account-avatar';
import {handle} from './hr-rules';
import {fail} from '../services/workforce';
const router=Router();
router.use(authenticate,sameOriginWrites,(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
const input=z.object({version:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:384*1024,files:1,fields:1,fieldSize:100}}).single('photo');
router.get('/',handle(async(req,res)=>{const [row]=await db.select({avatar:users.avatar}).from(users).where(eq(users.id,req.user!.userId));res.json(accountAvatar(row.avatar));}));
router.get('/image',handle(async(req,res)=>{
 const [row]=await db.select({avatar:users.avatar}).from(users).where(eq(users.id,req.user!.userId));
 if(!row.avatar?.startsWith(avatarPrefix))fail(404,'Profile photo not found');
 res.set('X-Content-Type-Options','nosniff').set('Cross-Origin-Resource-Policy','same-origin').type('image/png').send(Buffer.from(row.avatar!.slice(avatarPrefix.length),'base64'));
}));
router.use(rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false}));
router.put('/',(req,res,next)=>upload(req,res,error=>error?res.status(400).json({message:'Choose a PNG photo under 384 KB using the photo picker.'}):next()),handle(async(req,res)=>{
 const {version}=input.parse(req.body);
 if(!req.file)fail(400,'Choose a photo first.');
 let png:Buffer;
 try{png=validateBrandingPng(req.file!.buffer,'lightLogo');if(png.readUInt32BE(16)>512||png.readUInt32BE(20)>512)throw new Error('dimensions');}catch{fail(400,'Choose a valid image up to 512 × 512 pixels.');}
 try{await scanUpload(png!);}catch{fail(503,'The photo could not be cleared by malware scanning. Try again later.');}
 res.json(await change(req.user!.userId,version,avatarPrefix+png!.toString('base64')));
}));
router.delete('/',handle(async(req,res)=>{const {version}=input.parse(req.body);res.json(await change(req.user!.userId,version,null));}));
async function change(id:number,version:string,avatar:string|null){return db.transaction(async tx=>{
 const [row]=await tx.select({avatar:users.avatar}).from(users).where(eq(users.id,id)).for('update');
 if(avatarVersion(row.avatar)!==version)fail(409,'Your photo changed. Reload before saving again.');
 await tx.update(users).set({avatar,updatedAt:new Date()}).where(eq(users.id,id));
 await tx.insert(activityLogs).values({userId:id,action:'update',entityType:'user',entityId:id,details:avatar?'Personal profile photo updated':'Personal profile photo removed'});
 return accountAvatar(avatar);
});}
export default router;
