import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {WorkflowError} from './workflowRecords';

// Deliberate field allowlists: new columns cannot silently expand disclosures.
// Never include credentials, signed file URLs, colleagues' identities or free-text notes.
export async function preparePrivacyExport(tx:any, employeeId:number) {
  const profile=(await tx.execute(sql`SELECT employee_id,first_name,last_name,full_name_arabic,gender,date_of_birth,nationality,qid_number,marital_status,religion,blood_group,primary_mobile,personal_email,residential_address,home_country_address,type,department,position,location,joining_date,contract_end_date,termination_date,work_email,work_phone,employee_category,job_grade,bank_name,iban_number,swift_code,bank_branch,account_name,status FROM employees WHERE id=${employeeId}`)).rows[0];
  if(!profile)throw new WorkflowError(404,'Employee not found');
  const payroll=(await tx.execute(sql`SELECT p.id,p.month,p.year,p.basic_salary,p.net_salary,p.status,p.wps_reference,p.processed_at,r.currency,r.period_start,r.period_end,r.pay_date FROM payroll p LEFT JOIN payroll_reviews r ON r.payroll_id=p.id WHERE p.employee_id=${employeeId} ORDER BY p.id LIMIT 10001`)).rows;
  const leave=(await tx.execute(sql`SELECT id,leave_type,start_date,end_date,total_days,status,created_at FROM leaves WHERE employee_id=${employeeId} ORDER BY id LIMIT 10001`)).rows;
  const attendance=(await tx.execute(sql`SELECT id,date,check_in,check_out,check_in_method,check_out_method,status,total_work_hours,overtime_hours,total_break_minutes,approval_status FROM attendance WHERE employee_id=${employeeId} ORDER BY id LIMIT 10001`)).rows;
  const documents=(await tx.execute(sql`SELECT id,document_type,document_number,issue_date,expiry_date,status,issue_authority FROM documents WHERE employee_id=${employeeId} ORDER BY id LIMIT 10001`)).rows;
  if([payroll,leave,attendance,documents].some(rows=>rows.length>10000))throw new WorkflowError(409,'Export exceeds 10,000 records in a category. Arrange a complete reviewed export; no truncated file was generated.');
  const content=JSON.stringify({format:'e3-personal-data-core-v1',generatedAt:new Date().toISOString(),scope:{included:['Personal and employment profile','Payroll summary records','Leave requests without free-text reasons','Attendance times without GPS or reviewer notes','Document metadata without file contents'],requiresSeparateReview:['Messages and attachments','Performance, recruitment, learning and case files','Contracts, settlement and employment history','Payroll calculation details and adjustments','Location evidence and free-text records','Emergency contacts and third-party information'],notice:'This core-record export is not a complete response to every access request. HR must review the requested scope, third-party rights and any additional disclosures before closing the request.'},profile,payroll,leave,attendance,documents},null,2);
  if(Buffer.byteLength(content,'utf8')>10*1024*1024)throw new WorkflowError(409,'Export exceeds 10 MB. Arrange a reviewed export through HR.');
  return {content,sha256:createHash('sha256').update(content).digest('hex')};
}
