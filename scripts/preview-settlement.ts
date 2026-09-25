// Called only by the isolated in-memory visual preview, never by the server.
import {eq,sql} from 'drizzle-orm';
import {randomUUID} from 'node:crypto';
import {db} from '../server/db';
import {employees,users} from '../shared/schema';
import {blankSeparation,defaultSeparationPolicy} from '../shared/separation';
import {emptyCompensation} from '../shared/compensation';
import {settlementSnapshot} from '../server/services/separation';
import {settlementReconciliation} from '../server/services/separation-reconciliation';
import {blankDraft} from '../shared/contracts';
import {fingerprint} from '../server/services/separation';
export async function previewSettlement(){
 const [person]=await db.select().from(employees).where(eq(employees.employeeId,'PREVIEW-ONLY'));
 const [admin]=await db.select().from(users).where(eq(users.username,'preview_admin'));
 const [reviewer]=await db.insert(users).values({username:'preview_reviewer',email:'reviewer@example.test',password:admin.password,firstName:'Synthetic',lastName:'Reviewer',role:'super_admin',isActive:true,approvalStatus:'approved'}).returning();
 const definition=emptyCompensation();definition.items[0].amount='1000.00';
 await db.execute(sql`INSERT INTO employee_compensation_packages(employee_id,version,effective_from,definition,reason,created_by) VALUES(${person.id},1,'2020-01-01',${JSON.stringify(definition)}::jsonb,'Synthetic preview only',${admin.id})`);
 const input={...blankSeparation(defaultSeparationPolicy,'2026-09-25'),noticeDate:'2026-07-25',reason:'Synthetic preview only',reasonAr:'اختبار فقط',employeeNameAr:'موظف تجريبي',companyNameAr:'شركة تجريبية',positionAr:'دور تجريبي',reconciliationNote:'Synthetic zero balances'};
 const snapshot=await settlementSnapshot(db,person,input),sources=await settlementReconciliation(db,person.id,input.lastDay);
 await db.execute(sql`INSERT INTO employee_separations(reference,employee_id,status,version,input,snapshot,created_by,prepared_by,reviewed_by,reviewed_at,completed_by,completed_at,submission_key,reconciliation) VALUES('SYNTHETIC-PREVIEW',${person.id},'completed',4,${JSON.stringify(input)}::jsonb,${JSON.stringify(snapshot)}::jsonb,${admin.id},${admin.id},${reviewer.id},now(),${reviewer.id},now(),${randomUUID()}::uuid,${JSON.stringify(sources)}::jsonb)`);
 const [signer]=await db.insert(users).values({username:'preview_signer',email:'signer@example.test',password:admin.password,firstName:'Synthetic',lastName:'Employee',role:'permanent_employee',isActive:true,approvalStatus:'approved'}).returning();
 const document={...blankDraft(),companyName:'Synthetic company',companyAddress:'',employeeName:'Synthetic Employee',employeeReference:'PREVIEW-ONLY',employeeNameAr:'موظف تجريبي',companyNameAr:'شركة تجريبية',startDate:'2020-01-01',position:'Synthetic role',schedule:'Synthetic hours',compensation:'Synthetic monthly base QAR 1000. No other benefits.',arabic:{title:'عقد تجريبي',position:'دور تجريبي',department:'',location:'',schedule:'ساعات تجريبية',compensation:'راتب أساسي شهري تجريبي 1000 ريال قطري دون مزايا أخرى.'},clauses:[{title:'Synthetic only',body:'Local preview only',titleAr:'تجريبي فقط',bodyAr:'معاينة محلية فقط'}]};
 await db.execute(sql`INSERT INTO employee_contracts(reference,employee_id,status,version,document,content_hash,created_by,submission_key,sent_by,sent_to_user_id,sent_at,signature,signed_by,signed_at) VALUES('SYNTHETIC-CONTRACT',${person.id},'signed',3,${JSON.stringify(document)}::jsonb,${fingerprint(document)},${admin.id},${randomUUID()}::uuid,${admin.id},${signer.id},now(),${JSON.stringify({name:'Synthetic Employee',consent:true,strokes:[]})}::jsonb,${signer.id},now())`);
}
