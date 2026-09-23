import {createHash} from 'node:crypto';
import {and,eq,gte,lt,inArray,sql} from 'drizzle-orm';
import {appSettings,employees,payroll,payrollReviews,payrollTimeLines,workforceMembers,workforceTeams,workforceSites} from '@shared/schema';
import {getAccessScope,hasPermission} from '@shared/permissions';
import {defaultWpsSettings,wpsSettingsSchema,wpsEmployeeSchema,wpsRecordSchema,employeeIssues,recordIssues,settingsIssues,sumMoney,type ExportFilter,type ExportGroup,type PayrollExportPreview,type PayrollExportRow,type WpsEmployee,type WpsRecord,type WpsSettings} from '@shared/payroll-exports';
import {moneyCents,moneyText} from '@shared/money';
import type {TokenPayload} from './auth';
import {employeeScope} from './access';
import {fail,type WorkforceTransaction} from './workforce';

export const exportLimit=500;
export const wpsSettingsKey='payroll_wps_settings';
export const profileKey=(id:number)=>`payroll_wps_employee:${id}`;
export const recordKey=(id:number)=>`payroll_wps_record:${id}`;
export const exportKey=(id:number)=>`payroll_wps_export:${id}`;
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function canManageWps(user:TokenPayload){return hasPermission(user.role,'payroll_management','update')&&!['self','none'].includes(getAccessScope(user.role,'payroll_management'));}
export function canConfigureWps(user:TokenPayload){return ['admin','super_admin'].includes(user.role);}
export async function getWpsSettings(tx:WorkforceTransaction){
  const [row]=await tx.select().from(appSettings).where(eq(appSettings.key,wpsSettingsKey));
  const saved=row?.value as {version:number;settings:WpsSettings}|undefined;
  const settings=saved?wpsSettingsSchema.parse(saved.settings):structuredClone(defaultWpsSettings);
  return {version:saved?.version||0,settings,issues:settingsIssues(settings)};
}
function amounts(value:unknown):Record<string,string>{return Object.fromEntries(Object.entries((value||{}) as Record<string,string>).map(([key,value])=>[key,moneyText(moneyCents(value))]));}
function defaultRecord(record:typeof payroll.$inferSelect,review:typeof payrollReviews.$inferSelect|null,extraMinutes:number){
  const policy=review?.policy as {rules?:Record<string,{config?:{basis?:string;basicSalary?:string}}>}|undefined;
  const rules=Object.values(policy?.rules||{});
  const monthly=rules.length>0&&rules.every(r=>r?.config?.basis==='salary');
  const basics=[...new Set(rules.map(r=>r?.config?.basicSalary))];
  const contracted=monthly&&basics.length===1&&basics[0]?basics[0]:null;
  const basic=contracted||record.basicSalary;
  const proration=moneyCents(basic)-moneyCents(record.basicSalary);
  const extra=sumMoney(amounts(record.allowances))+Math.max(0,-proration)+Math.max(0,record.roundingAdjustmentCents);
  const deductions=sumMoney(amounts(record.deductions))+Math.max(0,proration)+Math.max(0,-record.roundingAdjustmentCents);
  const warnings:string[]=[];
  if(!contracted)warnings.push('Confirm the contractual monthly basic salary; this payroll does not contain one consistent monthly rate.');
  if(proration)warnings.push('Contractual basic differs from paid basic. The WPS reconciliation includes that difference; review the proposed figures.');
  const value:WpsRecord={basic:moneyText(moneyCents(basic)),extraIncome:moneyText(extra),deductions:moneyText(deductions),extraHours:(extraMinutes/60).toFixed(2),workingDays:null,deductionReason:'',paymentType:'Normal Payment',notes:proration?'Contractual and paid basic differ for this payroll period.':''};
  return {value,warnings,requiresReview:!contracted||proration!==0};
}

