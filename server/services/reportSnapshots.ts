import {sql} from 'drizzle-orm';
import {getAccessScope,hasPermission,type HRModule} from '@shared/permissions';
import type {UserRole} from '@shared/schema';
import {reportLabels,type ReportInput,type ReportKind,type ReportSnapshot} from '@shared/reporting';
import {companySettingsSchema,defaultCompanySettings} from '@shared/settings';
import {workforceAdmin} from '@shared/workforce';
import {WorkforceError as OnboardingError} from './workforce';
import {qatarToday} from './reportRecords';

const sources:Record<ReportKind,HRModule>={headcount:'employee_database',turnover:'employee_database',leave:'leave_absence_management',compliance:'compliance_documents',workforce:'event_staff_management'};
export function availableReports(role:UserRole){
 const all=(module:HRModule)=>hasPermission(role,module,'read')&&getAccessScope(role,module)==='all';
 return (Object.keys(reportLabels) as ReportKind[]).filter(kind=>all('reports_analytics')&&all(sources[kind])&&(kind!=='workforce'||workforceAdmin(role)));
}
export async function reportingPolicy(tx:any){const r=await tx.execute(sql`SELECT version,turnover_denominator FROM reporting_policies ORDER BY version DESC LIMIT 1`);return r.rows[0]||{version:0,turnover_denominator:'average_endpoints'};}
const columns=(...keys:string[])=>keys.map(key=>({key,label:key.replaceAll('_',' ')}));
const sum=(rows:any[],key:string)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);

