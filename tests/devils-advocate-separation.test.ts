import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {qatarToday} from '../server/services/workflowRecords';
import {PGlite} from '@electric-sql/pglite';
import {drizzle} from 'drizzle-orm/pglite';
import express from 'express';
import bcrypt from 'bcryptjs';
import * as schema from '../shared/schema';
import {blankSeparation,defaultSeparationPolicy} from '../shared/separation';
import {seedCompensation} from './helpers/compensation';
const ctx=vi.hoisted(()=>({db:null as any}));
vi.mock('../server/db',()=>({get db(){return ctx.db},pool:{}}));
import router from '../server/routes/separation';
import {authService} from '../server/services/auth';
import {settlementSnapshot,fingerprint} from '../server/services/separation';
import {eq} from 'drizzle-orm';
import contractRouter from '../server/routes/contracts';
import {blankDraft} from '../shared/contracts';
import payrollRouter from '../server/routes/payroll';
import compensationRouter from '../server/routes/compensation';
let pg:PGlite,server:any,base:string,token:string,reviewerToken:string,caseA:number,caseB:number;
async function request(path:string,body?:unknown){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};}
beforeAll(async()=>{
 process.env.JWT_SECRET='isolated-audit-access-secret-at-least-32-chars';process.env.JWT_REFRESH_SECRET='isolated-audit-refresh-secret-at-least-32-chars';
 pg=new PGlite();for(const f of readdirSync(new URL('../migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));ctx.db=drizzle(pg);
 const password='IsolatedAudit2026!';const [u]=await ctx.db.insert(schema.users).values({username:'audit-local',email:'audit@example.test',password:await bcrypt.hash(password,4),firstName:'Audit',lastName:'Only',role:'super_admin',department:'Operations',isActive:true,approvalStatus:'approved'}).returning();token=(await authService.login(u.username,password)).accessToken;
 const [reviewer]=await ctx.db.insert(schema.users).values({username:'audit-reviewer',email:'reviewer@example.test',password:await bcrypt.hash(password,4),firstName:'Reviewer',lastName:'Only',role:'super_admin',department:'Operations',isActive:true,approvalStatus:'approved'}).returning();reviewerToken=(await authService.login(reviewer.username,password)).accessToken;
 const app=express();app.use(express.json());app.use('/cases',router);app.use('/contracts',contractRouter);app.use('/payroll',payrollRouter);app.use('/compensation',compensationRouter);server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
 for(const n of ['A','B']){
  const [e]=await ctx.db.insert(schema.employees).values({employeeId:'ISOLATED-'+n,firstName:'Synthetic',lastName:n,gender:'female',dateOfBirth:'1990-01-01',nationality:'Test',qidNumber:'ISOLATED-'+n,primaryMobile:'00000000',residentialAddress:'Test',emergencyContactName:'Test',emergencyContactNumber:'00000000',department:'Operations',position:'Host',location:'Test',type:'permanent',joiningDate:'2020-01-01'}).returning();
  await seedCompensation(ctx.db,e.id,u.id);
  const input={...blankSeparation(defaultSeparationPolicy,'2026-09-25'),noticeDate:'2026-07-25',reason:'Isolated test only',reasonAr:'اختبار فقط',employeeNameAr:'اختبار',companyNameAr:'اختبار',positionAr:'اختبار',reconciliationNote:'Synthetic zero balances'};
  const created=await request('/cases',{employeeId:e.id,input,submissionKey:randomUUID()});expect(created.status,JSON.stringify(created.body)).toBe(201);if(n==='A')caseA=created.body.id;else caseB=created.body.id;
 }
});
afterAll(async()=>{if(server)await new Promise<void>(r=>server.close(()=>r()));if(pg)await pg.close();});
test('requesting the second separation must return the second case',async()=>{const result=await request('/cases/'+caseB);expect(result.status).toBe(200);expect(result.body.id).toBe(caseB);});
test('a nonexistent separation must return 404',async()=>{expect((await request('/cases/999999')).status).toBe(404);});
test('submitting case B must leave case A in draft',async()=>{
 const result=await request('/cases/'+caseB+'/submit',{version:1,reason:'Isolated audit submission',confirmed:true});expect(result.status,JSON.stringify(result.body)).toBe(200);
 const rows=(await pg.query<{id:number,status:string}>('SELECT id,status FROM employee_separations ORDER BY id')).rows;
 expect(rows.find(r=>r.id===caseA)?.status).toBe('draft');expect(rows.find(r=>r.id===caseB)?.status).toBe('in_review');
});
test('preparer cannot approve own submitted settlement',async()=>{const result=await request('/cases/'+caseB+'/approve',{version:2,reason:'Isolated review',confirmed:true});expect(result.status).toBe(403);});
test('independent reviewer can approve and complete the synthetic settlement',async()=>{
 const preparerToken=token;token=reviewerToken;
 try{
  const approved=await request('/cases/'+caseB+'/approve',{version:2,reason:'Independent synthetic review',confirmed:true});expect(approved.status,JSON.stringify(approved.body)).toBe(200);
  const completed=await request('/cases/'+caseB+'/complete',{version:3,reason:'Synthetic exit completion',confirmed:true});expect(completed.status,JSON.stringify(completed.body)).toBe(200);
  const row=(await request('/cases/'+caseB)).body;expect(row.status).toBe('completed');
  const employee=(await pg.query<{status:string}>('SELECT status FROM employees WHERE employee_id=\'ISOLATED-B\'')).rows[0];expect(employee.status).toBe('inactive');
 }finally{token=preparerToken;}
});
test('completion is final and a duplicate request cannot change the case',async()=>{const result=await request('/cases/'+caseB+'/complete',{version:4,reason:'Retry synthetic completion',confirmed:true});expect(result.status).toBe(409);const row=(await request('/cases/'+caseB)).body;expect(row.status).toBe('completed');expect(row.version).toBe(4);});
test('JSONB key ordering changes the completion fingerprint despite identical values',async()=>{
 const row=(await request('/cases/'+caseB)).body;const [e]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.id,row.employee_id));const current=await settlementSnapshot(ctx.db,e,row.input,row.snapshot.policy);
 const financial=(s:any)=>({service:{start:s.service.start,end:s.service.end,days:s.service.days,years:s.service.years,eligible:s.service.eligible,continuityPolicyVersion:s.service.continuityPolicyVersion,bridgedDays:s.service.bridgedDays},notice:s.notice,basicCents:s.basicCents,currency:s.currency,compensationId:s.compensationId,lines:s.lines});
 expect(financial(current)).toEqual(financial(row.snapshot));
 expect(fingerprint(financial(current))).not.toBe(fingerprint(financial(row.snapshot)));
});
test('synthetic contract can be sent, signed by its recipient, and rejects repeat signing',async()=>{
 const password='SyntheticSigner2026!';const [u]=await ctx.db.insert(schema.users).values({username:'audit-signer',email:'signer@example.test',password:await bcrypt.hash(password,4),firstName:'Signer',lastName:'Only',role:'permanent_employee',department:'Operations',isActive:true,approvalStatus:'approved'}).returning();
 const [employee]=await ctx.db.update(schema.employees).set({userId:u.id}).where(eq(schema.employees.employeeId,'ISOLATED-A')).returning();
 const document={...blankDraft(),position:'Synthetic host',schedule:'Synthetic hours',compensation:'Synthetic QAR 1000',startDate:'2020-01-01',employeeNameAr:'اختبار',companyNameAr:'اختبار',companyAddressAr:'اختبار',arabic:{title:'عقد اختبار',position:'اختبار',department:'',location:'',schedule:'اختبار',compensation:'اختبار'},clauses:[{title:'Test only',body:'Synthetic local test only',titleAr:'اختبار',bodyAr:'اختبار فقط'}]};
 const created=await request('/contracts',{employeeId:employee.id,document,submissionKey:randomUUID()});expect(created.status,JSON.stringify(created.body)).toBe(201);
 const path='/contracts/'+created.body.id;const sent=await request(path+'/send',{version:1,confirmed:true});expect(sent.status,JSON.stringify(sent.body)).toBe(200);
 const preparerToken=token;token=(await authService.login(u.username,password)).accessToken;
 try{const row=(await request(path)).body;expect(row.canSign).toBe(true);const signature={version:2,contentHash:row.content_hash,signature:{name:'Synthetic signer',consent:true,strokes:[]},currentPassword:password};const signed=await request(path+'/sign',signature);expect(signed.status,JSON.stringify(signed.body)).toBe(200);expect((await request(path)).body.status).toBe('signed');expect((await request(path+'/sign',signature)).status).toBe(409);}finally{token=preparerToken;}
});
test('policy publication requires independent review and preserves the active policy until approval',async()=>{
 const response=await fetch(base+'/cases/policy',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:0,definition:{...defaultSeparationPolicy,daysPerYear:28},reason:'Synthetic policy proposal',effectiveFrom:qatarToday(),legalBasis:'Synthetic applicability review for isolated tests only',confirmed:true})});
 const proposed=await response.json();expect(response.status,JSON.stringify(proposed)).toBe(200);
 expect((await request('/cases/policy')).body.daysPerYear).toBe(21);
 expect((await request(`/cases/policy-proposals/${proposed.id}/approve`,{version:1,reason:'Cannot approve own policy',confirmed:true})).status).toBe(403);
 const original=token;token=reviewerToken;
 try{const accepted=await request(`/cases/policy-proposals/${proposed.id}/approve`,{version:1,reason:'Independent reviewed applicability',confirmed:true});expect(accepted.status,JSON.stringify(accepted.body)).toBe(200);}finally{token=original;}
 expect((await request('/cases/policy')).body.daysPerYear).toBe(28);
 await expect(pg.exec('UPDATE separation_policies SET definition=\'{}\'::jsonb')).rejects.toThrow();
});