export async function loadPayrollExport(tx:WorkforceTransaction,user:TokenPayload,filter:ExportFilter):Promise<PayrollExportPreview>{
  if(!hasPermission(user.role,'payroll_management','read'))fail(403,'Payroll access is required.');
  const canWps=canManageWps(user),settings=canWps?await getWpsSettings(tx):null;
  const source=await tx.select({record:payroll,review:payrollReviews,employee:{id:employees.id,ref:employees.employeeId,firstName:employees.firstName,lastName:employees.lastName,department:employees.department,position:employees.position,workSchedule:employees.workSchedule,recordVersion:employees.recordVersion,...(canWps?{qid:employees.qidNumber,bankName:employees.bankName,iban:employees.ibanNumber}:{} as {qid:typeof employees.qidNumber;bankName:typeof employees.bankName;iban:typeof employees.ibanNumber})}})
    .from(payroll).innerJoin(employees,eq(payroll.employeeId,employees.id)).leftJoin(payrollReviews,eq(payrollReviews.payrollId,payroll.id))
    .where(and(eq(payroll.month,filter.month),eq(payroll.year,filter.year),employeeScope(user,'payroll_management'))).orderBy(employees.id,payroll.id).limit(5001);
  if(source.length>5000)fail(409,'This payment month exceeds 5,000 payroll records. Use a narrower payroll period.');
  const employeeIds=source.map(r=>r.employee.id),ids=source.map(r=>r.record.id);
  const periodFallback={start:`${filter.year}-${String(filter.month).padStart(2,'0')}-01`,end:new Date(Date.UTC(filter.year,filter.month,0)).toISOString().slice(0,10)};
  const starts=source.map(r=>r.review?.periodStart||periodFallback.start),ends=source.map(r=>r.review?.periodEnd||periodFallback.end);
  const min=starts.sort()[0]||periodFallback.start,max=ends.sort().at(-1)||periodFallback.end;
  // Membership uses each site's calendar and each saved pay period, not today's roster.
  const memberships=employeeIds.length?await tx.select({employeeId:workforceMembers.employeeId,startAt:workforceMembers.startAt,endAt:workforceMembers.endAt,timezone:workforceSites.timezone,id:workforceTeams.id,name:workforceTeams.name,kind:workforceTeams.kind,siteId:workforceSites.id,siteName:workforceSites.name}).from(workforceMembers).innerJoin(workforceTeams,eq(workforceTeams.id,workforceMembers.teamId)).innerJoin(workforceSites,eq(workforceSites.id,workforceTeams.siteId)).where(and(inArray(workforceMembers.employeeId,employeeIds),lt(workforceMembers.startAt,new Date(Date.parse(max)+2*86400000)),gte(workforceMembers.endAt,new Date(Date.parse(min)-86400000)))):[];
  const keys=canWps?[...employeeIds.map(profileKey),...ids.flatMap(id=>[recordKey(id),exportKey(id)])]:[];
  const saved=keys.length?await tx.select().from(appSettings).where(inArray(appSettings.key,keys)):[];
  const values=new Map(saved.map(r=>[r.key,r.value]));
  const minutes=canWps&&ids.length?await tx.select({id:payrollTimeLines.payrollId,minutes:sql<number>`sum(${payrollTimeLines.overtimeMinutes})`}).from(payrollTimeLines).where(inArray(payrollTimeLines.payrollId,ids)).groupBy(payrollTimeLines.payrollId):[];
  const overtime=new Map(minutes.map(r=>[r.id,Number(r.minutes)]));
  const membershipsByEmployee=new Map<number,typeof memberships>();
  for(const member of memberships){const list=membershipsByEmployee.get(member.employeeId)||[];list.push(member);membershipsByEmployee.set(member.employeeId,list);}
  const dateFormatters=new Map<string,Intl.DateTimeFormat>();
  function localDay(value:Date,zone:string){let fmt=dateFormatters.get(zone);if(!fmt){fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});dateFormatters.set(zone,fmt);}return fmt.format(value);}
  const teams=new Map<number,ExportGroup>();
  const rows:PayrollExportRow[]=source.map(({record,review,employee})=>{
    const start=review?.periodStart||periodFallback.start,end=review?.periodEnd||periodFallback.end;
    const active=(membershipsByEmployee.get(employee.id)||[]).filter(m=>localDay(m.startAt,m.timezone)<=end&&localDay(new Date(+m.endAt-1),m.timezone)>=start);
    const groups=[...new Map(active.map(m=>[m.id,{id:m.id,name:m.name,kind:m.kind,siteId:m.siteId,siteName:m.siteName}])).values()];
    groups.forEach(g=>teams.set(g.id,g));
    const historical=review?.policy as {employee?:{name?:string;employeeId?:string;department?:string;position?:string}}|undefined;
    const officeCalendar=record.calculationSnapshot?record.calculationSnapshot.scope==='management_office':employee.workSchedule==='management_office';
    const row:PayrollExportRow={id:record.id,employeeId:employee.id,employeeRef:historical?.employee?.employeeId||employee.ref,name:historical?.employee?.name||`${employee.firstName} ${employee.lastName}`,department:historical?.employee?.department||employee.department,position:historical?.employee?.position||employee.position,status:record.status,currency:review?.currency||null,periodStart:review?.periodStart||null,periodEnd:review?.periodEnd||null,payDate:review?.payDate||null,basic:record.basicSalary,allowances:amounts(record.allowances),deductions:amounts(record.deductions),roundingCents:record.roundingAdjustmentCents,net:record.netSalary,paymentReference:record.wpsReference,groups,headOffice:groups.some(g=>g.kind==='head_office')||officeCalendar,fingerprint:''};
    if(canWps&&settings){
      const profile=values.get(profileKey(employee.id)) as {version:number;employee:WpsEmployee}|undefined;
      const detail=values.get(recordKey(record.id)) as {version:number;sourceVersion:number;record:WpsRecord}|undefined;
      const lastExport=values.get(exportKey(record.id)) as {filename:string;at:string}|undefined;
      const bank=settings.settings.bankMappings.find(m=>m.name.toLowerCase()===(employee.bankName||'').trim().toLowerCase())?.code||(/^[A-Z]{2,4}$/.test(employee.bankName||'')?employee.bankName!:'');
      const person=profile?wpsEmployeeSchema.parse(profile.employee):{name:`${employee.firstName} ${employee.lastName}`,qid:employee.qid||'',visaId:'',bank,account:(employee.iban||'').replace(/\s/g,'').toUpperCase()};
      const defaults=defaultRecord(record,review,overtime.get(record.id)||0);
      const details=detail?wpsRecordSchema.parse(detail.record):defaults.value;
      const issues=[...employeeIssues(person,settings.settings),...recordIssues(details,row.net)];
      if(record.status!=='approved')issues.push(record.status==='processed'?'Payment is already recorded. WPS exports include approved, unpaid payroll only.':'Approve this payroll before creating a WPS file.');
      if(!review||!review.approvedAt||!review.approvedBy)issues.push('An independently reviewed payroll snapshot is required.');
      if(review?.currency!=='QAR')issues.push('Qatar WPS supports QAR payroll only.');
      if(detail&&detail.sourceVersion!==review?.version)issues.push('Payroll changed since WPS details were reviewed. Review and save the WPS details again.');
      if(!detail&&defaults.requiresReview)issues.push('Review and save WPS figures to confirm the contractual basic and reconciliation.');
      if(!wpsRecordSchema.safeParse(details).success)issues.push('WPS hours or amounts exceed the supported file limits.');
      const mapped=(labels:string[])=>labels.length?moneyText(labels.reduce((sum,label)=>sum+moneyCents(row.allowances[label]||'0'),0)):'';
      row.wps={employee:person,employeeVersion:profile?.version||0,record:details,recordVersion:detail?.version||0,issues,warnings:defaults.warnings,lastExport:lastExport||null,breakdown:{housing:mapped(settings.settings.housingLabels),food:mapped(settings.settings.foodLabels),transport:mapped(settings.settings.transportLabels),overtime:mapped(settings.settings.overtimeLabels)}};
    }
    row.fingerprint=fingerprint({record,review,employeeVersion:employee.recordVersion,groups,wps:row.wps,settingsVersion:settings?.version});
    return row;
  });
  return {rows:rows.filter(r=>(filter.kind==='all'||filter.kind==='head_office'&&r.headOffice||filter.kind==='unassigned'&&!r.groups.length&&!r.headOffice||r.groups.some(g=>g.kind===filter.kind))&&(!filter.teamId||r.groups.some(g=>g.id===filter.teamId))&&(!filter.siteId||r.groups.some(g=>g.siteId===filter.siteId))),teams:[...teams.values()].sort((a,b)=>a.name.localeCompare(b.name)),canWps,canConfigure:canConfigureWps(user),settingsVersion:settings?.version||0,settingsIssues:settings?.issues||[],settings:settings?.settings||null,totalBeforeFilter:rows.length,limit:exportLimit};
}

export async function saveVersionedSetting(tx:WorkforceTransaction,key:string,expectedVersion:number,value:Record<string,unknown>){
  // Serialize creation as well as updates; absent settings cannot be row-locked.
  await tx.execute(sql`select pg_advisory_xact_lock(19283023)`);
  const [existing]=await tx.select().from(appSettings).where(eq(appSettings.key,key)).for('update');
  const version=Number((existing?.value as {version?:number}|undefined)?.version||0);
  if(version!==expectedVersion)fail(409,'These settings changed. Reload them before saving.');
  await tx.insert(appSettings).values({key,value:{...value,version:version+1}}).onConflictDoUpdate({target:appSettings.key,set:{value:{...value,version:version+1},updatedAt:new Date()}});
  return version+1;
}
