import { Router } from 'express';
import { db } from '../db';
import { appSettings, activityLogs } from '@shared/schema';
import { companySettingsSchema } from '@shared/settings';
import { getCompanySettings } from '../services/settings';
import { authenticate, authorize } from '../middleware/auth';
import { privateStorageConfigured } from '../services/r2';
import { emailConfigured } from '../services/email';
const router=Router();router.use(authenticate);
router.get('/company',async(_req,res)=>{try{return res.json(await getCompanySettings());}catch{return res.status(500).json({message:'Unable to load company settings'});}});
router.get('/integrations',authorize(['admin','super_admin']),(_req,res)=>res.json({email:emailConfigured(),
  documents:privateStorageConfigured(),timezone:process.env.APP_TIMEZONE || 'UTC'}));
router.put('/company',authorize(['admin','super_admin']),async(req,res)=>{
 try{
  const current=await getCompanySettings();
  const input=companySettingsSchema.safeParse({...req.body,managementOfficeSchedule:req.body.managementOfficeSchedule===undefined?current.managementOfficeSchedule:req.body.managementOfficeSchedule});
  if(!input.success)return res.status(400).json({message:'Check the company settings',errors:input.error.flatten()});
  await db.transaction(async tx=>{
   await tx.insert(appSettings).values({key:'company',value:input.data}).onConflictDoUpdate({target:appSettings.key,set:{value:input.data,updatedAt:new Date()}});
   await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'company_settings',details:'Company settings saved'});
  });return res.json(input.data);
 }
 catch{return res.status(500).json({message:'Unable to save settings'});}
});
export default router;
