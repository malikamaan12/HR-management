import {getAccessScope,hasPermission,type HRModule} from './permissions';
import type {UserRole} from './schema';

const modules:Record<string,HRModule>={
 '/employees':'employee_database','/contracts':'employee_database','/probation':'employee_database','/transfers':'employee_database',
 '/incidents':'employee_database','/equipment':'employee_database','/handbook':'employee_database','/expenses':'employee_database','/service-operations':'employee_database',
 '/payroll':'payroll_management','/attendance':'attendance_time_tracking','/leave':'leave_absence_management','/documents':'compliance_documents',
 '/benefits':'benefits_perks','/performance':'performance_management','/learning':'training_development','/communications':'communication_hub',
 '/recruitment':'recruitment_onboarding','/onboarding':'recruitment_onboarding','/reports':'reports_analytics','/event-staff':'event_staff_management',
};

// Navigation and direct page access share the same affordance. API handlers
// remain authoritative and apply their own employee/assignment scopes.
export function canOpenPage(role:UserRole|undefined,path:string):boolean{
 if(!role)return false;
 const page='/'+(path.split('?')[0].split('/').filter(Boolean)[0]||'');
 if(['/settings','/user-management','/bulk-import'].includes(page))return role==='admin'||role==='super_admin';
 if(['/return-to-work','/exit-templates'].includes(page))return hasPermission(role,'employee_database','update')&&getAccessScope(role,'employee_database')==='all';
 const module=modules[page];if(!module)return true;
 if(!hasPermission(role,module,'read'))return false;
 const scope=getAccessScope(role,module);
 if(['/recruitment','/onboarding','/reports'].includes(page))return scope==='all';
 if(page==='/event-staff')return scope==='all'||scope==='event_staff';
 return scope!=='none';
}
