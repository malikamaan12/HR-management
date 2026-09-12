import { Router } from 'express';
import { db } from '../db';
import { appSettings } from '@shared/schema';
import { companySettingsSchema } from '@shared/settings';
import { getCompanySettings } from '../services/settings';
import { authenticate, authorize } from '../middleware/auth';
const router=Router();router.use(authenticate);
router.get('/company',async(_req,res)=>{try{return res.json(await getCompanySettings());}catch{return res.status(500).json({message:'Unable to load company settings'});}});
router.get('/integrations',authorize(['admin','super_admin']),(_req,res)=>res.json({email:!!(process.env.RESEND_API_KEY&&process.env.EMAIL_FROM&&process.env.APP_URL),
  documents:!!(process.env.R2_ACCOUNT_ID&&process.env.R2_ACCESS_KEY_ID&&process.env.R2_SECRET_ACCESS_KEY&&process.env.R2_BUCKET_NAME),timezone:process.env.APP_TIMEZONE || 'UTC'}));
router.put('/company',authorize(['admin','super_admin']),async(req,res)=>{
 const input=companySettingsSchema.safeParse(req.body);if(!input.success)return res.status(400).json({message:'Check the company settings',errors:input.error.flatten()});
 try{await db.insert(appSettings).values({key:'company',value:input.data}).onConflictDoUpdate({target:appSettings.key,set:{value:input.data,updatedAt:new Date()}});return res.json(input.data);}
 catch{return res.status(500).json({message:'Unable to save settings'});}
});
export default router;
