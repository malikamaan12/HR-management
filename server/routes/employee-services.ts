import {Router} from 'express';
import {z} from 'zod';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {db} from '../db';
import {employees,users,servicePolicies as policies,serviceRequests as requests} from '@shared/schema';
import {eligibilityRule,policyAdmin,policyInput,serviceDraft,serviceModule,versionInput,type ServiceKind} from '@shared/employee-services';
import {civilDate,positiveId,reason} from '@shared/hr-rules';
import {hasPermission} from '@shared/permissions';
import {moneyCents,moneyText} from '@shared/money';
import {authenticate} from '../middleware/auth';
import {employeeScope} from '../services/access';
import {audit,businessToday,scopedEmployee} from '../services/hr-rules';
import {approver,directory,effectivePolicy,eligible,employed,event,fileMetadata,normalizedAmount,requestRecord,requireWriter,reservedAmount,versionCheck} from '../services/employee-services';
import {privateStorageConfigured} from '../services/r2';
import {fail} from '../services/workforce';
import {handle} from './hr-rules';
import {serviceFileRoutes} from './service-files';
export default function employeeServiceRoutes(kind:ServiceKind){
  const router=Router(),module=serviceModule(kind);
  router.use(authenticate);router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!hasPermission(req.user!.role,module,'read'))return res.status(403).json({message:'Module access is required'});next();});
  router.get('/directory',handle(async(req,res)=>res.json(await db.transaction(async tx=>({employees:await directory(tx,req.user!,module,z.string().max(100).parse(req.query.q||'')),canConfigure:policyAdmin(req.user!.role),approvers:policyAdmin(req.user!.role)?(await tx.select({id:users.id,name:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,role:users.role}).from(users).where(and(eq(users.isActive,true),eq(users.approvalStatus,'approved')))).filter(u=>hasPermission(u.role,module,'approve')):[]})))));
  router.get('/policies',handle(async(req,res)=>{
    if(!policyAdmin(req.user!.role))fail(403,'Administrator access required');const page=z.coerce.number().int().min(1).default(1).parse(req.query.page);
    const items=await db.select({policy:policies,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`}).from(policies).leftJoin(employees,eq(policies.employeeId,employees.id)).where(eq(policies.kind,kind)).orderBy(desc(policies.id)).limit(25).offset((page-1)*25),[total]=await db.select({count:sql<number>`count(*)::int`}).from(policies).where(eq(policies.kind,kind));res.json({items,total:total.count});
  }));
  router.post('/policies',handle(async(req,res)=>{
    if(!policyAdmin(req.user!.role))fail(403,'Only administrators can configure rules');const input=policyInput.parse({...req.body,kind});
    res.status(201).json(await db.transaction(async tx=>{const e=input.employeeId?await scopedEmployee(tx,req.user!,input.employeeId,module):undefined;await approver(tx,input.config.approverId,module,e);const [row]=await tx.insert(policies).values({...input,createdBy:req.user!.userId}).returning();await audit(tx,req.user!,'service_policy',row.id,'Published effective '+kind+' rule');return row;}));
  }));
  router.get('/entitlements',handle(async(req,res)=>{
    const id=positiveId.parse(req.query.employeeId),date=civilDate.parse(req.query.date||businessToday());
    res.json(await db.transaction(async tx=>{
      const e=await scopedEmployee(tx,req.user!,id,module);const keys=await tx.selectDistinct({key:policies.key}).from(policies).where(eq(policies.kind,kind));const result=[];
      for(const {key} of keys){const p=await effectivePolicy(tx,kind,key,id,date);if(!p)continue;let available=true,message='';try{eligible(e,date,p.config);}catch(error){available=false;message=error instanceof Error?error.message:'Not eligible';}
        let used=0;try{used=await reservedAmount(tx,id,kind,key,date,p.config.unit);}catch(error){available=false;message=error instanceof Error?error.message:'Policy unit changed';}
        result.push({key,name:p.name,policyId:p.id,config:p.config,eligible:available,message,reserved:moneyText(used),remaining:moneyText(Math.max(0,moneyCents(p.config.annualLimit)-used)),year:Number(date.slice(0,4))});
      }return result;
    }));
  }));
  router.get('/requests',handle(async(req,res)=>{
    const page=z.coerce.number().int().min(1).default(1).parse(req.query.page),status=z.string().max(30).parse(req.query.status||'');
    const where=and(eq(requests.kind,kind),employeeScope(req.user!,module),status?eq(requests.status,status):undefined);
    const items=await db.select({id:requests.id,employeeName:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,title:requests.title,policyKey:requests.policyKey,requestDate:requests.requestDate,amount:requests.amount,unit:sql<string>`${requests.policySnapshot}->'config'->>'unit'`,status:requests.status}).from(requests).innerJoin(employees,eq(requests.employeeId,employees.id)).where(where).orderBy(desc(requests.id)).limit(25).offset((page-1)*25),[total]=await db.select({count:sql<number>`count(*)::int`}).from(requests).innerJoin(employees,eq(requests.employeeId,employees.id)).where(where);res.json({items,total:total.count});
  }));
  router.post('/requests',handle(async(req,res)=>{
    const input=serviceDraft.parse(req.body),amounts=normalizedAmount(kind,input);
    res.status(201).json(await db.transaction(async tx=>{const e=await scopedEmployee(tx,req.user!,input.employeeId,module,'read',true);requireWriter(req.user!,e,module);employed(e);if(input.requestDate>businessToday())fail(400,'Requests cannot be dated in the future');const p=await effectivePolicy(tx,kind,input.policyKey,e.id,input.requestDate);if(!p)fail(409,'Configure an effective policy first');eligible(e,input.requestDate,p.config);
      const {quantity,items,...fields}=input;const [row]=await tx.insert(requests).values({...fields,...amounts,kind,createdBy:req.user!.userId,policySnapshot:{id:p.id,name:p.name,config:p.config},history:event([],req.user!,'Draft created',input.details,1)}).returning();await audit(tx,req.user!,'service_request',row.id,'Created '+kind+' draft');return row;
    }));
  }));
  router.get('/requests/:id',handle(async(req,res)=>res.json(await db.transaction(async tx=>{
    const {row,employee}=await requestRecord(tx,req.user!,positiveId.parse(req.params.id),kind);const independent=employee.userId!==req.user!.userId&&row.createdBy!==req.user!.userId;
    return {row,employeeName:employee.firstName+' '+employee.lastName,files:await fileMetadata(tx,kind,row.id),canPrepare:employee.userId===req.user!.userId||row.createdBy===req.user!.userId&&hasPermission(req.user!.role,module,'create'),canReview:independent&&row.approverId===req.user!.userId&&hasPermission(req.user!.role,module,'approve'),canFulfill:independent&&hasPermission(req.user!.role,module,'approve')&&(kind==='benefit'?row.approverId===req.user!.userId:['super_admin','admin','finance','payroll_specialist'].includes(req.user!.role)),canReassign:policyAdmin(req.user!.role),storage:privateStorageConfigured()};
  }))));
  router.patch('/requests/:id',handle(async(req,res)=>{
    const input=serviceDraft.extend({version:versionInput}).strict().parse(req.body),amounts=normalizedAmount(kind,input);
    res.json(await db.transaction(async tx=>{const {row,employee}=await requestRecord(tx,req.user!,positiveId.parse(req.params.id),kind,true);versionCheck(row.version,input.version);requireWriter(req.user!,employee,module);if(employee.userId!==req.user!.userId&&row.createdBy!==req.user!.userId)fail(403,'Only the employee or original preparer can edit');if(!['draft','returned'].includes(row.status))fail(409,'Only drafts or returned requests can be edited');if(input.employeeId!==row.employeeId)fail(400,'A request cannot be transferred to another employee');if(input.requestDate>businessToday())fail(400,'Requests cannot be dated in the future');const p=await effectivePolicy(tx,kind,input.policyKey,row.employeeId,input.requestDate);if(!p)fail(409,'Configure an effective policy first');eligible(employee,input.requestDate,p.config);const {quantity,items,version,...fields}=input;const [saved]=await tx.update(requests).set({...fields,...amounts,policySnapshot:{id:p.id,name:p.name,config:p.config},approverId:null,status:'draft',version:row.version+1,updatedAt:new Date(),history:event(row.history,req.user!,'Draft edited',input.details,row.version+1,{...fields,...amounts})}).where(eq(requests.id,row.id)).returning();await audit(tx,req.user!,'service_request',row.id,'Edited '+kind+' draft');return saved;}));
  }));
  router.post('/requests/:id/actions',handle(async(req,res)=>{
    const input=z.object({version:versionInput,action:z.enum(['submit','approve','return','reject','cancel','fulfill','reassign']),reason,reference:z.string().trim().min(3).max(150).optional(),confirmed:z.boolean().optional(),approverId:positiveId.optional()}).strict().parse(req.body);
    res.json(await db.transaction(async tx=>{
      const {row,employee}=await requestRecord(tx,req.user!,positiveId.parse(req.params.id),kind,true);versionCheck(row.version,input.version);const prepare=employee.userId===req.user!.userId||row.createdBy===req.user!.userId&&hasPermission(req.user!.role,module,'create'),independent=employee.userId!==req.user!.userId&&row.createdBy!==req.user!.userId;
      const patch:Partial<typeof requests.$inferInsert>={};
      if(input.action==='reassign'){
        if(!policyAdmin(req.user!.role))fail(403,'Administrator access required');if(!['submitted','approved'].includes(row.status))fail(409,'Only submitted or approved requests can be reassigned');if(!input.approverId||input.approverId===row.createdBy)fail(400,'Select an independent approver');await approver(tx,input.approverId,module,employee);patch.approverId=input.approverId;
      }else if(input.action==='submit'){
        if(!prepare)fail(403,'Only the employee or original preparer can submit');if(!['draft','returned'].includes(row.status))fail(409,'This request is already submitted');employed(employee);
        const p=await effectivePolicy(tx,kind,row.policyKey,row.employeeId,row.requestDate);if(!p)fail(409,'Configure an effective policy first');const config=eligibilityRule.parse(p.config);eligible(employee,row.requestDate,config);
        if(row.requestDate>businessToday()||(Date.parse(businessToday())-Date.parse(row.requestDate))/86400000>config.submissionDays)fail(409,'This request falls outside the policy submission window');
        if(config.approverId===row.createdBy||config.approverId===req.user!.userId)fail(409,'The request needs an independent preparer and approver');await approver(tx,config.approverId,module,employee);
        if(config.receiptRequired&&!(await fileMetadata(tx,kind,row.id)).length)fail(409,'Attach the required evidence before submitting');
        const reserved=await reservedAmount(tx,row.employeeId,kind,row.policyKey,row.requestDate,config.unit,row.id);if(moneyCents(row.amount)>moneyCents(config.perRequestLimit)||reserved+moneyCents(row.amount)>moneyCents(config.annualLimit))fail(409,'This request exceeds the available policy entitlement');
        patch.status='submitted';patch.approverId=config.approverId;patch.policySnapshot={id:p.id,name:p.name,config};patch.approvedBy=null;
      }else if(input.action==='cancel'){
        if(!['draft','returned','submitted','approved'].includes(row.status))fail(409,'This request is closed');
        if(row.status==='approved'){if(!independent||row.approverId!==req.user!.userId)fail(403,'The independent approver must cancel an approved request');await approver(tx,req.user!.userId,module,employee);}else if(!prepare)fail(403,'Only the employee or original preparer can cancel');patch.status='cancelled';
      }else {
        if(!independent)fail(403,'An independent reviewer must decide this request');await approver(tx,req.user!.userId,module,employee);
        if(input.action==='fulfill'){
          if(row.status!=='approved')fail(409,'Only approved requests can be fulfilled');if(kind==='expense'?!['super_admin','admin','finance','payroll_specialist'].includes(req.user!.role):row.approverId!==req.user!.userId)fail(403,'The authorized fulfillment handler must record this action');
          if(!input.reference||input.confirmed!==true)fail(400,'Confirm the external transaction or benefit activation and enter its reference');patch.status='fulfilled';patch.fulfillmentReference=input.reference;patch.fulfilledBy=req.user!.userId;patch.fulfilledAt=new Date();
        }else {if(row.approverId!==req.user!.userId)fail(403,'The assigned reviewer must decide');if(row.status!=='submitted')fail(409,'Only submitted requests can be reviewed');if(input.action==='approve')employed(employee);patch.status=input.action==='approve'?'approved':input.action==='return'?'returned':'rejected';patch.approvedBy=input.action==='approve'?req.user!.userId:null;}
      }
      patch.version=row.version+1;patch.updatedAt=new Date();patch.history=event(row.history,req.user!,input.action,input.reason,patch.version,{...patch,history:undefined});const [saved]=await tx.update(requests).set(patch).where(eq(requests.id,row.id)).returning();await audit(tx,req.user!,'service_request',row.id,kind+': '+input.action);return saved;
    }));
  }));
  router.use('/requests',serviceFileRoutes(kind));return router;
}
