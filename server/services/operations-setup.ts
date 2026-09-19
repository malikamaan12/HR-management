import {sql} from 'drizzle-orm';
import {db} from '../db';
import type {UserRole} from '@shared/schema';
import {getAccessScope,hasPermission,type HRModule} from '@shared/permissions';
import {civilDate,leaveRule} from '@shared/hr-rules';
import {geofenceDefinition} from '@shared/attendance-location';
import {inductionSettings} from '@shared/induction';
import {siteTimeToIso} from '@shared/workforce';
import type {OperationsSetupResponse,OperationsSetupSection,OperationsSetupSectionId} from '@shared/operations-setup';
import {locationPolicy} from './attendance-location';

type Person={id:number;code:string;userId:number|null;type:'permanent'|'temporary'|'contract';department:string;workSchedule:string;reportingManagerId:number|null};
type Account={id:number;role:UserRole;department:string|null;isActive:boolean;approvalStatus:string;passwordSetupRequired?:boolean;accountState?:string;employeeId:number|null;employeeStatus:string|null};
type Team={id:number;siteId:number;name:string};
type Membership={id:number;teamId:number;employeeId:number;startAt:Date|string;endAt:Date|string};
type Grant={teamId:number;userId:number;startAt:Date|string;endAt:Date|string};
type Shift={id:number;teamId:number;employeeId:number;startAt:Date|string;endAt:Date|string};
type Rule={id:number;employeeId:number|null;name:string;config:unknown};
type Course={id:number;title:string;approverId:number;settings:unknown};
type Enrollment={employeeId:number;courseId:number};
export interface OperationsSetupData {
  counts:OperationsSetupResponse['counts'];
  people:Person[];accounts:Account[];teams:Team[];memberships:Membership[];grants:Grant[];shifts:Shift[];
  locations:{id:number;config:unknown}[];gpsRequired:boolean;requirePermanentApproval:boolean;
  leaveTypes:string[];rules:Rule[];courses:Course[];onboarding:{id:number;employeeId:number}[];enrollments:Enrollment[];
  truncated:boolean;window:{start:string;end:string};
}
const limits={people:5000,accounts:10000,teams:10000,memberships:20000,grants:20000,shifts:20000,locations:10000,rules:20000,leaveTypes:500,courses:1000,onboarding:5000,enrollments:50000};
const stamp=(value:Date|string)=>new Date(value).getTime();
const validAccount=(user:Account|undefined):user is Account=>!!user&&user.isActive&&user.approvalStatus==='approved'&&(!user.accountState||user.accountState==='active')&&!user.passwordSetupRequired;

/** Mirrors employeeScope, with the authoritative shared role permissions and projected account links. */
export function setupApproverCanAccess(user:Account|undefined,employee:Person,module:HRModule){
  if(!validAccount(user)||user.id===employee.userId||!hasPermission(user.role,module,'approve'))return false;
  switch(getAccessScope(user.role,module)){
    case 'all':return true;
    case 'department':return !!user.department&&user.department===employee.department;
    case 'team':return user.employeeId!==null&&employee.reportingManagerId===user.employeeId;
    case 'event_staff':return employee.type==='temporary';
    // Self-only scope cannot provide an independent approval.
    default:return false;
  }
}

