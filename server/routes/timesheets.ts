import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import {and,desc,eq,gt,gte,isNull,lt,lte,ne,sql} from 'drizzle-orm';
import {db} from '../db';
import {calculationSnapshot} from '../services/calculation-rules';
import {calculateTime,ruleDate} from '@shared/calculation-rules';
import {authenticate} from '../middleware/auth';
import {workforceTimesheets as sheets,timesheetRevisions as revisions,workforceAssignments as assignments,workforceShifts as shifts,workforceTeams as teams,workforceSites as sites,workforceGrants as grants,employees,users,payroll} from '@shared/schema';
import {positiveId,workforceAdmin} from '@shared/workforce';
import {actualFields,reviewInput,versionInput,payrollTimeAccess,timesheetStatuses} from '@shared/timesheets';
import {WorkforceError,currentGrants,fail,type WorkforceTransaction} from '../services/workforce';
import {assignmentFields,sheetQuery,ownScope,reviewScope,paidStatuses,readSheet,checkVersion,validateActuals,assertTimeOverlap,requireReviewer,recordRevision,changeSheet} from '../services/timesheets';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const handle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{await fn(req,res);}catch(error){
  if(error instanceof WorkforceError)return res.status(error.status).json({message:error.message});
  if(error instanceof z.ZodError)return res.status(400).json({message:error.issues.map(i=>i.message).join('; ')});
  console.error('Timesheet request failed',error instanceof Error?error.name:'Unknown');return res.status(500).json({message:'Unable to complete timesheet request'});
}};
function windowQuery(req:Request){const now=new Date();return z.object({from:z.coerce.date(),to:z.coerce.date()}).refine(v=>v.to>v.from&&+v.to-+v.from<=90*86400000,'Choose a window of up to 90 days').parse({from:req.query.from||new Date(+now-31*86400000),to:req.query.to||now});}
async function caps(tx:WorkforceTransaction,user:NonNullable<Request['user']>,row:Awaited<ReturnType<typeof readSheet>>){
  const own=row.ownerUserId===user.userId;
  const [review]=await sheetQuery(tx).where(and(eq(sheets.id,row.id),reviewScope(user)));
  return {edit:own&&['draft','returned'].includes(row.status),submit:own&&['draft','returned'].includes(row.status),review:!own&&!!review&&row.status==='submitted',reopen:!own&&workforceAdmin(user.role)&&row.status==='approved',payrollLock:!own&&payrollTimeAccess(user.role,'approve')&&row.status==='approved'};
}
router.get('/config',handle(async(req,res)=>{
  const [grant]=await db.select({id:grants.id}).from(grants).where(and(currentGrants(req.user!),eq(grants.permission,'review_time'))).limit(1);
  res.json({canReview:workforceAdmin(req.user!.role)||!!grant,canPayrollRead:payrollTimeAccess(req.user!.role,'read'),canPayrollLock:payrollTimeAccess(req.user!.role,'approve')});
}));
router.get('/assignments',handle(async(req,res)=>{
  const {from,to}=windowQuery(req),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const rows=await db.select(assignmentFields).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).leftJoin(sheets,eq(sheets.assignmentId,assignments.id))
    .where(and(ownScope(req.user!),eq(assignments.status,'accepted'),lte(shifts.endAt,new Date()),gte(shifts.startAt,from),lt(shifts.startAt,to),isNull(sheets.id))).orderBy(desc(shifts.startAt),desc(assignments.id)).limit(25).offset((page-1)*25);
  res.json({items:rows,page,hasMore:rows.length===25});
}));
router.get('/',handle(async(req,res)=>{
  const {from,to}=windowQuery(req),view=z.enum(['mine','review','payroll']).default('mine').parse(req.query.view),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
  const status=req.query.status?z.enum(timesheetStatuses).parse(req.query.status):undefined;
  if(view==='payroll'&&!payrollTimeAccess(req.user!.role,'read'))fail(403,'Payroll access is required');
  const condition=and(gte(shifts.startAt,from),lt(shifts.startAt,to),status?eq(sheets.status,status):undefined,view==='mine'?ownScope(req.user!):view==='review'?and(ne(sheets.status,'draft'),sql`${employees.userId} IS DISTINCT FROM ${req.user!.userId}`,reviewScope(req.user!)):paidStatuses());
  const result=await db.transaction(async tx=>{
    const rows=await sheetQuery(tx).where(condition).orderBy(desc(sheets.updatedAt),desc(sheets.id)).limit(25).offset((page-1)*25);
    const [total]=await tx.select({count:sql<number>`count(*)::int`}).from(sheets).innerJoin(assignments,eq(sheets.assignmentId,assignments.id)).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).where(condition);
    return {items:rows.map(({ownerUserId,...row})=>row),total:total.count,page,limit:25};
  });res.json(result);
}));
router.post('/',handle(async(req,res)=>{
  const input=z.object({assignmentId:positiveId,...actualFields}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    const [assignment]=await tx.select({...assignmentFields,status:assignments.status}).from(assignments).innerJoin(employees,eq(assignments.employeeId,employees.id)).innerJoin(shifts,eq(assignments.shiftId,shifts.id)).innerJoin(teams,eq(shifts.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).where(and(eq(assignments.id,input.assignmentId),ownScope(req.user!))).for('update',{of:assignments});
    if(!assignment)fail(404,'Assignment not found');if(assignment.status!=='accepted')fail(409,'Only accepted assignments can have a timesheet');
    const [existing]=await tx.select({id:sheets.id}).from(sheets).where(eq(sheets.assignmentId,input.assignmentId));if(existing)fail(409,'This assignment already has a timesheet');
    const [employee]=await tx.select({workSchedule:employees.workSchedule}).from(employees).where(eq(employees.id,assignment.employeeId));
    const snapshot=await calculationSnapshot(employee,ruleDate(assignment.startAt,assignment.timezone),tx);
    const workedMinutes=validateActuals(input,assignment),[row]=await tx.insert(sheets).values({...input,workedMinutes,calculationSnapshot:snapshot}).returning();
    await recordRevision(tx,req.user!,row,'Created','Employee reported actual time');return {id:row.id,version:row.version};
  });res.status(201).json(result);
}));
router.get('/:id',handle(async(req,res)=>{
  const result=await db.transaction(async tx=>{
    const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id)),access=await caps(tx,req.user!,row);
    const [review]=await sheetQuery(tx).where(and(eq(sheets.id,row.id),reviewScope(req.user!)));
    // Finance-only readers see the approved record, without earlier employee drafts.
    const history=row.ownerUserId===req.user!.userId||review?await tx.select({id:revisions.id,version:revisions.version,action:revisions.action,reason:revisions.reason,snapshot:revisions.snapshot,createdAt:revisions.createdAt,actorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`}).from(revisions).innerJoin(users,eq(revisions.actorId,users.id)).where(eq(revisions.timesheetId,row.id)).orderBy(revisions.version):[];
    const {ownerUserId,...sheet}=row;return {sheet,capabilities:access,history};
  });res.json(result);
}));
router.patch('/:id',handle(async(req,res)=>{
  const input=z.object({version:z.number().int().positive(),...actualFields}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    if(row.ownerUserId!==req.user!.userId)fail(403,'Only the employee can edit reported time');if(!['draft','returned'].includes(row.status))fail(409,'Only a draft or returned timesheet can be edited');
    const {version,...actuals}=input;return changeSheet(tx,req.user!,row,{...actuals,workedMinutes:validateActuals(input,row)},'Edited','Employee corrected reported time');
  });res.json(result);
}));
router.post('/:id/submit',handle(async(req,res)=>{
  const input=versionInput.parse(req.body);res.json(await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    if(row.ownerUserId!==req.user!.userId)fail(403,'Only the employee can submit reported time');if(!['draft','returned'].includes(row.status))fail(409,'This timesheet cannot be submitted');
    validateActuals(row,row);await assertTimeOverlap(tx,row);return changeSheet(tx,req.user!,row,{status:'submitted',submittedAt:new Date(),reviewNote:null,reviewerId:null,reviewedAt:null,payableMinutes:null,policyReference:null},'Submitted','Employee confirmed reported actual time');
  }));
}));
router.post('/:id/review',handle(async(req,res)=>{
  const input=reviewInput.parse(req.body);res.json(await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);await requireReviewer(tx,req.user!,row);
    if(row.status!=='submitted')fail(409,'Only submitted timesheets can be reviewed');
    const snapshot=row.calculationSnapshot||await calculationSnapshot({},ruleDate(row.startAt,row.timezone),tx,true);
    const calculated=snapshot.rules.timesheets.payableMethod==='calculated';
    const payable=input.decision==='approved'?(calculated?calculateTime(row.workedMinutes+row.breakMinutes,row.breakMinutes,snapshot.rules.timesheets).calculatedMinutes:input.payableMinutes):null;
    if(input.decision==='approved'){if(!calculated&&input.payableMinutes>row.workedMinutes+row.breakMinutes)fail(400,'Payable time cannot exceed the reported duration');await assertTimeOverlap(tx,row);}
    return changeSheet(tx,req.user!,row,{status:input.decision,calculationSnapshot:snapshot,reviewerId:req.user!.userId,reviewedAt:new Date(),reviewNote:input.reason,payableMinutes:payable,policyReference:input.decision==='approved'?(calculated?`Calculation rules v${snapshot.version}`:input.policyReference):null},input.decision==='approved'?'Approved':'Returned',input.reason);
  }));
}));
router.post('/:id/reopen',handle(async(req,res)=>{
  const input=z.object({version:z.number().int().positive(),reason:z.string().trim().min(5).max(2000)}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    if(!workforceAdmin(req.user!.role)||row.ownerUserId===req.user!.userId)fail(403,'Another HR administrator must return approved time for correction');if(row.status!=='approved')fail(409,'Only approved, unlocked timesheets can be returned for correction');
    return changeSheet(tx,req.user!,row,{status:'returned',payableMinutes:null,policyReference:null,reviewerId:req.user!.userId,reviewedAt:new Date(),reviewNote:input.reason},'Correction requested',input.reason);
  }));
}));
router.get('/:id/payroll-options',handle(async(req,res)=>{
  if(!payrollTimeAccess(req.user!.role,'approve'))fail(403,'Payroll approval access is required');
  const result=await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id));if(row.ownerUserId===req.user!.userId)fail(403,'Another payroll approver must link your time');
    return tx.select({id:payroll.id,month:payroll.month,year:payroll.year,reference:payroll.wpsReference}).from(payroll).where(and(eq(payroll.employeeId,row.employeeId),eq(payroll.status,'processed'))).orderBy(desc(payroll.year),desc(payroll.month)).limit(100);
  });res.json(result);
}));
router.post('/:id/payroll-lock',handle(async(req,res)=>{
  const input=z.object({version:z.number().int().positive(),payrollId:positiveId,confirmed:z.literal(true)}).strict().parse(req.body);
  if(!payrollTimeAccess(req.user!.role,'approve'))fail(403,'Payroll approval access is required');
  res.json(await db.transaction(async tx=>{const row=await readSheet(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    if(row.ownerUserId===req.user!.userId)fail(403,'Another payroll approver must link your time');if(row.status!=='approved')fail(409,'Only approved, unlocked timesheets can be linked');
    const [paid]=await tx.select().from(payroll).where(and(eq(payroll.id,input.payrollId),eq(payroll.employeeId,row.employeeId),eq(payroll.status,'processed'))).for('share');
    if(!paid)fail(400,'Select a processed payroll record for this employee');
    return changeSheet(tx,req.user!,row,{status:'payroll_locked',payrollId:paid.id,lockedBy:req.user!.userId,lockedAt:new Date()},'Payroll linked',`Payroll approver confirmed inclusion in payroll #${paid.id} (${paid.month}/${paid.year})`);
  }));
}));
export default router;
