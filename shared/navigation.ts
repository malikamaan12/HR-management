import {reportSources,reportAllowed} from './report-access';
import type {ReportKind} from './reporting';
import type {UserRole} from './schema';
import {ROLE_PERMISSIONS,canAccessModule,getAccessScope,hasPermission,type HRModule} from './permissions';
import {workforceAdmin} from './workforce';
export type PageAccess='signed_in'|'admin'|'retention'|'team'|'events'|'communication'|'module'|'reports'|'recruitment';
export type PageDefinition={href:string;label:string;icon:string;section:string;access:PageAccess;module?:HRModule};
export const pages:PageDefinition[]=[
 {href:'/',label:'Dashboard',icon:'gauge',section:'Workspace',access:'signed_in'},
 {href:'/account',label:'My account',icon:'user',section:'Workspace',access:'signed_in'},
 {href:'/communications',label:'Communication Hub',icon:'comments',section:'Workspace',access:'communication',module:'communication_hub'},
 {href:'/helpdesk',label:'HR Helpdesk',icon:'life-ring',section:'Workspace',access:'signed_in'},
 {href:'/employees',label:'Employee Database',icon:'users',section:'People',access:'module',module:'employee_database'},
 {href:'/org-charts',label:'Organization charts',icon:'sitemap',section:'People',access:'team'},
 {href:'/recruitment',label:'Recruitment',icon:'user-plus',section:'People',access:'recruitment',module:'recruitment_onboarding'},
 {href:'/onboarding',label:'Onboarding & offboarding',icon:'clipboard-list',section:'People',access:'signed_in'},
 {href:'/employment',label:'Employment history',icon:'briefcase',section:'People',access:'signed_in'},
 {href:'/team-overview',label:'Team overview',icon:'people-group',section:'Work & time',access:'team'},
 {href:'/workforce',label:'Workforce',icon:'people-carry',section:'Work & time',access:'signed_in'},
 {href:'/event-staff',label:'Event Staff',icon:'id-badge',section:'Work & time',access:'events',module:'event_staff_management'},
 {href:'/attendance',label:'Attendance',icon:'calendar-check',section:'Work & time',access:'module',module:'attendance_time_tracking'},
 {href:'/timesheets',label:'Timesheets',icon:'clock',section:'Work & time',access:'signed_in'},
 {href:'/leave',label:'Leave',icon:'umbrella-beach',section:'Work & time',access:'module',module:'leave_absence_management'},
 {href:'/payroll',label:'Payroll',icon:'money-check-alt',section:'Pay & benefits',access:'module',module:'payroll_management'},
 {href:'/benefits',label:'Benefits & entitlements',icon:'heart',section:'Pay & benefits',access:'module',module:'benefits_perks'},
 {href:'/expenses',label:'Expenses',icon:'receipt',section:'Pay & benefits',access:'module',module:'expense_management'},
 {href:'/documents',label:'Documents',icon:'file-alt',section:'HR services',access:'module',module:'compliance_documents'},
 {href:'/hr-letters',label:'HR Letter Centre',icon:'file-signature',section:'HR services',access:'signed_in'},
 {href:'/equipment',label:'Equipment & returns',icon:'laptop',section:'HR services',access:'signed_in'},
 {href:'/handbook',label:'Employee handbook',icon:'book',section:'HR services',access:'signed_in'},
 {href:'/learning',label:'Learning & training',icon:'graduation-cap',section:'Development',access:'module',module:'training_development'},
 {href:'/performance',label:'Performance',icon:'chart-line',section:'Development',access:'module',module:'performance_management'},
 {href:'/assignment-reviews',label:'Assignment reviews',icon:'star',section:'Development',access:'signed_in'},
 {href:'/reports',label:'Reports & analytics',icon:'chart-bar',section:'Insights',access:'reports',module:'reports_analytics'},
 {href:'/retention',label:'Record retention',icon:'archive',section:'Administration',access:'retention'},
 {href:'/bulk-import',label:'Bulk Import',icon:'upload',section:'Administration',access:'admin'},
 {href:'/user-management',label:'User Management',icon:'user-shield',section:'Administration',access:'admin'},
 {href:'/hr-rules',label:'HR Rules',icon:'sliders-h',section:'Administration',access:'admin'},
 {href:'/operations-setup',label:'Operational setup',icon:'list-check',section:'Administration',access:'admin'},
 {href:'/reminder-rules',label:'Reminder Rules',icon:'bell',section:'Administration',access:'admin'},
 {href:'/settings',label:'Settings',icon:'cog',section:'Administration',access:'admin'},
];
export function pageForPath(path:string){const clean=path.split(/[?#]/)[0];return pages.find(p=>p.href===clean||p.href!=='/'&&clean.startsWith(p.href+'/'));}
export function canOpenPage(role:UserRole|null|undefined,page:PageDefinition,hasTeamAccess=false){
 if(!role||!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS,role))return false;
 switch(page.access){
  case 'signed_in':return true;
  case 'admin':return ['admin','super_admin'].includes(role);
  case 'retention':return ['admin','super_admin','hr_director','hr','hr_manager'].includes(role);
  case 'team':return workforceAdmin(role)||hasTeamAccess;
  case 'communication':return canAccessModule(role,'communication_hub');
  case 'events':return hasPermission(role,'event_staff_management','read')&&['all','event_staff'].includes(getAccessScope(role,'event_staff_management'));
  case 'reports':return (Object.keys(reportSources) as ReportKind[]).some(kind=>reportAllowed(role,kind));
  case 'recruitment':return hasPermission(role,'recruitment_onboarding','read')&&['all','department'].includes(getAccessScope(role,'recruitment_onboarding'));
  case 'module':return !!page.module&&hasPermission(role,page.module,'read');
 }
}
export function pageLabel(page:PageDefinition,role:UserRole){
 if(page.href==='/onboarding'&&['none','self'].includes(getAccessScope(role,'recruitment_onboarding')))return 'My checklists';
 if(page.module&&getAccessScope(role,page.module)==='self')return ({'/employees':'My employee record','/payroll':'My payroll','/attendance':'My attendance','/leave':'My leave','/documents':'My documents','/performance':'My performance','/benefits':'My benefits','/expenses':'My expenses'} as Record<string,string>)[page.href]||page.label;
 return page.label;
}
export const roleLabel=(role:string)=>role.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()).replace(/^Hr\b/,'HR');
