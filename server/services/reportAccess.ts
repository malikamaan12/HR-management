import {sql,type SQL} from 'drizzle-orm';
import {hasPermission,getAccessScope,type HRModule} from '@shared/permissions';
import type {ReportKind} from '@shared/reporting';
import type {TokenPayload} from './auth';
import {workforceAdmin} from '@shared/workforce';
import {helpdeskResponder,helpdeskTriage} from '@shared/helpdesk';
import {commManager} from '@shared/communications';
import {channelScope,channelManage} from './communications';

import {reportSources,reportAllowed} from '@shared/report-access';
export {reportSources,reportAllowed};
export function reportTeamScope(user:TokenPayload,alias='t'):SQL{
 const t=sql.raw(alias);
 return workforceAdmin(user.role)?sql`true`:sql`EXISTS(SELECT 1 FROM workforce_grants rg WHERE rg.team_id=${t}.id AND rg.user_id=${user.userId} AND rg.revoked_at IS NULL AND rg.start_at<=now() AND rg.end_at>now())`;
}
function scopedEmployee(user:TokenPayload,module:HRModule,alias:string):SQL{
 const e=sql.raw(alias),scope=getAccessScope(user.role,module);
 if(scope==='all')return sql`true`;
 if(scope==='department')return user.department?sql`${e}.department=${user.department}`:sql`false`;
 if(scope==='team')return sql`${e}.reporting_manager_id=(SELECT id FROM employees WHERE user_id=${user.userId})`;
 if(scope==='event_staff')return sql`EXISTS(SELECT 1 FROM workforce_members rm JOIN workforce_teams t ON t.id=rm.team_id WHERE rm.employee_id=${e}.id AND rm.start_at<=now() AND rm.end_at>now() AND ${reportTeamScope(user)}) OR EXISTS(SELECT 1 FROM workforce_assignments ra JOIN workforce_shifts rs ON rs.id=ra.shift_id JOIN workforce_teams t ON t.id=rs.team_id WHERE ra.employee_id=${e}.id AND ra.status='accepted' AND rs.status='scheduled' AND rs.end_at>now() AND rs.start_at<=now()+interval '24 hours' AND ${reportTeamScope(user)})`;
 return sql`false`;
}
export function reportEmployeeScope(user:TokenPayload,kind:ReportKind,alias='e'){
 return sql`(${scopedEmployee(user,'reports_analytics',alias)}) AND (${scopedEmployee(user,reportSources[kind],alias)})`;
}
export function reportDepartmentScope(user:TokenPayload,kind:ReportKind,department:SQL){
 return sql`(${getAccessScope(user.role,'reports_analytics')==='all'} OR ${department}=${user.department||''}) AND (${getAccessScope(user.role,reportSources[kind])==='all'} OR ${department}=${user.department||''})`;
}
export function reportHelpdeskScope(user:TokenPayload){
 return sql`(h.requester_id=${user.userId} OR h.assignee_id=${user.userId} OR ${helpdeskTriage(user.role,true)} OR (${helpdeskTriage(user.role,false)} AND NOT h.confidential)) AND (${reportDepartmentScope(user,'helpdesk',sql`u.department`)})`;
}
// Save only scope evidence, never source contents. Access expansion may retain
// earlier runs; losing access to any contributing population closes the run.
export async function reportScopeStamp(tx:any,user:TokenPayload,kind:ReportKind){
 const scoped=getAccessScope(user.role,'reports_analytics')!=='all'||getAccessScope(user.role,reportSources[kind])!=='all';
 const people=scoped?(await tx.execute(sql`SELECT e.id FROM employees e WHERE ${reportEmployeeScope(user,kind)} ORDER BY e.id`)).rows:[];
 const teams=kind==='workforce'&&!workforceAdmin(user.role)?(await tx.execute(sql`SELECT t.id FROM workforce_teams t WHERE ${reportTeamScope(user)} ORDER BY t.id`)).rows:[];
 const restricted=kind==='helpdesk'?(await tx.execute(sql`SELECT h.id FROM helpdesk_cases h LEFT JOIN users u ON u.id=h.requester_id WHERE ${reportHelpdeskScope(user)} ORDER BY h.id`)).rows:kind==='communications'?(await tx.execute(sql`SELECT c.id FROM comm_channels c WHERE c.archived_at IS NULL AND ${channelScope(sql`${user.userId}`,user.role)} AND (${channelManage(user.userId,user.role)}) ORDER BY c.id`)).rows:[];
 return JSON.stringify({version:1,role:user.role,department:user.department||'',people:people.map((r:any)=>Number(r.id)),teams:teams.map((r:any)=>Number(r.id)),restricted:restricted.map((r:any)=>Number(r.id))});
}
export function reportScopeCovered(saved:string,current:string){
 try{const old=JSON.parse(saved),now=JSON.parse(current);if(old.version!==1||now.version!==1||old.role!==now.role||old.department!==now.department)return false;
  return ['people','teams','restricted'].every(key=>{const accessible=new Set(now[key]);return Array.isArray(old[key])&&old[key].every((id:number)=>accessible.has(id));});
 }catch{return false;}
}
