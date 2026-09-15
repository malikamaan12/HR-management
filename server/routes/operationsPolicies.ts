import {Router} from 'express';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {civilDate,ruleScopes} from '@shared/calculation-rules';
import {accrualPolicy,payPolicy} from '@shared/operations-policies';
import {fail,audit,WorkforceError} from '../services/workforce';
export const operationsHandle=(fn:(req:any,res:any)=>Promise<unknown>)=>async(req:any,res:any)=>{try{res.set('Cache-Control','no-store');await fn(req,res);}catch(e){res.status(e instanceof WorkforceError?e.status:e instanceof z.ZodError?400:500).json({message:e instanceof WorkforceError?e.message:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):'Unable to complete operation'});}};
export function admin(user:any){if(!['admin','super_admin'].includes(user.role))fail(403,'Admin or Super Admin access is required');}
const router=Router();router.use((req,res,next)=>{if(!['admin','super_admin'].includes(req.user!.role))return res.status(403).json({message:'Admin or Super Admin access is required'});next();});
router.get('/',operationsHandle(async(req,res)=>{const kind=z.enum(['leave','timepay']).parse(req.query.kind),scope=z.string().trim().min(1).max(100).parse(req.query.scope);res.json((await db.execute(sql`SELECT * FROM operations_policies WHERE kind=${kind} AND scope=${scope} ORDER BY id DESC LIMIT 100`)).rows);}));
router.post('/',operationsHandle(async(req,res)=>{
 const input=z.object({kind:z.enum(['leave','timepay']),scope:z.string().trim().min(1).max(100),effectiveFrom:civilDate,expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(500),rules:z.unknown()}).strict().parse(req.body);
 const rules=input.kind==='leave'?accrualPolicy.parse(input.rules):payPolicy.parse(input.rules);
 if(input.kind==='timepay')z.enum(ruleScopes).parse(input.scope);
 const saved=await db.transaction(async tx=>{await tx.execute(sql`LOCK TABLE operations_policies IN EXCLUSIVE MODE`);
  if(input.kind==='leave'&&!(await tx.execute(sql`SELECT id FROM leave_types WHERE name=${input.scope} AND active=true`)).rows.length)fail(400,'Choose an active leave type');
  const latest=await tx.execute(sql`SELECT id FROM operations_policies WHERE kind=${input.kind} AND scope=${input.scope} ORDER BY id DESC LIMIT 1`);if(Number(latest.rows[0]?.id||0)!==input.expectedVersion)fail(409,'Policy changed; reload before publishing');
  const row=(await tx.execute(sql`INSERT INTO operations_policies(kind,scope,effective_from,rules,reason,created_by) VALUES (${input.kind},${input.scope},${input.effectiveFrom},${JSON.stringify(rules)}::jsonb,${input.reason},${req.user.userId}) RETURNING *`)).rows[0];await audit(tx,req.user,'operations_policy',Number(row.id),'Published '+input.kind+' policy');return row;
 });res.status(201).json(saved);
}));
export default router;