test('reconciliation pins source balances and rejects changed leave before independent approval',async()=>{
 const row=(await request('/cases/'+caseA)).body;
 const before=await request(`/cases/${caseA}/reconciliation`);expect(before.status).toBe(200);expect(before.body.changed).toBe(false);
 const submitted=await request(`/cases/${caseA}/submit`,{version:row.version,reason:'Review source balances',confirmed:true});expect(submitted.status,JSON.stringify(submitted.body)).toBe(200);
 await ctx.db.insert(schema.leaveLedger).values({employeeId:row.employee_id,leaveType:'annual',year:2026,units:250,sourceKey:'audit-reconciliation-credit',reason:'Synthetic new credit'});
 const changed=await request(`/cases/${caseA}/reconciliation`);expect(changed.body.changed).toBe(true);expect(changed.body.current.leave[0].availableDays).toBe(2.5);expect(changed.body.reviewed.leave).toHaveLength(0);
 const original=token;token=reviewerToken;
 try{const refused=await request(`/cases/${caseA}/approve`,{version:row.version+1,reason:'Stale source review',confirmed:true});expect(refused.status).toBe(409);expect(refused.body.message).toContain('Payroll or leave');}finally{token=original;}
 const signer=await authService.login('audit-signer','SyntheticSigner2026!');token=signer.accessToken;
 try{expect((await request(`/cases/${caseA}/reconciliation`)).status).toBe(403);}finally{token=original;}
});

