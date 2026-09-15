import {Router} from 'express';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {db} from '../db';
import {activityLogs,calculationRuleVersions} from '@shared/schema';
import {authorize} from '../middleware/auth';
import {calculationRulesSchema,ruleScopes,civilDate,ruleDate,calculateTime,calculateLeave,calculatePolicyPayroll} from '@shared/calculation-rules';
import {calculationSnapshot,ruleHistory} from '../services/calculation-rules';
import {WorkforceError} from '../services/workforce';

const router=Router();router.use(authorize(['admin','super_admin']));
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const scopeSchema=z.enum(ruleScopes);
const publishSchema=z.object({scope:scopeSchema,effectiveFrom:civilDate,expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(1000),rules:calculationRulesSchema}).strict();
router.get('/',async(req,res)=>{
 try{const scope=scopeSchema.parse(req.query.scope||'default'),today=ruleDate();
  const [active,history]=await Promise.all([calculationSnapshot({workSchedule:scope},today),ruleHistory(scope)]);
  return res.json({scope,today,active,history,latestVersion:history[0]?.id||0});
 }catch{return res.status(400).json({message:'Unable to load calculation rules'});}
});
router.post('/preview',async(req,res)=>{
 try{const input=z.object({scope:scopeSchema,rules:calculationRulesSchema,date:civilDate,elapsedMinutes:z.number().int().min(1).max(1440),breakMinutes:z.number().int().min(0).max(1440),leaveEnd:civilDate,
  basicSalary:z.string(),allowances:z.record(z.string()),deductions:z.record(z.string())}).strict().parse(req.body);
  const active=await calculationSnapshot({workSchedule:input.scope},input.date),draft={...active,rules:input.rules};
  const run=(snapshot:typeof active)=>({attendance:calculateTime(input.elapsedMinutes,input.breakMinutes,snapshot.rules.attendance),
   timesheets:calculateTime(input.elapsedMinutes,input.breakMinutes,snapshot.rules.timesheets),leave:calculateLeave(input.date,input.leaveEnd,snapshot),
   payroll:calculatePolicyPayroll(input.basicSalary,input.allowances,input.deductions,snapshot.rules.payroll)});
  return res.json({current:run(active),proposed:run(draft),currentVersion:active.version});
 }catch(error){return res.status(400).json({message:error instanceof z.ZodError?'Check the rule and sample fields':error instanceof Error?error.message:'Unable to preview'});}
});
router.post('/',async(req,res)=>{
 try{const input=publishSchema.parse(req.body);
  if(input.effectiveFrom<ruleDate())return res.status(400).json({message:'Use today or a future effective date. Existing records keep their original rules.'});
  const saved=await db.transaction(async tx=>{
   // Serialize publications, including the first version, before checking the editor's version.
   await tx.execute(sql`LOCK TABLE calculation_rule_versions IN EXCLUSIVE MODE`);
   const history=await ruleHistory(input.scope,tx);
   if((history[0]?.id||0)!==input.expectedVersion)throw new WorkforceError(409,'These rules changed. Reload and review the latest version before publishing.');
   const [row]=await tx.insert(calculationRuleVersions).values({scope:input.scope,effectiveFrom:input.effectiveFrom,rules:input.rules,reason:input.reason,createdBy:req.user!.userId}).returning();
   await tx.insert(activityLogs).values({userId:req.user!.userId,action:'create',entityType:'calculation_rules',entityId:row.id,details:`Published ${input.scope} calculation rules, effective ${input.effectiveFrom}`});
   return row;
  });return res.status(201).json(saved);
 }catch(error){return res.status(error instanceof WorkforceError?error.status:error instanceof z.ZodError?400:500).json({message:error instanceof WorkforceError?error.message:error instanceof z.ZodError?'Check the rule fields and change reason':'Unable to publish calculation rules'});}
});
export default router;
