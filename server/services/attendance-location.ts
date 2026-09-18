import {and,eq,gt,lte,sql} from 'drizzle-orm';
import {attendanceGeofencePolicy as policyTable,attendanceGeofenceLocations as locations,employees,workforceMembers,workforceTeams,workforcePresence} from '@shared/schema';
import {defaultGeofencePolicy,distanceMeters,geofencePolicy,locationFix,type LocationFix,type LocationEvidence} from '@shared/attendance-location';
import {dayAt} from '@shared/hr-rules';
import {fail,type WorkforceTransaction} from './workforce';

export async function locationPolicy(tx:WorkforceTransaction){const [row]=await tx.select().from(policyTable).where(eq(policyTable.id,1));return {version:row?.version||0,config:geofencePolicy.parse(row?.config||defaultGeofencePolicy),enforcedFrom:row?.enforcedFrom||new Date()};}
export async function employeeLocations(tx:WorkforceTransaction,employeeId:number,siteId?:number,now=new Date()){
 const day=dayAt(now,process.env.APP_TIMEZONE||'Asia/Qatar');
 const rows=await tx.select().from(locations);
 return rows.filter(r=>r.config.enabled&&(!r.config.startsOn||r.config.startsOn<=day)&&(!r.config.endsOn||r.config.endsOn>=day)&&
  (siteId!==undefined?r.config.siteId===siteId:r.config.siteId===null)&&(!r.config.employeeIds.length||r.config.employeeIds.includes(employeeId)));
}
export async function verifyAttendanceLocation(tx:WorkforceTransaction,employeeId:number,fix:LocationFix|undefined,siteId?:number,now=new Date()):Promise<LocationEvidence>{
 const policy=await locationPolicy(tx),base={recordedAt:now.toISOString(),policyVersion:policy.version};
 if(!policy.config.required)return {...base,status:'disabled'};
 const fences=await employeeLocations(tx,employeeId,siteId,now);
 if(!fences.length)fail(409,'No active geofence is assigned to this workplace. Contact your administrator or request an attendance correction.');
 if(!fix)fail(400,'Allow location access and provide a fresh GPS reading to record attendance');
 const position=locationFix.parse(fix),age=+now-Date.parse(position.capturedAt);
 if(age>policy.config.maxAgeSeconds*1000||age< -10000)fail(400,'Location reading is stale or in the future. Refresh your location and try again.');
 if(position.accuracy>policy.config.maxAccuracyMeters)fail(400,`Location accuracy must be within ${policy.config.maxAccuracyMeters} metres. Move to a clear area and try again.`);
 const measured=fences.map(row=>({row,distance:distanceMeters(position,row.config)})).sort((a,b)=>a.distance-b.distance);
 const matched=measured.find(({row,distance})=>distance<=row.config.radiusMeters);
 if(!matched)fail(403,`You are outside your assigned workplace geofence. Nearest boundary is ${Math.ceil(measured[0].distance-measured[0].row.config.radiusMeters)} metres away. Ask your supervisor for a reviewed correction if needed.`);
 const {row,distance}=matched;return {...base,status:'verified',fix:position,distanceMeters:Math.round(distance),fence:{id:row.id,version:row.version,name:row.config.name,latitude:row.config.latitude,longitude:row.config.longitude,radiusMeters:row.config.radiusMeters}};
}
export async function needsAttendanceApproval(tx:WorkforceTransaction,employee:typeof employees.$inferSelect,at=new Date()){
 if(employee.type==='temporary'||employee.type==='contract'||(await locationPolicy(tx)).config.requirePermanentApproval)return true;
 const [member]=await tx.select({id:workforceMembers.id}).from(workforceMembers).innerJoin(workforceTeams,eq(workforceMembers.teamId,workforceTeams.id)).where(and(eq(workforceMembers.employeeId,employee.id),lte(workforceMembers.startAt,at),gt(workforceMembers.endAt,at))).limit(1);
 return !!member;
}
export async function requireApprovedPresence(tx:WorkforceTransaction,assignmentId:number,actualEndAt:Date){
 const policy=await locationPolicy(tx);
 // Historic, already completed work is preserved; the new control applies from installation onward.
 if(actualEndAt<policy.enforcedFrom)return;
 const [presence]=await tx.select().from(workforcePresence).where(eq(workforcePresence.assignmentId,assignmentId));
 if(!presence||!presence.departedAt||presence.approvalStatus!=='approved')fail(409,'A supervisor must approve attendance for this assignment before its worked time can be approved or included in payroll. Use a reviewed attendance exception for missing GPS records.');
}