// Each run executes in a repeatable-read transaction; displayed values and CSV
// exports subsequently come exclusively from this saved, owner-private snapshot.
export async function buildReport(tx:any,input:ReportInput):Promise<ReportSnapshot>{
 const {kind,filters:f}=input,asOf=qatarToday();
 const result:ReportSnapshot={kind,title:reportLabels[kind],generatedAt:new Date().toISOString(),asOf,definition:'',filters:f,policy:{},summary:{},columns:[],rows:[],notes:[]};
 const department=f.department?sql`e.department=${f.department}`:sql`true`;
 if(kind==='headcount'){
  const r=await tx.execute(sql`SELECT e.department,e.type::text AS employee_type,e.status::text AS status,count(*)::int AS employees FROM employees e WHERE ${department} GROUP BY e.department,e.type,e.status ORDER BY e.department,e.type,e.status LIMIT 5001`);
  result.rows=r.rows;result.columns=columns('department','employee_type','status','employees');result.summary={registered_employees:sum(r.rows,'employees')};
  result.definition='Current employee records grouped by department, employment type and recorded status. Includes inactive employees as separate groups; this is not historical headcount.';
 }else if(kind==='turnover'){
  const policy=await reportingPolicy(tx);result.policy=policy;
  const r=await tx.execute(sql`SELECT e.department,
   count(*) FILTER(WHERE e.joining_date<${f.from}::date AND (e.termination_date IS NULL OR e.termination_date>=${f.from}::date))::int AS opening,
   count(*) FILTER(WHERE e.joining_date<=${f.to}::date AND (e.termination_date IS NULL OR e.termination_date>${f.to}::date))::int AS closing,
   count(*) FILTER(WHERE e.termination_date BETWEEN ${f.from}::date AND ${f.to}::date)::int AS exits
   FROM employees e WHERE ${department} AND e.joining_date<=${f.to}::date GROUP BY e.department ORDER BY e.department LIMIT 5001`);
  const rate=(opening:number,closing:number,exits:number)=>{const denominator=policy.turnover_denominator==='opening'?opening:(opening+closing)/2;return denominator?Math.round(exits/denominator*10000)/100:null;};
  result.rows=r.rows.map((r:any)=>({...r,turnover_percent:rate(r.opening,r.closing,r.exits)}));result.columns=columns('department','opening','closing','exits','turnover_percent');
  const opening=sum(r.rows,'opening'),closing=sum(r.rows,'closing'),exits=sum(r.rows,'exits');result.summary={opening,closing,exits,turnover_percent:rate(opening,closing,exits)};
  result.definition=`Recorded exits in the inclusive date range divided by ${policy.turnover_denominator==='opening'?'opening headcount':'the mean of opening and closing headcount'}, multiplied by 100. Opening is just before the first day; closing is after exits on the final day.`;
  result.notes=['Uses current joining and termination dates; it cannot reconstruct earlier employment spells or deleted records. Blank rates mean zero denominator. Status alone does not establish an exit date.'];
 }else if(kind==='leave'){
  const r=await tx.execute(sql`SELECT e.department,l.leave_type::text AS leave_type,count(*)::int AS bookings,COALESCE(sum(l.total_days),0)::float8 AS charged_days FROM leaves l JOIN employees e ON e.id=l.employee_id WHERE ${department} AND l.status='approved' AND l.start_date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY e.department,l.leave_type ORDER BY e.department,l.leave_type LIMIT 5001`);
  result.rows=r.rows;result.columns=columns('department','leave_type','bookings','charged_days');result.summary={bookings:sum(r.rows,'bookings'),charged_days:sum(r.rows,'charged_days')};
  result.definition='Approved leave bookings whose start date falls within the inclusive range, using each booking’s saved totalDays.';
  result.notes=['A booking starting before the range is excluded. A booking ending after the range includes its full saved charge. This is a booking report, not daily absence utilization; no days are recalculated.'];
 }else if(kind==='compliance'){
  const settings=await tx.execute(sql`SELECT value FROM app_settings WHERE key='company'`);
  const policy=settings.rows[0]?companySettingsSchema.parse(settings.rows[0].value):defaultCompanySettings;
  result.policy={documentExpiryDays:policy.documentExpiryDays};
  const r=await tx.execute(sql`SELECT e.department,d.document_type::text AS document_type,CASE WHEN d.expiry_date IS NULL THEN 'no_expiry' WHEN d.expiry_date<${asOf}::date THEN 'expired' WHEN d.issue_date>${asOf}::date THEN 'not_yet_valid' WHEN d.expiry_date<=${asOf}::date+${policy.documentExpiryDays}::int THEN 'expiring_soon' ELSE 'valid' END AS status,count(*)::int AS documents FROM documents d JOIN employees e ON e.id=d.employee_id WHERE ${department} AND NOT EXISTS(SELECT 1 FROM hr_document_archives a WHERE a.document_id=d.id AND a.archived) GROUP BY e.department,d.document_type,3 ORDER BY e.department,d.document_type,status LIMIT 5001`);
  result.rows=r.rows;result.columns=columns('department','document_type','status','documents');result.summary={documents:sum(r.rows,'documents')};
  result.definition='Current registered documents classified from issue and expiry dates as of the Qatar calendar date. The company expiry warning window is pinned to this run.';
  result.notes=['Includes documents belonging to inactive employees, excluding archived documents. Counts documents, not employees; missing required documents are not inferred.'];
 }else{
  // Aggregate assignments per shift before summing capacity to avoid multiplying
  // headcount by the number of people assigned to the same shift.
  const r=await tx.execute(sql`SELECT site.name AS site,t.name AS team,t.kind::text AS team_kind,site.timezone,count(*)::int AS shifts,sum(s.headcount)::int AS capacity,
   sum(a.offered)::int AS offered,sum(a.accepted)::int AS accepted,sum(a.declined)::int AS declined,sum(a.cancelled)::int AS cancelled,sum(a.payable_minutes)::int AS approved_payable_minutes
   FROM workforce_shifts s JOIN workforce_teams t ON t.id=s.team_id JOIN workforce_sites site ON site.id=t.site_id
   CROSS JOIN LATERAL(SELECT count(*) FILTER(WHERE wa.status='offered') AS offered,count(*) FILTER(WHERE wa.status='accepted') AS accepted,count(*) FILTER(WHERE wa.status='declined') AS declined,count(*) FILTER(WHERE wa.status='cancelled') AS cancelled,COALESCE(sum(wt.payable_minutes) FILTER(WHERE wt.status IN ('approved','payroll_locked')),0) AS payable_minutes FROM workforce_assignments wa LEFT JOIN workforce_timesheets wt ON wt.assignment_id=wa.id WHERE wa.shift_id=s.id) a
   WHERE s.status='scheduled' AND (s.start_at AT TIME ZONE site.timezone)::date BETWEEN ${f.from}::date AND ${f.to}::date AND (${!f.siteId} OR site.id=${f.siteId||0}) AND (${!f.teamId} OR t.id=${f.teamId||0})
   GROUP BY site.id,t.id ORDER BY site.name,t.name,t.id LIMIT 5001`);
  result.rows=r.rows;result.columns=columns('site','team','team_kind','timezone','shifts','capacity','offered','accepted','declined','cancelled','approved_payable_minutes');result.summary=Object.fromEntries(['shifts','capacity','offered','accepted','declined','cancelled','approved_payable_minutes'].map(key=>[key,sum(r.rows,key)]));
  result.definition='Non-cancelled Workforce shifts starting in the inclusive date range in each site’s timezone. Assignment statuses are current; payable minutes include only approved or payroll-locked timesheets.';
  result.notes=['Earlier Event Staff assignments are excluded and remain in the archive. No payroll cost is estimated. Cancelled assignment counts belong to non-cancelled shifts.'];
 }
 if(result.rows.length>5000)throw new OnboardingError(400,'Report exceeds 5,000 groups; narrow the filters');
 return result;
}

export function snapshotCsv(snapshot:ReportSnapshot){
 const cell=(value:unknown)=>{let text=value==null?'':String(value);if(typeof value==='string'&&/^\s*[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows:unknown[][]=[['Report',snapshot.title],['Generated at',snapshot.generatedAt],['As of (Qatar)',snapshot.asOf],['Definition',snapshot.definition],['Filters',JSON.stringify(snapshot.filters)],['Policy',JSON.stringify(snapshot.policy)],...Object.entries(snapshot.summary),...snapshot.notes.map(note=>['Note',note]),[],snapshot.columns.map(c=>c.label),...snapshot.rows.map(r=>snapshot.columns.map(c=>r[c.key]))];
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
