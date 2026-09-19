import {Router} from 'express';
import multer from 'multer';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {db} from '../db';
import {appSettings,activityLogs} from '@shared/schema';
import {authenticate,authorize} from '../middleware/auth';
import {assetKeys,brandingSchema,maxBrandingBytes,type BrandingAsset} from '@shared/branding';
import {getBranding,publicBranding,validateBrandingPng} from '../services/branding';

const router=Router();
router.get('/',async(_req,res)=>{try{res.set('Cache-Control','no-store').json(publicBranding(await getBranding()));}catch{res.status(503).json({message:'Branding is temporarily unavailable'});}});
router.get('/default-icon.svg',(_req,res)=>res.type('image/svg+xml').set('Cache-Control','public, max-age=86400').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#174b49"/><path d="M16 17h32v7H24v7h20v7H24v9h24v7H16z" fill="white"/></svg>'));
router.get('/assets/:key',async(req,res)=>{
  if(!assetKeys.includes(req.params.key as BrandingAsset))return res.sendStatus(404);
  try{const asset=(await getBranding()).assets[req.params.key as BrandingAsset];if(!asset)return res.sendStatus(404);
    return res.type('image/png').set({'Cache-Control':'public, no-cache','X-Content-Type-Options':'nosniff'}).send(Buffer.from(asset,'base64'));
  }catch{return res.sendStatus(503);}
});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxBrandingBytes,files:3,fields:1,fieldSize:4096,parts:5}}).fields(assetKeys.map(name=>({name,maxCount:1})));
const submission=z.object({settings:brandingSchema,version:z.number().int().nonnegative(),remove:z.array(z.enum(assetKeys)).max(3)}).strict();
router.put('/',authenticate,authorize(['admin','super_admin']),(req,res,next)=>{
  const expected=process.env.APP_URL?new URL(process.env.APP_URL).origin:req.protocol+'://'+req.get('host');
  if(req.headers.origin&&req.headers.origin!==expected)return res.status(403).json({message:'Cross-origin request denied'});
  upload(req,res,error=>error?res.status(400).json({message:'Upload up to three PNG images, each no larger than 512 KB.'}):next());
},async(req,res)=>{
  let input:z.infer<typeof submission>,uploaded:Partial<Record<BrandingAsset,string>>={};
  try{input=submission.parse(JSON.parse(req.body.settings));const files=req.files as Record<string,Express.Multer.File[]>|undefined;
    for(const key of assetKeys){const file=files?.[key]?.[0];if(file){if(input.remove.includes(key))throw new Error('Choose either upload or remove for each image.');uploaded[key]=validateBrandingPng(file.buffer,key).toString('base64');}}
  }catch(error){return res.status(400).json({message:error instanceof z.ZodError?'Check the branding fields and try again.':error instanceof SyntaxError?'Invalid branding settings.':(error as Error).message});}
  try{
    const result=await db.transaction(async tx=>{
      // A single transaction lock also protects the first insert from concurrent administrators.
      await tx.execute(sql`select pg_advisory_xact_lock(19283017)`);
      const current=await getBranding(tx);if(current.version!==input.version)return null;
      const assets={...current.assets,...uploaded};for(const key of input.remove)delete assets[key];
      const value={settings:input.settings,assets,version:current.version+1};
      await tx.insert(appSettings).values({key:'branding',value}).onConflictDoUpdate({target:appSettings.key,set:{value,updatedAt:new Date()}});
      await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'application_branding',details:'Application branding and public assets updated'});
      return publicBranding(value);
    });
    return result?res.json(result):res.status(409).json({message:'Branding changed in another session. Reload the saved settings before editing again.'});
  }catch{return res.status(500).json({message:'Unable to save branding. No changes were applied.'});}
});
export default router;
