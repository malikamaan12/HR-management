import {Router,type Request,type Response} from 'express';
import {z} from 'zod';
import {and,desc,eq,ne,sql} from 'drizzle-orm';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {assignmentReviews as reviews,assignmentReviewHistory as history,workforceTeams as teams,workforceAssignments as assignments,workforceShifts as shifts,users} from '@shared/schema';
import {positiveId,workforceAdmin} from '@shared/workforce';
import {ratingInput,responseInput,resolutionInput,reviewRubric,reviewStatuses} from '@shared/assignmentReviews';
import {WorkforceError,fail} from '../services/workforce';
import {checkVersion} from '../services/timesheets';
import {candidateQuery,candidateScope,reviewCandidate,reviewQuery,reviewScope,ownReview,otherEmployee,permissionScope,readReview,reviewCapabilities,recordReviewHistory,changeReview,reviewWindow,withinWindow,hasReviewGrant} from '../services/assignmentReviews';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
export const reviewHandle=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{await fn(req,res);}catch(error){
  if(error instanceof WorkforceError)return res.status(error.status).json({message:error.message});
  if(error instanceof z.ZodError)return res.status(400).json({message:error.issues.map(i=>i.message).join('; ')});
  console.error('Assignment review request failed',error instanceof Error?error.name:'Unknown');return res.status(500).json({message:'Unable to complete review request'});
}};
router.get('/config',reviewHandle(async(req,res)=>res.json({canReview:await hasReviewGrant(req.user!,'review_performance'),canResolve:workforceAdmin(req.user!.role),rubric:reviewRubric})));
router.get('/assignments',reviewHandle(async(req,res)=>{
  const range=reviewWindow(req),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),teamId=req.query.teamId?positiveId.parse(req.query.teamId):undefined;
  const rows=await db.transaction(tx=>candidateQuery(tx).where(and(candidateScope(req.user!),withinWindow(range),teamId?eq(teams.id,teamId):undefined)).orderBy(desc(shifts.startAt),desc(assignments.id)).limit(25).offset((page-1)*25));
  res.json({items:rows,page,hasMore:rows.length===25});
}));
router.get('/assignments/:id',reviewHandle(async(req,res)=>res.json(await db.transaction(tx=>reviewCandidate(tx,req.user!,positiveId.parse(req.params.id))))));
router.get('/',reviewHandle(async(req,res)=>{
  const range=reviewWindow(req),view=z.enum(['mine','team','disputes']).default('mine').parse(req.query.view),page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),status=req.query.status?z.enum(reviewStatuses).parse(req.query.status):undefined,teamId=req.query.teamId?positiveId.parse(req.query.teamId):undefined;
  if(view==='disputes'&&!workforceAdmin(req.user!.role))fail(403,'HR access is required for dispute triage');
  const condition=and(reviewScope(req.user!),withinWindow(range),teamId?eq(teams.id,teamId):undefined,status?eq(reviews.status,status):undefined,
    view==='mine'?ownReview(req.user!):and(otherEmployee(req.user!),permissionScope(req.user!,'review_performance')),view==='disputes'?and(eq(reviews.status,'disputed'),ne(reviews.authorId,req.user!.userId)):undefined);
  const result=await db.transaction(async tx=>{
    const items=await reviewQuery(tx).where(condition).orderBy(desc(reviews.updatedAt),desc(reviews.id)).limit(25).offset((page-1)*25);
    const query=reviewQuery(tx).where(condition).as('scoped_reviews');const [total]=await tx.select({count:sql<number>`count(*)::int`}).from(query);
    return {items:items.map(({ownerUserId,...row})=>row),total:total.count,page,limit:25};
  });res.json(result);
}));
router.post('/',reviewHandle(async(req,res)=>{
  const input=z.object({assignmentId:positiveId,confirmed:z.literal(true),ratings:ratingInput}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{await reviewCandidate(tx,req.user!,input.assignmentId,true);
    const [row]=await tx.insert(reviews).values({...input.ratings,assignmentId:input.assignmentId,authorId:req.user!.userId,rubricVersion:reviewRubric.version,rubric:reviewRubric}).returning();
    await recordReviewHistory(tx,req.user!,row,'Published','Reviewer confirmed observed work and supporting examples');return {id:row.id,version:row.version};
  });res.status(201).json(result);
}));
router.get('/:id',reviewHandle(async(req,res)=>{
  const result=await db.transaction(async tx=>{const row=await readReview(tx,req.user!,positiveId.parse(req.params.id));
    const revisions=await tx.select({id:history.id,version:history.version,actorName:sql<string>`${users.firstName} || ' ' || ${users.lastName}`,action:history.action,reason:history.reason,snapshot:history.snapshot,createdAt:history.createdAt}).from(history).innerJoin(users,eq(history.actorId,users.id)).where(eq(history.reviewId,row.id)).orderBy(history.version);
    const {ownerUserId,...review}=row;return {review,capabilities:reviewCapabilities(req.user!,row),history:revisions};
  });res.json(result);
}));
router.post('/:id/respond',reviewHandle(async(req,res)=>{
  const input=responseInput.parse(req.body);res.json(await db.transaction(async tx=>{const row=await readReview(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    const access=reviewCapabilities(req.user!,row);if(input.kind==='dispute'?!access.dispute:!access.respond)fail(403,'Only the employee may respond once to the current review or raise a dispute');
    return changeReview(tx,req.user!,row,{responseKind:input.kind,employeeResponse:input.message,respondedAt:new Date(),...(input.kind==='dispute'?{status:'disputed' as const,resolution:null,resolutionReason:null,resolvedBy:null,resolvedAt:null}:{})},input.kind==='dispute'?'Disputed':input.kind==='comment'?'Employee commented':'Acknowledged',input.message||'Employee acknowledged receipt; acknowledgement does not imply agreement');
  }));
}));
router.post('/:id/resolve',reviewHandle(async(req,res)=>{
  const input=resolutionInput.parse(req.body);res.json(await db.transaction(async tx=>{const row=await readReview(tx,req.user!,positiveId.parse(req.params.id),true);checkVersion(row,input.version);
    if(!reviewCapabilities(req.user!,row).resolve)fail(403,'A different HR administrator must decide this review');
    if(input.outcome==='uphold'&&row.status!=='disputed')fail(409,'Only a disputed review can be upheld');
    // A new decision can be acknowledged or disputed again. Earlier responses and scores remain in history.
    return changeReview(tx,req.user!,row,{...(input.outcome==='amend'?input.ratings:{}),status:input.outcome==='withdraw'?'withdrawn':'resolved',resolution:input.outcome,resolutionReason:input.reason,resolvedBy:req.user!.userId,resolvedAt:new Date(),responseKind:null,employeeResponse:null,respondedAt:null},input.outcome==='amend'?'HR amended':input.outcome==='withdraw'?'HR withdrew':'HR upheld',input.reason);
  }));
}));
export default router;
