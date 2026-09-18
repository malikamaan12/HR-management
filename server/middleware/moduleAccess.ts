import type { Request,Response,NextFunction } from 'express';
import { getAccessScope,hasPermission,type HRModule } from '@shared/permissions';
import { employeeScope } from '../services/access';
import { db } from '../db';
import { employees,leaves,leaveBalances } from '@shared/schema';
import { eq,and } from 'drizzle-orm';

export async function moduleAccess(req:Request,res:Response,next:NextFunction){
  if(!req.user)return res.status(401).json({message:'Authentication required'});
  // Match Express's case-insensitive routes and decoded parameters. Invalid or
  // non-integer identifiers must not fall through to legacy parseInt handlers.
  let path:string;
  try {
    const segments=req.path.split('/').map(segment=>decodeURIComponent(segment));
    if(segments.some(segment=>segment.includes('/')||segment.includes('\\')))
      return res.status(400).json({message:'Invalid request path'});
    path=segments.join('/').toLowerCase();
  }
  catch { return res.status(400).json({message:'Invalid request path'}); }
  const read=req.method==='GET'||req.method==='HEAD';
  // These legacy management endpoints return organization-wide records.
  let module:HRModule|undefined;
  if(/^\/(job-|candidates|interviews|onboarding-|employee-onboarding|checklist-tasks|dashboard-stats)/.test(path))module='recruitment_onboarding';
  else if(/^\/(reporting|analytics)/.test(path))module='reports_analytics';
  else if(/^\/performance/.test(path))module='performance_management';
  else if(/^\/training/.test(path))module='training_development';
  else if(/^\/(events|event-)/.test(path))module='event_staff_management';
  else if(/^\/(shift-schedules|geofences)/.test(path))module='attendance_time_tracking';
  else if(/^\/(role-management|activity-logs)/.test(path))module='system_configuration';
  else if(/^\/(leave-types|leave-balances|leave-approvals|leave-supporting-documents)/.test(path) && !read)module='leave_absence_management';
  if(module){
    const permission=(read||(req.method==='POST'&&/^\/reporting\/(runs|policy)\/?$/.test(path)))?'read':req.method==='DELETE'?'delete':req.method==='POST'?( /^\/candidates\/[1-9]\d*\/corrections\/?$/.test(path)?'update':'create'):'update';
    const scope=getAccessScope(req.user.role,module);
    // Performance and training handlers apply the employee row scope
    // themselves, so self/team/department users may reach them. Legacy
    // organization-wide endpoints remain fail-closed unless their scope is
    // all (or the event-staff scope explicitly supported by the route).
    const handlerScoped = module === 'performance_management' || module === 'training_development';
    if(!hasPermission(req.user.role,module,permission)||(!handlerScoped && !(scope==='all'||(module==='event_staff_management'&&scope==='event_staff'))))
      return res.status(403).json({message:'Organization-wide management access is required for this endpoint'});
  }
  try{
    const match=path.match(/^\/employees\/([^/]+)\/(documents|leaves|leave-balances|shift-schedules|event-staff-profile)(?:\/|$)/);
    if(match){if(!/^[1-9]\d*$/.test(match[1])||!Number.isSafeInteger(Number(match[1])))return res.status(400).json({message:'Invalid employee ID'});
      const module:HRModule=match[2]==='event-staff-profile'?'event_staff_management':match[2]==='documents'?'compliance_documents':match[2]==='shift-schedules'?'attendance_time_tracking':'leave_absence_management';
      const [employee]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,Number(match[1])),employeeScope(req.user,module)));
      if(!employee)return res.status(404).json({message:'Employee not found'});
    }
    const leave=path.match(/^\/leaves\/([^/]+)\/(supporting-documents|approvals)(?:\/|$)/);
    if(leave){if(!/^[1-9]\d*$/.test(leave[1])||!Number.isSafeInteger(Number(leave[1])))return res.status(400).json({message:'Invalid leave ID'});const [row]=await db.select({id:leaves.id}).from(leaves).innerJoin(employees,eq(leaves.employeeId,employees.id))
      .where(and(eq(leaves.id,Number(leave[1])),employeeScope(req.user,'leave_absence_management')));if(!row)return res.status(404).json({message:'Leave not found'});}
    const balance=path.match(/^\/leave-balances\/([^/]+)\/?$/);
    if(balance && read){if(!/^[1-9]\d*$/.test(balance[1])||!Number.isSafeInteger(Number(balance[1])))return res.status(400).json({message:'Invalid balance ID'});const [row]=await db.select({id:leaveBalances.id}).from(leaveBalances).innerJoin(employees,eq(leaveBalances.employeeId,employees.id))
      .where(and(eq(leaveBalances.id,Number(balance[1])),employeeScope(req.user,'leave_absence_management')));if(!row)return res.status(404).json({message:'Balance not found'});}
    return next();
  }catch{return res.status(500).json({message:'Unable to verify resource access'});}
}
