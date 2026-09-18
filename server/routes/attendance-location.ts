import {Router} from 'express';
import {and,desc,eq,gt,lte,inArray,sql} from 'drizzle-orm';
import {z} from 'zod';
import {db} from '../db';
import {attendance,attendanceGeofencePolicy as policyTable,attendanceGeofenceLocations as locations,attendanceGeofenceHistory as history,employees,workforceSites as sites,workforceTeams as teams,workforceGrants as grants,workforceMembers as members} from '@shared/schema';
import {geofencePolicy,geofenceSave} from '@shared/attendance-location';
import {civilDate,positiveId,reason,dayAt} from '@shared/hr-rules';
import {workforceAdmin} from '@shared/workforce';
import {employeeScope} from '../services/access';
import {audit,isRuleAdmin,scopedEmployee} from '../services/hr-rules';
import {currentGrants,fail,teamAccess,type WorkforceTransaction} from '../services/workforce';
import {employeeLocations,locationPolicy} from '../services/attendance-location';
import type {TokenPayload} from '../services/auth';
import {handle} from './hr-rules';

const router=Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
async function availableSites(tx:WorkforceTransaction,user:TokenPayload){return tx.select().from(sites).where(workforceAdmin(user.role)?undefined:sql`exists(select 1 from ${teams} inner join ${grants} on ${grants.teamId}=${teams.id} where ${teams.siteId}=${sites.id} and ${grants.permission}='schedule' and ${currentGrants(user)})`).orderBy(sites.name);}
async function manageLocation(tx:WorkforceTransaction,user:TokenPayload,config:{siteId:number|null;employeeIds:number[]}){
 if(workforceAdmin(user.role))return;
 if(!config.siteId||config.employeeIds.length)fail(403,'Team leads can manage locations for their assigned sites; HR manages company and individual assignments');
 const siteRows=await availableSites(tx,user);if(!siteRows.some(s=>s.id===config.siteId))fail(404,'Location is outside your assigned sites');
 const allowed=await tx.select({id:teams.id}).from(teams).where(eq(teams.siteId,config.siteId));
 // A shared site boundary affects every team there: require scheduling authority over each team.
 for(const team of allowed)await teamAccess(tx,user,team.id,'schedule');
}
async function readiness(tx:WorkforceTransaction){
 const day=dayAt(new Date(),process.env.APP_TIMEZONE||'Asia/Qatar'),boundaries=(await tx.select().from(locations)).filter(r=>r.config.enabled&&(!r.config.startsOn||r.config.startsOn<=day)&&(!r.config.endsOn||r.config.endsOn>=day));
 const covered=(employeeId:number,siteId:number|null)=>boundaries.some(r=>r.config.siteId===siteId&&(!r.config.employeeIds.length||r.config.employeeIds.includes(employeeId)));
 const people=await tx.select({id:employees.id,firstName:employees.firstName,lastName:employees.lastName}).from(employees).where(eq(employees.status,'active'));
 const missingEmployees=[] as {id:number;name:string}[];
 for(const employee of people)if(!covered(employee.id,null))missingEmployees.push({id:employee.id,name:employee.firstName+' '+employee.lastName});
 const memberships=await tx.select({employeeId:members.employeeId,siteId:teams.siteId,siteName:sites.name}).from(members).innerJoin(teams,eq(members.teamId,teams.id)).innerJoin(sites,eq(teams.siteId,sites.id)).where(and(lte(members.startAt,new Date()),gt(members.endAt,new Date())));
 const missingSites=new Map<number,string>();for(const member of memberships)if(!covered(member.employeeId,member.siteId))missingSites.set(member.siteId,member.siteName);
 return {ready:!missingEmployees.length&&!missingSites.size,activeEmployees:people.length,missingEmployeeCount:missingEmployees.length,missingEmployees:missingEmployees.slice(0,50),missingSites:[...missingSites].map(([id,name])=>({id,name}))};
}
router.get('/context',handle(async(req,res)=>res.json(await db.transaction(async tx=>{
 const policy=await locationPolicy(tx),[employee]=await tx.select().from(employees).where(eq(employees.userId,req.user!.userId)),siteRows=await availableSites(tx,req.user!);
 const canManage=workforceAdmin(req.user!.role)||siteRows.length>0;
 return {policy,canConfigure:isRuleAdmin(req.user!),canManage,canManageCompany:workforceAdmin(req.user!.role),sites:canManage?siteRows:[],locations:employee?(await employeeLocations(tx,employee.id)).map(r=>({id:r.id,name:r.config.name,radiusMeters:r.config.radiusMeters})):[],readiness:isRuleAdmin(req.user!)?await readiness(tx):null};
}))));
router.get('/locations',handle(async(req,res)=>res.json(await db.transaction(async tx=>{
 const siteRows=await availableSites(tx,req.user!);if(!workforceAdmin(req.user!.role)&&!siteRows.length)fail(403,'HR or assigned site lead access is required');
 const allowed=new Set(siteRows.map(s=>s.id));const rows=await tx.select().from(locations).orderBy(desc(locations.id));
 return rows.filter(r=>workforceAdmin(req.user!.role)||(r.config.siteId!==null&&allowed.has(r.config.siteId)&&r.config.employeeIds.length===0));
}))));
router.get('/employees',handle(async(req,res)=>{if(!workforceAdmin(req.user!.role))fail(403,'HR access is required');res.json(await db.select({id:employees.id,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,type:employees.type}).from(employees).where(eq(employees.status,'active')).orderBy(employees.firstName).limit(5000));}));
router.post('/policy',handle(async(req,res)=>{
 if(!isRuleAdmin(req.user!))fail(403,'Only administrators can change attendance enforcement');
 const input=z.object({version:positiveId,config:geofencePolicy,reason}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{const [old]=await tx.select().from(policyTable).where(eq(policyTable.id,1)).for('update');if(old.version!==input.version)fail(409,'Location rules changed; reload before saving');
 if(input.config.required){const ready=await readiness(tx);if(!ready.ready)fail(409,`Assign locations before enabling enforcement: ${ready.missingEmployeeCount} employees and ${ready.missingSites.length} staffed sites need locations`);}
 const [saved]=await tx.update(policyTable).set({config:input.config,version:old.version+1,updatedBy:req.user!.userId,updatedAt:new Date()}).where(eq(policyTable.id,1)).returning();
 await tx.insert(history).values({kind:'policy',recordId:1,version:saved.version,snapshot:saved.config,reason:input.reason,actorId:req.user!.userId});await audit(tx,req.user!,'attendance_geofence_policy',1,input.reason);return saved;}));
}));
async function saveLocation(tx:WorkforceTransaction,user:TokenPayload,id:number|null,body:unknown){
 const input=geofenceSave.parse(body);await manageLocation(tx,user,input.config);
 // The policy lock serializes activation with boundary changes.
 await tx.select().from(policyTable).where(eq(policyTable.id,1)).for('update');
 if(input.config.siteId){const [site]=await tx.select().from(sites).where(eq(sites.id,input.config.siteId));if(!site)fail(400,'Choose an existing workforce site');}
 if(input.config.employeeIds.length){const [result]=await tx.select({count:sql<number>`count(*)::int`}).from(employees).where(inArray(employees.id,input.config.employeeIds));if(result.count!==input.config.employeeIds.length)fail(400,'One or more assigned employees no longer exist');}
 let saved;
 if(id){const [old]=await tx.select().from(locations).where(eq(locations.id,id)).for('update');if(!old)fail(404,'Location not found');await manageLocation(tx,user,old.config);if(old.version!==input.version)fail(409,'Location changed; reload before saving');[saved]=await tx.update(locations).set({config:input.config,version:old.version+1,updatedBy:user.userId,updatedAt:new Date()}).where(eq(locations.id,id)).returning();}
 else {if(input.version!==0)fail(400,'New locations must start at version zero');[saved]=await tx.insert(locations).values({config:input.config,createdBy:user.userId,updatedBy:user.userId}).returning();}
 await tx.insert(history).values({kind:'location',recordId:saved.id,version:saved.version,snapshot:saved.config,reason:input.reason,actorId:user.userId});await audit(tx,user,'attendance_geofence_location',saved.id,input.reason);return saved;
}
router.post('/locations',handle(async(req,res)=>res.status(201).json(await db.transaction(tx=>saveLocation(tx,req.user!,null,req.body)))));
router.put('/locations/:id',handle(async(req,res)=>res.json(await db.transaction(tx=>saveLocation(tx,req.user!,positiveId.parse(req.params.id),req.body)))));
router.get('/locations/:id/history',handle(async(req,res)=>{
 res.json(await db.transaction(async tx=>{const id=positiveId.parse(req.params.id),[row]=await tx.select().from(locations).where(eq(locations.id,id));if(!row)fail(404,'Location not found');await manageLocation(tx,req.user!,row.config);return tx.select().from(history).where(and(eq(history.kind,'location'),eq(history.recordId,id))).orderBy(desc(history.version)).limit(100);}));
}));
router.get('/approvals',handle(async(req,res)=>{
 const from=civilDate.parse(req.query.from),to=civilDate.parse(req.query.to);if(to<from||Date.parse(to)-Date.parse(from)>93*86400000)fail(400,'Choose an attendance window of at most 93 days');
 const rows=await db.select({record:attendance,name:sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,owner:employees.userId,canReview:sql<boolean>`${employeeScope(req.user!,'attendance_time_tracking','approve')}`}).from(attendance).innerJoin(employees,eq(attendance.employeeId,employees.id)).where(and(employeeScope(req.user!,'attendance_time_tracking'),sql`${attendance.date} between ${from} and ${to}`,sql`${attendance.approvalStatus}<>'not_required'`)).orderBy(desc(attendance.date),desc(attendance.id)).limit(500);
 res.json(rows.map(r=>({...r.record,name:r.name,canReview:r.canReview&&r.owner!==req.user!.userId&&r.record.approvalStatus==='pending'&&!!r.record.checkOut})));
}));
router.post('/approvals/:id/review',handle(async(req,res)=>{
 const id=positiveId.parse(req.params.id),input=z.object({version:positiveId,decision:z.enum(['approved','rejected']),reason}).strict().parse(req.body);
 res.json(await db.transaction(async tx=>{const [initial]=await tx.select().from(attendance).where(eq(attendance.id,id));if(!initial)fail(404,'Attendance not found');const employee=await scopedEmployee(tx,req.user!,initial.employeeId,'attendance_time_tracking','approve',true);if(employee.userId===req.user!.userId)fail(403,'Another supervisor must review your attendance');const [row]=await tx.select().from(attendance).where(eq(attendance.id,id)).for('update');if(row.version!==input.version||row.approvalStatus!=='pending')fail(409,'Attendance changed or has already been decided');if(!row.checkOut)fail(409,'Clock out before attendance review');const [saved]=await tx.update(attendance).set({approvalStatus:input.decision,supervisorUserId:req.user!.userId,supervisorNote:input.reason,supervisorReviewedAt:new Date(),updatedAt:new Date()}).where(eq(attendance.id,id)).returning();await audit(tx,req.user!,'attendance',id,`Supervisor ${input.decision}: ${input.reason}`);return saved;}));
}));
export default router;
