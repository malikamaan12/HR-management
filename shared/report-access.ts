import type {UserRole} from './schema';
import type {ReportKind} from './reporting';
import {hasPermission,getAccessScope,type HRModule} from './permissions';
import {helpdeskResponder} from './helpdesk';
import {commManager} from './communications';
export const reportSources:Record<ReportKind,HRModule>={headcount:'employee_database',turnover:'employee_database',leave:'leave_absence_management',compliance:'compliance_documents',workforce:'event_staff_management',attendance:'attendance_time_tracking',payroll:'payroll_management',recruitment:'recruitment_onboarding',lifecycle:'recruitment_onboarding',learning:'training_development',helpdesk:'employee_database',performance:'performance_management',expenses:'expense_management',benefits:'benefits_perks',equipment:'employee_database',handbook:'employee_database',communications:'communication_hub',qualifications:'training_development',employment:'employee_database',quality:'employee_database'};
export function reportAllowed(role:UserRole,kind:ReportKind){
 const source=reportSources[kind];
 if(!hasPermission(role,'reports_analytics','read')||['none','self'].includes(getAccessScope(role,'reports_analytics'))||!(kind==='communications'?commManager(role):hasPermission(role,source,'read'))||['none','self'].includes(getAccessScope(role,source)))return false;
 if(kind==='helpdesk')return helpdeskResponder(role);
 if(kind==='communications')return commManager(role);
 // Team compensation access does not grant detailed or aggregate salary amounts.
 if(['payroll','benefits','expenses'].includes(kind)&&['team','event_staff'].includes(getAccessScope(role,source)))return false;
 if(kind==='recruitment'&&getAccessScope(role,source)==='team')return false;
 return true;
}