/** Pure evaluator so date coverage and permissions can be checked without production writes. */
export function evaluateOperationsSetup(data:OperationsSetupData,asOf:string):OperationsSetupResponse{
  const titles:Record<OperationsSetupSectionId,string>={people:'Employee accounts',locations:'Attendance locations',supervisors:'Supervisors and team access',leave:'Leave approval chains',induction:'Required induction'};
  const section=(id:OperationsSetupSectionId):OperationsSetupSection=>({id,title:titles[id],status:'ready',summary:'',issues:[],issueCount:0});
  const sections=[section('people'),section('locations'),section('supervisors'),section('leave'),section('induction')];
  const bySection=Object.fromEntries(sections.map(s=>[s.id,s])) as Record<OperationsSetupSectionId,OperationsSetupSection>;
  const add=(id:OperationsSetupSectionId,key:string,message:string,href:string)=>{const target=bySection[id];target.issueCount++;if(target.issues.length<50)target.issues.push({key,message,href});target.status='action_required';};
  const users=new Map(data.accounts.map(u=>[u.id,u]));
  const managers=new Map(data.accounts.filter(u=>u.employeeId!==null).map(u=>[u.employeeId!,u]));
  const people=new Map(data.people.map(e=>[e.id,e]));
  const teams=new Map(data.teams.map(t=>[t.id,t]));
  const grants=new Map<number,Grant[]>();
  for(const grant of data.grants)if(validAccount(users.get(grant.userId)))grants.set(grant.teamId,[...(grants.get(grant.teamId)||[]),grant]);
  const members=new Map<number,Membership[]>();
  for(const member of data.memberships)members.set(member.employeeId,[...(members.get(member.employeeId)||[]),member]);
  const label=(employee:Person)=>`Employee ${employee.code}`;
  const employeeHref=(_employee:Person)=>'/employees';

  for(const employee of data.people){
    const account=employee.userId===null?undefined:users.get(employee.userId);
    if(!account)add('people',`account-${employee.id}`,`${label(employee)} needs a linked login account.`, '/user-management');
    else if(!account.isActive||account.approvalStatus!=='approved'||(account.accountState&&account.accountState!=='active'))add('people',`account-${employee.id}`,`${label(employee)} has a linked account whose access is inactive or awaiting approval.`, '/user-management');
    else if(account.passwordSetupRequired)add('people',`account-${employee.id}`,`${label(employee)} has a linked account and needs to complete sign-in setup.`, '/user-management');
    if(employee.workSchedule==='unassigned')add('people',`schedule-${employee.id}`,`${label(employee)} needs an office or shift-based work schedule.`,employeeHref(employee));
  }
  bySection.people.summary=`${data.counts.linkedEmployees} of ${data.counts.activeEmployees} active employees have linked accounts; ${data.counts.readyEmployees} can sign in and ${data.counts.setupPendingEmployees} need sign-in setup. Employee work schedules are also checked.`;

  const fences=data.locations.flatMap(row=>{const parsed=geofenceDefinition.safeParse(row.config);if(!parsed.success){add('locations',`invalid-location-${row.id}`,`Location #${row.id} needs valid location settings.`, '/operations-setup?tab=locations');return [];}return parsed.data.enabled&&(!parsed.data.startsOn||parsed.data.startsOn<=asOf)&&(!parsed.data.endsOn||parsed.data.endsOn>=asOf)?[parsed.data]:[];});
  const covered=(employeeId:number,siteId:number|null)=>fences.some(f=>f.siteId===siteId&&(!f.employeeIds.length||f.employeeIds.includes(employeeId)));
  for(const employee of data.people){
    if(!covered(employee.id,null))add('locations',`office-${employee.id}`,`${label(employee)} has no active location for the office attendance clock on ${asOf}.`, '/operations-setup?tab=locations');
    const seen=new Set<number>();
    for(const member of members.get(employee.id)||[]){const team=teams.get(member.teamId);if(team&&!seen.has(team.siteId)&&!covered(employee.id,team.siteId)){seen.add(team.siteId);add('locations',`site-${employee.id}-${team.siteId}`,`${label(employee)} needs an active location for workforce site #${team.siteId} on ${asOf}.`, '/operations-setup?tab=locations');}}
  }
  if(!data.gpsRequired)add('locations','gps-disabled','GPS enforcement is disabled. Configure actual workplace boundaries and employee coverage before enabling it.', '/operations-setup?tab=locations');
  bySection.locations.summary=`${fences.length} enabled locations cover the selected date. GPS enforcement is ${data.gpsRequired?'enabled':'disabled'}. Office clock and staffed-site coverage are checked separately.`;

  for(const employee of data.people){
    const teamMemberships=members.get(employee.id)||[];
    const needsOfficeReview=employee.type!=='permanent'||data.requirePermanentApproval||teamMemberships.length>0;
    if(needsOfficeReview){
      const manager=employee.reportingManagerId===null?undefined:managers.get(employee.reportingManagerId);
      if(!manager||manager.employeeStatus!=='active'||!setupApproverCanAccess(manager,employee,'attendance_time_tracking'))add('supervisors',`manager-${employee.id}`,`${label(employee)} needs an active primary manager account with independent attendance approval access. Company-wide HR access is not a designated manager assignment.`,employeeHref(employee));
    }
    if(employee.workSchedule==='shift_based'&&!teamMemberships.length)add('supervisors',`membership-${employee.id}`,`${label(employee)} has no workforce team membership covering ${asOf}.`, '/workforce');
    for(const member of teamMemberships){
      const start=Math.max(stamp(member.startAt),stamp(data.window.start)),end=Math.min(stamp(member.endAt),stamp(data.window.end));
      const windows=(grants.get(member.teamId)||[]).filter(g=>g.userId!==employee.userId).map(g=>({start:stamp(g.startAt),end:stamp(g.endAt)})).sort((a,b)=>a.start-b.start);
      let until=start;for(const window of windows){if(window.start>until)break;if(window.end>until)until=window.end;if(until>=end)break;}
      if(until<end)add('supervisors',`grant-${member.id}`,`${label(employee)} needs independent review-time access covering their membership on ${asOf} in team #${member.teamId}. Global HR access remains a fallback, not an assigned supervisor.`,`/workforce?teamId=${member.teamId}`);
    }
  }
  for(const shift of data.shifts){const employee=people.get(shift.employeeId);if(!employee)continue;
    const reviewer=(grants.get(shift.teamId)||[]).some(g=>g.userId!==employee.userId&&stamp(g.startAt)<=stamp(shift.startAt)&&stamp(g.endAt)>=stamp(shift.endAt));
    if(!reviewer)add('supervisors',`shift-${shift.id}-${shift.employeeId}`,`${label(employee)} has an accepted shift #${shift.id} without an independent supervisor grant covering the entire shift, including any overnight portion.`,`/workforce?teamId=${shift.teamId}`);
  }
  bySection.supervisors.summary=`Checks designated office reviewers where approval is required, dated team memberships and supervisor coverage for accepted shifts on ${asOf}.`;

  // Rows are already reduced to the newest effective revision per employee/type in SQL.
  const ruleMap=new Map(data.rules.map(r=>[`${r.employeeId??'company'}:${r.name}`,r]));
  // A null stage needs one independent candidate, excluding at most the employee
  // and three named later reviewers. Retaining five per scope avoids N×users scans.
  const leaveCandidates=new Map<string,Account[]>();
  for(const user of data.accounts){
    if(!validAccount(user)||!hasPermission(user.role,'leave_absence_management','approve'))continue;
    const scope=getAccessScope(user.role,'leave_absence_management');
    const key=scope==='all'?'all':scope==='department'&&user.department?`department:${user.department}`:scope==='team'&&user.employeeId!==null?`team:${user.employeeId}`:scope==='event_staff'?'event_staff':null;
    if(key){const entries=leaveCandidates.get(key)||[];if(entries.length<5)entries.push(user);leaveCandidates.set(key,entries);}
  }
  const parsedRules=new Map(data.rules.map(rule=>[rule.id,leaveRule.safeParse(rule.config)]));
  if(!data.leaveTypes.length)add('leave','no-types','Create company leave types and their effective approval rules. No leave policy is configured.', '/operations-setup?tab=leave');
  for(const employee of data.people)for(const type of data.leaveTypes){
    const rule=ruleMap.get(`${employee.id}:${type}`)||ruleMap.get(`company:${type}`);
    if(!rule){add('leave',`missing-${employee.id}-${type}`,`${label(employee)} has no effective ${type} rule on ${asOf}.`, '/operations-setup?tab=leave');continue;}
    const parsed=parsedRules.get(rule.id)!;if(!parsed.success){add('leave',`invalid-${employee.id}-${type}`,`${label(employee)} has an invalid ${type} approval rule.`, '/operations-setup?tab=leave');continue;}
    const ids=[parsed.data.approverId,...parsed.data.additionalApproverIds];
    for(let stage=0;stage<ids.length;stage++){
      const id=ids[stage];
      const candidateKeys=['all',`department:${employee.department}`,`team:${employee.reportingManagerId}`,...(employee.type==='temporary'?['event_staff']:[])];
      const valid=id===null?candidateKeys.some(key=>(leaveCandidates.get(key)||[]).some(u=>!ids.includes(u.id)&&setupApproverCanAccess(u,employee,'leave_absence_management'))):setupApproverCanAccess(users.get(id),employee,'leave_absence_management');
      if(!valid)add('leave',`approver-${employee.id}-${type}-${stage}`,`${label(employee)} needs an active, independent, in-scope approver for ${type} stage ${stage+1}${id===null?' (any eligible approver)':''}.`, '/operations-setup?tab=leave');
    }
  }
  bySection.leave.summary=`${data.leaveTypes.length} configured leave types checked against employee overrides, effective dates and independent approval stages. An unassigned first stage means any eligible in-scope approver.`;

  const courses=data.courses.flatMap(course=>{const parsed=inductionSettings.safeParse(course.settings);if(!parsed.success){add('induction',`invalid-course-${course.id}`,`Published course #${course.id} has invalid induction settings.`, '/operations-setup?tab=induction');return [];}return parsed.data.mandatoryForOnboarding?[{...course,settings:parsed.data}]:[];});
  const enrolled=new Set(data.enrollments.map(e=>`${e.employeeId}:${e.courseId}`));
  const openCases=new Map(data.onboarding.map(c=>[c.employeeId,c]));
  if(!courses.length)add('induction','no-mandatory','Choose and publish the courses required for onboarding, including their employee types, departments and due dates.', '/operations-setup?tab=induction');
  for(const employee of data.people){
    const audience=courses.filter(c=>c.settings.employeeTypes.includes(employee.type)&&(!c.settings.departments.length||c.settings.departments.includes(employee.department)));
    if(courses.length&&!audience.length)add('induction',`audience-${employee.id}`,`${label(employee)} is outside the audience of all published mandatory induction courses.`, '/operations-setup?tab=induction');
    for(const course of audience){
      if((course.settings.reviewRequired||course.settings.enrollmentApprovalRequired)&&!setupApproverCanAccess(users.get(course.approverId),employee,'training_development'))add('induction',`reviewer-${employee.id}-${course.id}`,`${label(employee)} needs an independent in-scope reviewer for required course ${course.title}.`, '/operations-setup?tab=induction');
      if(openCases.has(employee.id)&&!enrolled.has(`${employee.id}:${course.id}`))add('induction',`sync-${employee.id}-${course.id}`,`${label(employee)} has an open onboarding workflow missing the current required assignment for ${course.title}. Open onboarding and assign newly published required induction.`, '/onboarding');
    }
  }
  bySection.induction.summary=`${courses.length} published mandatory courses checked for audience coverage and missing assignments in open onboarding. Existing valid completions and open required enrollments are retained; drafts are not active requirements.`;

  if(!data.counts.activeEmployees)for(const target of sections){target.status='not_started';target.summary='No active employees yet. Import or create employees, then complete this operational setup.';if(!target.issueCount)add(target.id,'no-employees','Add employee records before checking operational readiness.', '/bulk-import');target.status='not_started';}
  else {
    if(!data.rules.length)bySection.leave.status='not_started';
    if(!courses.length)bySection.induction.status='not_started';
    if(!data.locations.length)bySection.locations.status='not_started';
  }
  if(data.truncated)for(const target of sections)add(target.id,'data-limit','This overview reached a data limit. Review the source modules; this check is incomplete.', '/operations-setup');
  return {asOf,counts:data.counts,sections,truncated:data.truncated};
}

