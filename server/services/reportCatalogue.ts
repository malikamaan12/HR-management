import {sql} from 'drizzle-orm';
import type {ReportInput,ReportSnapshot} from '@shared/reporting';
import type {TokenPayload} from './auth';
import {reportEmployeeScope,reportDepartmentScope,reportHelpdeskScope} from './reportAccess';
import {channelManage,channelScope} from './communications';
import {commAdmin,commPublisher} from '@shared/communications';

const columns=(keys:string[])=>keys.map(key=>({key,label:key.replaceAll('_',' ')}));
const sum=(rows:any[],key:string)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
export async function buildCatalogueReport(tx:any,input:ReportInput,user:TokenPayload,result:ReportSnapshot,settings:{minimumPerformanceSample:number}){
 const {kind,filters:f}=input,day=result.asOf;
 const people=sql`(${reportEmployeeScope(user,kind)}) AND (${!f.department} OR e.department=${f.department}) AND (${!f.employeeType} OR e.type::text=${f.employeeType||''}) AND (${!f.location} OR e.location=${f.location||''})`;
 let rows:any[]=[],totals:string[]=[];
 if(kind==='attendance'){
  rows=(await tx.execute(sql`SELECT to_char(a.date,'YYYY-MM') AS month,e.department,a.status::text AS status,a.approval_status,count(*)::int AS records,
   count(*) FILTER(WHERE a.check_in IS NOT NULL AND a.check_out IS NULL)::int AS open_sessions,
   coalesce(sum(a.total_work_hours) FILTER(WHERE a.check_out IS NOT NULL),0)::int AS recorded_work_minutes,
   coalesce(sum(a.overtime_hours) FILTER(WHERE a.check_out IS NOT NULL),0)::int AS recorded_overtime_minutes,
   coalesce(sum(a.total_work_hours) FILTER(WHERE a.check_out IS NOT NULL AND a.approval_status IN ('approved','not_required')),0)::int AS eligible_work_minutes
   FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE ${people} AND a.date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['records','open_sessions','recorded_work_minutes','recorded_overtime_minutes','eligible_work_minutes'];
  result.definition='Recorded attendance by attendance date, current department, status and supervisor approval. Saved minute totals are used; open sessions are excluded from work totals.';
  result.notes=['Unrecorded days are not assumed absent. These are recorded minutes, not payroll amounts. Pending/rejected supervisor time is excluded from eligible work minutes. No GPS coordinates are disclosed.'];
 }else if(kind==='payroll'){
  rows=(await tx.execute(sql`SELECT to_char(coalesce(r.period_start,make_date(p.year,p.month,1)),'YYYY-MM') AS month,e.department,coalesce(r.currency,'UNSPECIFIED') AS currency,p.status,
   count(*)::int AS records,sum(p.basic_salary)::text AS basic_amount,sum(p.net_salary)::text AS net_amount,
   sum(coalesce((SELECT sum(value::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(p.allowances::jsonb)='object' THEN p.allowances::jsonb ELSE '{}'::jsonb END) WHERE value ~ '^-?[0-9]+(\\.[0-9]+)?$'),0))::text AS allowance_amount,
   sum(coalesce((SELECT sum(value::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(p.deductions::jsonb)='object' THEN p.deductions::jsonb ELSE '{}'::jsonb END) WHERE value ~ '^-?[0-9]+(\\.[0-9]+)?$'),0))::text AS deduction_amount,
   count(*) FILTER(WHERE r.payroll_id IS NULL)::int AS legacy_without_review
   FROM payroll p JOIN employees e ON e.id=p.employee_id LEFT JOIN payroll_reviews r ON r.payroll_id=p.id
   WHERE ${people} AND coalesce(r.period_start,make_date(p.year,p.month,1)) BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['records','legacy_without_review'];
  result.definition='Saved payroll amounts grouped by period-start month, current department, currency and workflow status. Processed means a payment reference was recorded in HR.';
  result.notes=['Currencies and statuses remain separate; there is no mixed-currency total or inferred bank settlement. Legacy rows without a reviewed period use their calendar month and are explicitly marked. Allowance/deduction totals include numeric saved components only.'];
 }else if(kind==='recruitment'){
  rows=(await tx.execute(sql`SELECT to_char(a.application_date,'YYYY-MM') AS month,j.department,j.job_title,a.status::text AS status,count(*)::int AS applications,
   sum(o.offers)::int AS offers,sum(o.accepted)::int AS accepted_offers,
   count(*) FILTER(WHERE o.accepted_on>=a.application_date)::int AS hiring_samples,
   round(avg(o.accepted_on-a.application_date) FILTER(WHERE o.accepted_on>=a.application_date),2)::float8 AS average_days_to_accept
   FROM job_applications a JOIN job_requisitions j ON j.id=a.requisition_id
   CROSS JOIN LATERAL(SELECT count(*) AS offers,count(*) FILTER(WHERE status='accepted') AS accepted,min(acceptance_date) FILTER(WHERE status='accepted') AS accepted_on FROM job_offers WHERE application_id=a.id) o
   WHERE ${reportDepartmentScope(user,kind,sql`j.department`)} AND (${!f.department} OR j.department=${f.department}) AND (${!f.employeeType} OR j.position_type=${f.employeeType||''}) AND (${!f.location} OR j.location=${f.location||''}) AND a.application_date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['applications','offers','accepted_offers','hiring_samples'];result.definition='Applications submitted in the selected period, with their current stages and recorded offer outcomes. Days to accept uses accepted offers with valid acceptance dates.';
  result.notes=['This is a current application cohort, not a history of every stage transition. No candidate contact details, interview comments or offer salary is included.'];
 }else if(kind==='lifecycle'){
  rows=(await tx.execute(sql`SELECT to_char(c.start_date,'YYYY-MM') AS month,e.department,c.kind,c.status,count(*)::int AS cases,sum(t.tasks)::int AS tasks,sum(t.completed)::int AS completed_tasks,sum(t.overdue)::int AS overdue_tasks
   FROM lifecycle_cases c JOIN employees e ON e.id=c.employee_id CROSS JOIN LATERAL(SELECT count(*) AS tasks,count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='pending' AND due_date<${day}::date AND c.status='in_progress') AS overdue FROM lifecycle_tasks WHERE case_id=c.id) t
   WHERE ${people} AND c.start_date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['cases','tasks','completed_tasks','overdue_tasks'];result.definition='Onboarding/offboarding cases starting in the period, with current checklist completion. Overdue pending tasks belong only to in-progress cases and use today’s Qatar date.';
 }else if(kind==='learning'){
  rows=(await tx.execute(sql`SELECT to_char(l.created_at AT TIME ZONE 'Asia/Qatar','YYYY-MM') AS month,e.department,coalesce(l.course_snapshot->>'title','Untitled course') AS course,l.status,
   count(*)::int AS enrollments,count(*) FILTER(WHERE l.status='completed')::int AS completions,count(*) FILTER(WHERE l.status NOT IN ('completed','withdrawn','rejected','failed') AND l.due_date<${day}::date)::int AS overdue,
   count(*) FILTER(WHERE l.status='completed' AND l.expires_on<${day}::date)::int AS expired_certificates,
   sum(q.attempts)::int AS submitted_quizzes,sum(q.passed)::int AS passed_quizzes,
   round(sum(q.score_total)/nullif(sum(q.attempts),0),2)::float8 AS average_quiz_score
   FROM learning_enrollments l JOIN employees e ON e.id=l.employee_id CROSS JOIN LATERAL(SELECT count(*) FILTER(WHERE status='submitted') AS attempts,count(*) FILTER(WHERE status='submitted' AND passed) AS passed,coalesce(sum(score) FILTER(WHERE status='submitted'),0)::numeric AS score_total FROM learning_induction_attempts WHERE enrollment_id=l.id) q
   WHERE ${people} AND (l.created_at AT TIME ZONE 'Asia/Qatar')::date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['enrollments','completions','overdue','expired_certificates','submitted_quizzes','passed_quizzes'];result.definition='Enrollment cohort created during the period. Completion, expiry and submitted internal quiz attempts reflect current saved records; score averages count submitted attempts.';
  result.notes=['Expired/in-progress quiz attempts do not inflate scores. Multiple attempts count separately. Completing an internal awareness course does not establish an external professional qualification.'];
 }else if(kind==='helpdesk'){
  const access=reportHelpdeskScope(user);
  rows=(await tx.execute(sql`SELECT to_char(h.created_at AT TIME ZONE 'Asia/Qatar','YYYY-MM') AS month,h.category,h.status,count(*)::int AS cases,
   count(*) FILTER(WHERE h.first_response_due_at IS NOT NULL)::int AS response_targets,
   count(*) FILTER(WHERE h.first_response_due_at IS NOT NULL AND coalesce(h.first_responded_at,now())>h.first_response_due_at)::int AS response_breaches,
   count(*) FILTER(WHERE h.resolution_due_at IS NOT NULL)::int AS resolution_targets,
   count(*) FILTER(WHERE h.resolution_due_at IS NOT NULL AND coalesce(h.resolved_at,now())>h.resolution_due_at)::int AS resolution_breaches,
   round(avg(extract(epoch FROM h.resolved_at-h.created_at)/3600) FILTER(WHERE h.resolved_at>=h.created_at),2)::float8 AS average_elapsed_resolution_hours
   FROM helpdesk_cases h LEFT JOIN users u ON u.id=h.requester_id WHERE (${access}) AND (${!f.department} OR u.department=${f.department}) AND (h.created_at AT TIME ZONE 'Asia/Qatar')::date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 5001`)).rows;
  totals=['cases','response_targets','response_breaches','resolution_targets','resolution_breaches'];result.definition='Cases created in the period that the requester is currently authorized to view. Breaches compare saved SLA deadlines against the response/resolution timestamp or current time.';
  result.notes=['Resolution duration is elapsed clock hours, not business hours. Deadline targets already reflect their saved policy. No case titles, message text, attachments or employee identity is exported.'];
 }else if(kind==='performance'){
  rows=(await tx.execute(sql`SELECT c.name AS cycle,e.department,a.status,count(*)::int AS assessments,count(*) FILTER(WHERE a.published_at IS NOT NULL AND a.final_rating IS NOT NULL)::int AS published_samples,
   CASE WHEN count(*) FILTER(WHERE a.published_at IS NOT NULL AND a.final_rating IS NOT NULL)>=${settings.minimumPerformanceSample} THEN round(avg(a.final_rating) FILTER(WHERE a.published_at IS NOT NULL),2)::float8 ELSE NULL END AS average_published_rating,
   count(*) FILTER(WHERE a.acknowledged_at IS NOT NULL)::int AS acknowledgements,count(*) FILTER(WHERE a.published_at IS NULL AND a.status<>'cancelled' AND a.due_date<${day}::date)::int AS overdue
   FROM performance_assessments a JOIN performance_cycles c ON c.id=a.cycle_id JOIN employees e ON e.id=a.employee_id WHERE ${people} AND c.period_end BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY c.id,c.name,e.department,a.status ORDER BY c.id,e.department,a.status LIMIT 5001`)).rows;
  totals=['assessments','published_samples','acknowledgements','overdue'];result.definition='Review cycles whose period end falls in the selected range. Only published final ratings contribute to averages, separately for each cycle.';
  result.notes=[`Averages with fewer than ${settings.minimumPerformanceSample} published samples are suppressed. Different cycle rubrics are never merged into one rating. Comments, draft scores and individual rankings are excluded.`];
 }else if(kind==='expenses'||kind==='benefits'){
  rows=(await tx.execute(sql`SELECT to_char(r.request_date,'YYYY-MM') AS month,e.department,r.policy_key AS program,coalesce(r.policy_snapshot->'config'->>'unit','UNSPECIFIED') AS unit,r.status,count(*)::int AS requests,sum(r.amount)::text AS amount,
   count(*) FILTER(WHERE r.status='fulfilled')::int AS fulfilled_requests
   FROM service_requests r JOIN employees e ON e.id=r.employee_id WHERE r.kind=${kind==='expenses'?'expense':'benefit'} AND ${people} AND r.request_date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5 LIMIT 5001`)).rows;
  totals=['requests','fulfilled_requests'];result.definition='Saved request amounts by request date, current department, program, saved currency/unit and workflow status.';
  result.notes=['Amounts in different units/currencies and statuses are not added together. Fulfilled means a fulfilment reference is recorded; it is not proof of bank settlement. Request descriptions, receipts and payment references are excluded.'];
 }else if(kind==='equipment'){
  rows=(await tx.execute(sql`SELECT e.department,coalesce(a.asset_snapshot->>'category','Unspecified') AS category,a.status,a.acknowledgement,count(*)::int AS assignments,
   count(*) FILTER(WHERE a.status IN ('issued','return_requested') AND a.due_on<${day}::date)::int AS overdue_returns,
   count(*) FILTER(WHERE a.status IN ('issued','return_requested') AND a.acknowledgement='pending' AND a.acknowledgement_due_on<${day}::date)::int AS overdue_acknowledgements
   FROM hr_equipment_assignments a JOIN employees e ON e.id=a.employee_id WHERE ${people} GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['assignments','overdue_returns','overdue_acknowledgements'];result.definition='Current equipment custody assignments and their saved categories, return state and acknowledgement state. Overdue counts use the Qatar calendar date.';
  result.notes=['Unassigned assets are not employee custody records and are excluded. Asset serial numbers and employee notes are not exported.'];
 }else if(kind==='handbook'){
  rows=(await tx.execute(sql`SELECT e.department,d.title AS edition,a.status,count(*)::int AS assignments,count(*) FILTER(WHERE a.required)::int AS required_assignments,
   count(*) FILTER(WHERE a.read_at IS NOT NULL)::int AS read_receipts,count(*) FILTER(WHERE a.status='acknowledged')::int AS acknowledged,count(*) FILTER(WHERE a.status='pending' AND a.due_date<${day}::date)::int AS overdue
   FROM hr_handbook_assignments a JOIN hr_handbook_editions d ON d.id=a.edition_id JOIN employees e ON e.id=a.employee_id WHERE ${people} GROUP BY e.department,d.id,d.title,a.status ORDER BY e.department,d.id,a.status LIMIT 5001`)).rows;
  totals=['assignments','required_assignments','read_receipts','acknowledged','overdue'];result.definition='Current handbook assignments by immutable edition and current status, including superseded/withdrawn assignments separately.';
 }else if(kind==='communications'){
  rows=(await tx.execute(sql`SELECT b.id AS announcement_id,b.title,b.audience,b.status,b.requires_acknowledgement::text AS acknowledgement_required,
   (SELECT count(*)::int FROM comm_bulletin_receipts r WHERE r.bulletin_id=b.id) AS read_receipts,
   (SELECT count(*)::int FROM comm_bulletin_receipts r WHERE r.bulletin_id=b.id AND r.acknowledged_at IS NOT NULL) AS acknowledgements
   FROM comm_bulletins b WHERE b.status<>'draft' AND (b.publish_at AT TIME ZONE 'Asia/Qatar')::date BETWEEN ${f.from}::date AND ${f.to}::date AND
   ((${commAdmin(user.role)} OR b.author_id=${user.userId}) AND ((b.audience<>'channel' AND (${commPublisher(user.role)} OR (${user.role==='hr_manager'} AND b.audience='department' AND b.target=${user.department||''} AND ${!!user.department}))) OR (b.audience='channel' AND EXISTS(SELECT 1 FROM comm_channels c WHERE c.id::text=b.target AND c.archived_at IS NULL AND ${channelScope(sql`${user.userId}`,user.role)} AND (${channelManage(user.userId,user.role)})))))
   ORDER BY b.publish_at DESC,b.id DESC LIMIT 5001`)).rows;
  totals=['read_receipts','acknowledgements'];result.summary.announcements=rows.length;result.definition='Published or archived notices that you authored or currently administer, grouped by notice and scheduled publication date. Counts are explicit saved receipts.';
  result.notes=['Private conversation content and message activity are excluded. Recipient populations change over time; acknowledgement coverage percentages are not invented from today’s workforce.'];
 }else if(kind==='qualifications'){
  rows=(await tx.execute(sql`SELECT e.department,q.name AS qualification,CASE WHEN c.revoked_at IS NOT NULL THEN 'revoked' WHEN c.valid_from>${day}::date THEN 'not_yet_valid' WHEN c.valid_through<${day}::date THEN 'expired' ELSE 'valid' END AS status,count(*)::int AS credentials
   FROM employee_qualifications c JOIN workforce_qualifications q ON q.id=c.qualification_id JOIN employees e ON e.id=c.employee_id WHERE ${people} GROUP BY 1,2,3 ORDER BY 1,2,3 LIMIT 5001`)).rows;
  totals=['credentials'];result.definition='Recorded verified qualifications by current validity and revocation state as of the Qatar date. Counts credential records, including earlier renewals; it does not infer unrecorded qualifications.';
 }else if(kind==='employment'){
  rows=(await tx.execute(sql`SELECT to_char(c.effective_date,'YYYY-MM') AS month,e.department,c.kind,c.status,count(*)::int AS changes,count(*) FILTER(WHERE c.status='approved' AND c.effective_date<=${day}::date)::int AS awaiting_application
   FROM employment_changes c JOIN employees e ON e.id=c.employee_id WHERE ${people} AND c.effective_date BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1,2,3,4 ORDER BY 1,2,3,4 LIMIT 5001`)).rows;
  totals=['changes','awaiting_application'];result.definition='Employment change proposals by effective date, current employee department, kind and recorded review/application state. Approved does not imply applied.';
 }else if(kind==='quality'){
  rows=(await tx.execute(sql`SELECT e.department,e.type::text AS employee_type,count(*)::int AS employees,
   count(*) FILTER(WHERE e.user_id IS NULL)::int AS unlinked_accounts,count(*) FILTER(WHERE e.reporting_manager_id IS NULL)::int AS missing_manager,
   count(*) FILTER(WHERE trim(coalesce(e.department,''))='')::int AS missing_department,count(*) FILTER(WHERE trim(coalesce(e.location,''))='')::int AS missing_location,
   count(*) FILTER(WHERE e.status='active' AND e.termination_date<=${day}::date)::int AS status_date_conflicts,
   count(*) FILTER(WHERE e.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=e.user_id AND u.is_active AND u.approval_status='approved'))::int AS unavailable_linked_accounts
   FROM employees e WHERE ${people} GROUP BY 1,2 ORDER BY 1,2 LIMIT 5001`)).rows;
  totals=['employees','unlinked_accounts','missing_manager','missing_department','missing_location','status_date_conflicts','unavailable_linked_accounts'];result.definition='Current employee record completeness indicators. Counts are independent and may overlap; missing manager/account may be intentional for some roles.';
  result.notes=['No personal contact, identity, medical or bank details are included. This report identifies fields to review and does not automatically change employee records.'];
 }else throw new Error('Unknown report catalogue entry');
 result.rows=rows;result.columns=columns(rows.length?Object.keys(rows[0]):emptyColumns[kind]||[]);
 Object.assign(result.summary,Object.fromEntries(totals.map(key=>[key,sum(rows,key)])));
 return result;
}
const emptyColumns:Partial<Record<ReportInput['kind'],string[]>>={attendance:['month','department','status','approval_status','records','open_sessions','recorded_work_minutes','recorded_overtime_minutes','eligible_work_minutes'],payroll:['month','department','currency','status','records','basic_amount','net_amount','allowance_amount','deduction_amount','legacy_without_review'],recruitment:['month','department','job_title','status','applications','offers','accepted_offers','hiring_samples','average_days_to_accept'],lifecycle:['month','department','kind','status','cases','tasks','completed_tasks','overdue_tasks'],learning:['month','department','course','status','enrollments','completions','overdue','expired_certificates','submitted_quizzes','passed_quizzes','average_quiz_score'],helpdesk:['month','category','status','cases','response_targets','response_breaches','resolution_targets','resolution_breaches','average_elapsed_resolution_hours'],performance:['cycle','department','status','assessments','published_samples','average_published_rating','acknowledgements','overdue'],expenses:['month','department','program','unit','status','requests','amount','fulfilled_requests'],benefits:['month','department','program','unit','status','requests','amount','fulfilled_requests'],equipment:['department','category','status','acknowledgement','assignments','overdue_returns','overdue_acknowledgements'],handbook:['department','edition','status','assignments','required_assignments','read_receipts','acknowledged','overdue'],communications:['announcement_id','title','audience','status','acknowledgement_required','read_receipts','acknowledgements'],qualifications:['department','qualification','status','credentials'],employment:['month','department','kind','status','changes','awaiting_application'],quality:['department','employee_type','employees','unlinked_accounts','missing_manager','missing_department','missing_location','status_date_conflicts','unavailable_linked_accounts']};