test('settlement payment binds payroll and leave, rejects stale/self review, and records exactly once',async()=>{
 const original=token,priorMode=process.env.APP_DATA_MODE;process.env.APP_DATA_MODE='operational';
 try{
  const [preparer]=await ctx.db.select().from(schema.users).where(eq(schema.users.username,'audit-local'));
  const [reviewer]=await ctx.db.select().from(schema.users).where(eq(schema.users.username,'audit-reviewer'));
  const [template]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.employeeId,'ISOLATED-B'));
  const {id:_id,...values}=template;
  const [employee]=await ctx.db.insert(schema.employees).values({...values,employeeId:'ISOLATED-PAYMENT',qidNumber:'ISOLATED-PAYMENT',status:'active',terminationDate:null,userId:null}).returning();
  await seedCompensation(ctx.db,employee.id,preparer.id);
  const [pay]=await ctx.db.insert(schema.payroll).values({employeeId:employee.id,month:8,year:2026,basicSalary:'100.00',allowances:{},deductions:{},netSalary:'100.00',status:'approved'}).returning();
  await ctx.db.insert(schema.payrollReviews).values({payrollId:pay.id,version:1,currency:'QAR',periodStart:'2026-08-01',periodEnd:'2026-08-31',payDate:'2026-09-01',policy:{},createdBy:preparer.id,approverId:reviewer.id,approvedBy:reviewer.id,approvedAt:new Date()});
  await ctx.db.insert(schema.leaveLedger).values({employeeId:employee.id,leaveType:'annual',year:2026,units:500,sourceKey:'payment-credit',reason:'Synthetic initial balance'});
  const input={...blankSeparation(defaultSeparationPolicy,'2026-09-25'),noticeDate:'2026-07-25',reason:'Synthetic payment only',reasonAr:'اختبار',employeeNameAr:'اختبار',companyNameAr:'اختبار',positionAr:'اختبار',reconciliationNote:'One payroll and two leave days',unpaidSalary:'100.00',leaveDays:2};
  const created=await request('/cases',{employeeId:employee.id,input,submissionKey:randomUUID()});expect(created.status,JSON.stringify(created.body)).toBe(201);
  const path='/cases/'+created.body.id;
  expect((await request(path+'/submit',{version:1,reason:'Synthetic source reconciliation',confirmed:true})).status).toBe(200);
  token=reviewerToken;
  expect((await request(path+'/approve',{version:2,reason:'Independent synthetic approval',confirmed:true})).status).toBe(200);
  const completed=await request(path+'/complete',{version:3,reason:'Synthetic completion',confirmed:true});expect(completed.status,JSON.stringify(completed.body)).toBe(200);
  token=original;
  const state=await request(path+'/payment');expect(state.status,JSON.stringify(state.body)).toBe(200);
  const body={version:0,reference:'SYNTHETIC-BANK-001',paidOn:'2026-09-25',amount:(state.body.netCents/100).toFixed(2),payrollIds:[pay.id],leaveDebits:[{type:'annual',year:2026,days:2}],reason:'Synthetic receipt verified locally',confirmed:true};
  token=(await authService.login('audit-signer','SyntheticSigner2026!')).accessToken;expect((await request(path+'/payment')).status).toBe(403);token=reviewerToken;
  expect((await request(path+'/payment/propose',body)).status).toBe(409);token=original;
  expect((await request(path+'/payment/propose',{...body,amount:'1.00'})).status).toBe(400);
  expect((await request(path+'/payment/propose',{...body,payrollIds:[]})).status).toBe(400);
  expect((await request(path+'/payment/propose',{...body,leaveDebits:[]})).status).toBe(400);
  process.env.APP_DATA_MODE='demo';expect((await request(path+'/payment/propose',body)).status).toBe(409);process.env.APP_DATA_MODE='operational';
  await ctx.db.insert(schema.appSettings).values({key:'payroll_wps_export:'+pay.id,value:{filename:'SYNTHETIC-ONLY.sif',at:new Date().toISOString()}});
  const exported=await request(path+'/payment/propose',body);expect(exported.status).toBe(409);expect(exported.body.message).toContain('exported to WPS');
  await ctx.db.delete(schema.appSettings).where(eq(schema.appSettings.key,'payroll_wps_export:'+pay.id));
  const proposed=await request(path+'/payment/propose',body);expect(proposed.status,JSON.stringify(proposed.body)).toBe(200);
  expect((await request(path+'/payment/propose',body)).status).toBe(409);
  expect((await request(path+'/payment/record',{version:1,reason:'Self review forbidden',confirmed:true})).status).toBe(403);
  token=reviewerToken;
  const blocked=await request('/payroll/'+pay.id+'/mark-paid',{version:1,reference:'DUPLICATE-PAYMENT',confirmed:true});expect(blocked.status,JSON.stringify(blocked.body)).toBe(409);
  const exportBlocked=await request('/payroll/exports/download',{format:'wps',filter:{month:8,year:2026},records:[{id:pay.id,fingerprint:'0'.repeat(64)}],settingsVersion:0,confirmed:true});expect(exportBlocked.status,JSON.stringify(exportBlocked.body)).toBe(409);expect(exportBlocked.body.message).toContain('allocated');
  await ctx.db.insert(schema.leaveLedger).values({employeeId:employee.id,leaveType:'annual',year:2026,units:100,sourceKey:'payment-new-credit',reason:'Synthetic concurrent source change'});
  expect((await request(path+'/payment/record',{version:1,reason:'Stale evidence rejected',confirmed:true})).status).toBe(409);
  expect((await request(path+'/payment/reject',{version:1,reason:'Reconcile new leave credit',confirmed:true})).status).toBe(200);
  expect((await pg.query('SELECT * FROM settlement_payroll_allocations WHERE payroll_id=$1',[pay.id])).rows).toHaveLength(0);
  token=original;expect((await request(path+'/payment/propose',{...body,version:2})).status).toBe(200);
  token=reviewerToken;
  // An audit failure must roll back payroll payment and leave debits together.
  await pg.exec("CREATE FUNCTION fail_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='settlement_payment' AND NEW.snapshot->>'status'='recorded' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER payment_audit_failure BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION fail_payment_audit();");
  expect((await request(path+'/payment/record',{version:3,reason:'Synthetic failed audit',confirmed:true})).status).toBe(500);
  expect((await pg.query<{status:string}>('SELECT status FROM payroll WHERE id=$1',[pay.id])).rows[0].status).toBe('approved');
  expect((await pg.query('SELECT * FROM leave_ledger WHERE source_key LIKE $1',[`settlement:${created.body.id}:%`])).rows).toHaveLength(0);
  await pg.exec('DROP TRIGGER payment_audit_failure ON hr_workflow_history; DROP FUNCTION fail_payment_audit();');
  const recorded=await request(path+'/payment/record',{version:3,reason:'Independent receipt confirmed',confirmed:true});expect(recorded.status,JSON.stringify(recorded.body)).toBe(200);
  expect((await request(path+'/payment/record',{version:3,reason:'Duplicate retry must fail',confirmed:true})).status).toBe(409);
  const [paid]=await ctx.db.select().from(schema.payroll).where(eq(schema.payroll.id,pay.id));expect(paid.status).toBe('processed');expect(paid.wpsReference).toBe(body.reference);
  const debit=(await pg.query<{units:number}>('SELECT units FROM leave_ledger WHERE source_key=$1',[`settlement:${created.body.id}:annual:2026`])).rows;expect(debit).toEqual([{units:-200}]);
  expect((await request(path+'/payment')).body.payment.status).toBe('recorded');
  const paymentHistory=(await request(path+'/payment')).body.history;expect(paymentHistory).toHaveLength(4);expect(paymentHistory[0].reason).toBe('Independent receipt confirmed');
  await expect(pg.query('UPDATE settlement_payments SET version=version+1,reference=$1 WHERE case_id=$2',['REWRITE',created.body.id])).rejects.toThrow();
  await expect(pg.query('DELETE FROM settlement_payments WHERE case_id=$1',[created.body.id])).rejects.toThrow();
 }finally{token=original;if(priorMode===undefined)delete process.env.APP_DATA_MODE;else process.env.APP_DATA_MODE=priorMode;}
});

