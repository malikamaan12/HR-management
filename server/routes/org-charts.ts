import {Router} from 'express';
import {and,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {authenticate} from '../middleware/auth';
import {employees,workforceTeams,workforceSites,workforceGrants} from '@shared/schema';
import {civilDate,positiveId} from '@shared/hr-rules';
import {orgChartInput,type OrgNode} from '@shared/org-chart';
import {workforceAdmin,teamInput} from '@shared/workforce';
import {audit,currentGrants,fail,requireWorkforceAdmin,teamAccess} from '../services/workforce';
import {businessToday} from '../services/hr-rules';
import {reviewHandle} from './assignmentReviews';
const router=Router();router.use(authenticate);router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const fields={id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,position:employees.position,department:employees.department,reportingManagerId:employees.reportingManagerId};
router.post('/teams/:id/details',reviewHandle(async(req,res)=>{
 requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),input=z.object({previous:teamInput,updated:teamInput}).strict().parse(req.body);
 const result=await db.transaction(async tx=>{
  const [team]=await tx.select().from(workforceTeams).where(eq(workforceTeams.id,id)).for('update');if(!team)fail(404,'Team not found');
  if(team.name!==input.previous.name||team.kind!==input.previous.kind||team.siteId!==input.previous.siteId)fail(409,'Team details changed. Refresh before saving');
  const [site]=await tx.select({id:workforceSites.id}).from(workforceSites).where(eq(workforceSites.id,input.updated.siteId));if(!site)fail(400,'Choose an existing work site');
  if(team.siteId!==input.updated.siteId){const [used]=(await tx.execute(sql`SELECT id FROM workforce_shifts WHERE team_id=${id} LIMIT 1`)).rows;if(used)fail(409,'This team has scheduled history. Create a new team for a different site to preserve its time zone and attendance records');}
  const [saved]=await tx.update(workforceTeams).set(input.updated).where(eq(workforceTeams.id,id)).returning();
  await audit(tx,req.user!,'team',id,`Team details updated: ${JSON.stringify({before:input.previous,after:input.updated})}`);return saved;
 });res.json(result);
}));
router.get('/company',reviewHandle(async(req,res)=>{
 requireWorkforceAdmin(req.user!);
 const people=await db.select(fields).from(employees).where(eq(employees.status,'active')).orderBy(employees.firstName,employees.id);
 res.json({people});
}));
router.get('/teams/:id',reviewHandle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),day=civilDate.parse(req.query.date||businessToday());
 const result=await db.transaction(async tx=>{
  const team=await teamAccess(tx,req.user!,id,'view'),admin=workforceAdmin(req.user!.role);
  // A current grant must also cover the requested chart date in the team's timezone.
  if(!admin){const [grant]=await tx.select({id:workforceGrants.id}).from(workforceGrants).where(and(eq(workforceGrants.teamId,id),currentGrants(req.user!),sql`(${workforceGrants.startAt} AT TIME ZONE ${team.timezone})::date <= ${day}::date`,sql`((${workforceGrants.endAt}-interval '1 millisecond') AT TIME ZONE ${team.timezone})::date >= ${day}::date`));if(!grant)fail(404,'Chart date is outside your team access');}
  const history=(await tx.execute(sql`SELECT version,effective_from::text AS "effectiveFrom",effective_to::text AS "effectiveTo",reason FROM workforce_org_chart_revisions WHERE team_id=${id} ORDER BY version DESC LIMIT 50`)).rows as any[];
  const revision=(await tx.execute(sql`SELECT version,nodes,effective_from::text AS "effectiveFrom",effective_to::text AS "effectiveTo" FROM workforce_org_chart_revisions WHERE team_id=${id} AND effective_from<=${day}::date AND (effective_to IS NULL OR effective_to>=${day}::date) ORDER BY version DESC LIMIT 1`)).rows[0] as any;
  const people=await tx.select(fields).from(employees).where(admin?undefined:sql`EXISTS (SELECT 1 FROM workforce_members m WHERE m.team_id=${id} AND m.employee_id=${employees.id} AND (m.start_at AT TIME ZONE ${team.timezone})::date<=${day}::date AND ((m.end_at-interval '1 millisecond') AT TIME ZONE ${team.timezone})::date>=${day}::date)`);
  const directory=new Map(people.map(p=>[p.id,p]));
  const nodes=(revision?.nodes||[] as OrgNode[]).filter((n:OrgNode)=>directory.has(n.employeeId)).map((n:OrgNode)=>({...n,...directory.get(n.employeeId),parentEmployeeId:n.parentEmployeeId&&directory.has(n.parentEmployeeId)?n.parentEmployeeId:null}));
  return {name:team.name,version:history[0]?.version||0,revision:revision?.version??null,effectiveFrom:revision?.effectiveFrom??null,effectiveTo:revision?.effectiveTo??null,nodes,canEdit:admin,history:admin?history:[]};
 });res.json(result);
}));
router.post('/teams/:id',reviewHandle(async(req,res)=>{
 requireWorkforceAdmin(req.user!);const id=positiveId.parse(req.params.id),input=orgChartInput.parse(req.body);
 const result=await db.transaction(async tx=>{
  const [team]=await tx.select().from(workforceTeams).where(eq(workforceTeams.id,id)).for('update');if(!team)fail(404,'Team not found');
  const previous=(await tx.execute(sql`SELECT version FROM workforce_org_chart_revisions WHERE team_id=${id} ORDER BY version DESC LIMIT 1`)).rows[0];
  if(Number(previous?.version||0)!==input.version)fail(409,'The chart changed. Refresh before saving');
  const people=await tx.select({id:employees.id,status:employees.status}).from(employees);const available=new Set(people.filter(p=>p.status==='active').map(p=>p.id));
  if(input.nodes.some(n=>!available.has(n.employeeId)))fail(400,'Choose active employee records for every chart position');
  const [saved]=(await tx.execute(sql`INSERT INTO workforce_org_chart_revisions(team_id,version,effective_from,effective_to,nodes,reason,created_by) VALUES (${id},${input.version+1},${input.effectiveFrom},${input.effectiveTo},${JSON.stringify(input.nodes)}::jsonb,${input.reason},${req.user!.userId}) RETURNING id,version`)).rows;
  await audit(tx,req.user!,'org_chart',Number(saved.id),`Team ${id} hierarchy revision ${saved.version}: ${input.reason}`);
  return saved;
 });res.status(201).json(result);
}));
export default router;