export async function operationsSetup(asOf:string):Promise<OperationsSetupResponse>{
  civilDate.parse(asOf);
  const timezone=process.env.APP_TIMEZONE||'Asia/Qatar';
  const next=new Date(Date.parse(asOf+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const window={start:siteTimeToIso(asOf+'T00:00',timezone),end:siteTimeToIso(next+'T00:00',timezone)};
  return db.transaction(async tx=>{
    const rows=<T>(result:{rows:unknown[]})=>result.rows as T[];
    const [countResult,peopleResult,accountsResult,teamsResult,membershipsResult,grantsResult,shiftsResult,locationsResult,rulesResult,typesResult,coursesResult,onboardingResult,enrollmentsResult,policy]=await Promise.all([
      tx.execute(sql`SELECT count(*)::int AS "activeEmployees", count(u.id)::int AS "linkedEmployees",
        count(u.id) FILTER (WHERE u.is_active=true AND u.approval_status='approved' AND u.account_state='active' AND u.password_setup_required=false)::int AS "readyEmployees",
        count(u.id) FILTER (WHERE u.is_active=true AND u.approval_status='approved' AND u.account_state='active' AND u.password_setup_required=true)::int AS "setupPendingEmployees",
        (SELECT count(*)::int FROM workforce_teams) AS teams,(SELECT count(*)::int FROM workforce_sites) AS sites
        FROM employees e LEFT JOIN users u ON u.id=e.user_id WHERE e.status='active'`),
      tx.execute(sql`SELECT id,employee_id AS code,user_id AS "userId",type,department,work_schedule AS "workSchedule",reporting_manager_id AS "reportingManagerId" FROM employees WHERE status='active' ORDER BY id LIMIT ${limits.people+1}`),
      tx.execute(sql`SELECT u.id,u.role,u.department,u.is_active AS "isActive",u.approval_status AS "approvalStatus",u.password_setup_required AS "passwordSetupRequired",u.account_state AS "accountState",e.id AS "employeeId",e.status AS "employeeStatus" FROM users u LEFT JOIN employees e ON e.user_id=u.id ORDER BY u.id LIMIT ${limits.accounts+1}`),
      tx.execute(sql`SELECT id,site_id AS "siteId",name FROM workforce_teams ORDER BY id LIMIT ${limits.teams+1}`),
      tx.execute(sql`SELECT m.id,m.team_id AS "teamId",m.employee_id AS "employeeId",m.start_at AS "startAt",m.end_at AS "endAt" FROM workforce_members m JOIN employees e ON e.id=m.employee_id WHERE e.status='active' AND m.start_at<${window.end}::timestamptz AND m.end_at>${window.start}::timestamptz ORDER BY m.id LIMIT ${limits.memberships+1}`),
      tx.execute(sql`SELECT team_id AS "teamId",user_id AS "userId",start_at AS "startAt",end_at AS "endAt" FROM workforce_grants WHERE permission='review_time' AND revoked_at IS NULL AND start_at<${window.end}::timestamptz AND end_at>${window.start}::timestamptz ORDER BY id LIMIT ${limits.grants+1}`),
      tx.execute(sql`SELECT s.id,s.team_id AS "teamId",a.employee_id AS "employeeId",s.start_at AS "startAt",s.end_at AS "endAt" FROM workforce_shifts s JOIN workforce_assignments a ON a.shift_id=s.id JOIN employees e ON e.id=a.employee_id WHERE e.status='active' AND a.status='accepted' AND s.status='scheduled' AND s.start_at<${window.end}::timestamptz AND s.end_at>${window.start}::timestamptz ORDER BY s.id,a.id LIMIT ${limits.shifts+1}`),
      tx.execute(sql`SELECT id,config FROM attendance_geofence_locations ORDER BY id LIMIT ${limits.locations+1}`),
      tx.execute(sql`SELECT DISTINCT ON(employee_id,name) id,employee_id AS "employeeId",name,config FROM hr_rules WHERE kind='leave' AND effective_from<=${asOf}::date ORDER BY employee_id,name,effective_from DESC,id DESC LIMIT ${limits.rules+1}`),
      tx.execute(sql`SELECT DISTINCT name FROM hr_rules WHERE kind='leave' ORDER BY name LIMIT ${limits.leaveTypes+1}`),
      tx.execute(sql`SELECT c.id,r.definition->>'title' AS title,(r.definition->>'approverId')::int AS "approverId",r.content->'settings' AS settings FROM learning_courses c JOIN learning_induction_courses i ON i.course_id=c.id JOIN learning_induction_releases r ON r.id=i.published_release_id WHERE c.definition->>'status'='published' ORDER BY c.id LIMIT ${limits.courses+1}`),
      tx.execute(sql`SELECT c.id,c.employee_id AS "employeeId" FROM lifecycle_cases c JOIN employees e ON e.id=c.employee_id WHERE e.status='active' AND c.kind='onboarding' AND c.status='in_progress' ORDER BY c.id LIMIT ${limits.onboarding+1}`),
      tx.execute(sql`SELECT DISTINCT e.employee_id AS "employeeId",e.course_id AS "courseId" FROM learning_enrollments e JOIN learning_induction_enrollments i ON i.enrollment_id=e.id JOIN employees p ON p.id=e.employee_id WHERE p.status='active' AND i.required=true AND (e.status IN ('requested','approved','in_progress','completion_submitted') OR (e.status='completed' AND (e.expires_on IS NULL OR e.expires_on>=${asOf}::date))) ORDER BY e.employee_id,e.course_id LIMIT ${limits.enrollments+1}`),
      locationPolicy(tx),
    ]);
    let truncated=false;
    const bounded=<T>(result:{rows:unknown[]},limit:number)=>{if(result.rows.length>limit)truncated=true;return rows<T>(result).slice(0,limit);};
    const data:OperationsSetupData={counts:rows<OperationsSetupResponse['counts']>(countResult)[0],
      people:bounded<Person>(peopleResult,limits.people),accounts:bounded<Account>(accountsResult,limits.accounts),teams:bounded<Team>(teamsResult,limits.teams),
      memberships:bounded<Membership>(membershipsResult,limits.memberships),grants:bounded<Grant>(grantsResult,limits.grants),shifts:bounded<Shift>(shiftsResult,limits.shifts),
      locations:bounded<{id:number;config:unknown}>(locationsResult,limits.locations),rules:bounded<Rule>(rulesResult,limits.rules),leaveTypes:bounded<{name:string}>(typesResult,limits.leaveTypes).map(t=>t.name),
      courses:bounded<Course>(coursesResult,limits.courses),onboarding:bounded<{id:number;employeeId:number}>(onboardingResult,limits.onboarding),enrollments:bounded<Enrollment>(enrollmentsResult,limits.enrollments),
      gpsRequired:policy.config.required,requirePermanentApproval:policy.config.requirePermanentApproval,truncated:false,window};
    data.truncated=truncated;
    return evaluateOperationsSetup(data,asOf);
  },{isolationLevel:'repeatable read',accessMode:'read only'});
}