test('signed contract compensation requires independent scoped review, preserves history and publishes through existing payroll controls',async()=>{
 const original=token;
 try{
  const [employee]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.employeeId,'ISOLATED-A'));
  const [other]=await ctx.db.select().from(schema.employees).where(eq(schema.employees.employeeId,'ISOLATED-B'));
  const contract=(await pg.query<any>("SELECT * FROM employee_contracts WHERE employee_id=$1 AND status='signed'",[employee.id])).rows[0];
  const packageData=(await request(`/compensation/employees/${employee.id}`)).body;
  const path=`/compensation/employees/${employee.id}/contract-mappings`;
  const input={expectedVersion:packageData.latestVersion,effectiveFrom:'2026-01-01',definition:packageData.current.definition,reason:'Map signed synthetic terms exactly',contractId:contract.id,contractHash:contract.content_hash,submissionKey:randomUUID(),confirmed:true};
  token=(await authService.login('audit-signer','SyntheticSigner2026!')).accessToken;
  expect((await request(path)).status).toBe(403);expect((await request(path,input)).status).toBe(403);token=original;
  expect((await request(`/compensation/employees/${other.id}/contract-mappings`,input)).status).toBe(404);
  expect((await request(path,{...input,contractHash:'0'.repeat(64)})).status).toBe(409);
  expect((await request(path,{...input,effectiveFrom:'2019-01-01'})).status).toBe(400);
  const draft=await request('/contracts',{employeeId:employee.id,document:blankDraft(),submissionKey:randomUUID()});expect(draft.status).toBe(201);
  expect((await request(path,{...input,contractId:draft.body.id})).status).toBe(409);
  const created=await request(path,input);expect(created.status,JSON.stringify(created.body)).toBe(201);
  expect((await request(path,input)).body.id).toBe(created.body.id);
  expect((await request(path,{...input,reason:'Conflicting replay'})).status).toBe(409);
  expect((await request(path,{...input,submissionKey:randomUUID()})).status).toBe(409);
  expect((await request(path)).body.proposals[0].canReview).toBe(false);
  expect((await request(`${path}/${created.body.id}/approve`,{version:1,reason:'Cannot approve own proposal',confirmed:true})).status).toBe(403);
  const latest=await request(`/compensation/employees/${employee.id}`,{expectedVersion:input.expectedVersion,effectiveFrom:'2025-01-01',definition:input.definition,reason:'Synthetic competing package revision'});expect(latest.status).toBe(201);
  token=reviewerToken;
  const stale=await request(`${path}/${created.body.id}/approve`,{version:1,reason:'Stale mapping must not publish',confirmed:true});expect(stale.status).toBe(409);expect(stale.body.message).toContain('Compensation changed');
  expect((await request(`${path}/${created.body.id}/reject`,{version:1,reason:'Reconcile newer package before approval',confirmed:true})).status).toBe(200);
  token=original;
  const fresh=await request(path,{...input,expectedVersion:latest.body.version,submissionKey:randomUUID()});expect(fresh.status).toBe(201);
  token=reviewerToken;
  await pg.exec("CREATE FUNCTION fail_contract_mapping_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='contract_compensation' AND NEW.snapshot->>'status'='applied' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER contract_mapping_audit_failure BEFORE INSERT ON hr_workflow_history FOR EACH ROW EXECUTE FUNCTION fail_contract_mapping_audit();");
  expect((await request(`${path}/${fresh.body.id}/approve`,{version:1,reason:'Synthetic failed audit',confirmed:true})).status).toBe(500);
  expect((await request(`/compensation/employees/${employee.id}`)).body.latestVersion).toBe(latest.body.version);
  await pg.exec('DROP TRIGGER contract_mapping_audit_failure ON hr_workflow_history; DROP FUNCTION fail_contract_mapping_audit();');
  const approved=await request(`${path}/${fresh.body.id}/approve`,{version:1,reason:'Independent signed terms verified',confirmed:true});expect(approved.status,JSON.stringify(approved.body)).toBe(200);
  expect((await request(`${path}/${fresh.body.id}/approve`,{version:1,reason:'Duplicate approval cannot create another package',confirmed:true})).status).toBe(409);
  const after=(await request(`/compensation/employees/${employee.id}`)).body;expect(after.latestVersion).toBe(latest.body.version+1);expect(after.items.find((p:any)=>p.id===approved.body.packageId).definition).toEqual(input.definition);
  await expect(pg.query('UPDATE contract_compensation_proposals SET reason=$1 WHERE id=$2',['REWRITE',fresh.body.id])).rejects.toThrow();
  const mappings=(await request(path)).body;expect(mappings.proposals.find((p:any)=>p.id===created.body.id).status).toBe('rejected');expect(mappings.proposals.find((p:any)=>p.id===fresh.body.id).package_id).toBe(approved.body.packageId);
  token=original;expect((await request(path,{...input,expectedVersion:after.latestVersion,submissionKey:randomUUID()})).status).toBe(409);
  const [reviewer]=await ctx.db.select().from(schema.users).where(eq(schema.users.username,'audit-reviewer'));
  const ruleBody={expectedVersion:after.latestVersion,expectedRuleId:null,reason:'Publish independently mapped signed terms',confirmed:true,cycleStartDay:1,payDay:1,regularMinutesPerDay:480,overtimeMultiplier:1,hourlyRate:'0.00',approverId:reviewer.id};
  const linked=await request(`/compensation/employees/${employee.id}/packages/${approved.body.packageId}/payroll-rule`,ruleBody);expect(linked.status,JSON.stringify(linked.body)).toBe(201);expect(linked.body.config.basicSalary).toBe('1000.00');
  expect((await request(`/compensation/employees/${employee.id}/packages/${approved.body.packageId}/payroll-rule`,ruleBody)).status).toBe(409);
 }finally{token=original;}
});
