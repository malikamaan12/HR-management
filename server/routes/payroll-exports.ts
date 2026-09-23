import {Router} from 'express';
import {z} from 'zod';
import {and,eq,inArray,sql} from 'drizzle-orm';
import {db} from '../db';
import {appSettings,employees,payroll,payrollReviews,payrollTimeLines,workforceTimesheets,activityLogs} from '@shared/schema';
import {exportFilterSchema,exportRequestSchema,wpsSettingsSchema,wpsEmployeeSchema,wpsRecordSchema,totalMoney} from '@shared/payroll-exports';
import {positiveId,reason} from '@shared/hr-rules';
import {handle} from './hr-rules';
import {employeeScope} from '../services/access';
import {fail} from '../services/workforce';
import {getCompanySettings} from '../services/settings';
import {canConfigureWps,canManageWps,getWpsSettings,loadPayrollExport,saveVersionedSetting,wpsSettingsKey,profileKey,recordKey,exportKey,fingerprint} from '../services/payroll-exports';
import {payslipDocument,payrollCsv,sifFile} from '../services/payroll-export-files';
import {assertUnpaidLeaveUnchanged} from '../services/payroll-leave';
import {requireApprovedPresence} from '../services/attendance-location';

// Mounted under the authenticated payroll router, before its /:id route.
const router=Router();
router.get('/preview',handle(async(req,res)=>{
  const filter=exportFilterSchema.parse(req.query);
  res.json(await db.transaction(tx=>loadPayrollExport(tx,req.user!,filter),{isolationLevel:'repeatable read'}));
}));
router.get('/settings',handle(async(req,res)=>{
  if(!canConfigureWps(req.user!))fail(403,'Administrator access is required for WPS company settings.');
  res.json(await db.transaction(getWpsSettings));
}));
router.put('/settings',handle(async(req,res)=>{
  if(!canConfigureWps(req.user!))fail(403,'Administrator access is required for WPS company settings.');
  const input=z.object({version:z.number().int().min(0),settings:wpsSettingsSchema,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const version=await saveVersionedSetting(tx,wpsSettingsKey,input.version,{settings:input.settings});
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'wps_settings',details:JSON.stringify({version,reason:input.reason})});
    return {version};
  }));
}));
router.put('/employees/:id',handle(async(req,res)=>{
  if(!canManageWps(req.user!))fail(403,'Payroll preparation access is required to manage WPS details.');
  const id=positiveId.parse(req.params.id),input=z.object({version:z.number().int().min(0),employee:wpsEmployeeSchema,reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [person]=await tx.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),employeeScope(req.user!,'payroll_management','update'))).for('update');
    if(!person)fail(404,'Employee not found within your payroll access.');
    const version=await saveVersionedSetting(tx,profileKey(id),input.version,{employee:input.employee});
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'wps_employee',entityId:id,details:JSON.stringify({version,reason:input.reason})});
    return {version};
  }));
}));
router.put('/records/:id',handle(async(req,res)=>{
  if(!canManageWps(req.user!))fail(403,'Payroll preparation access is required to manage WPS details.');
  const id=positiveId.parse(req.params.id),input=z.object({version:z.number().int().min(0),record:wpsRecordSchema,fingerprint:z.string().length(64),reason}).strict().parse(req.body);
  res.json(await db.transaction(async tx=>{
    const [row]=await tx.select({record:payroll,review:payrollReviews}).from(payroll).innerJoin(employees,eq(employees.id,payroll.employeeId)).leftJoin(payrollReviews,eq(payrollReviews.payrollId,payroll.id)).where(and(eq(payroll.id,id),employeeScope(req.user!,'payroll_management','update'))).for('update',{of:payroll});
    if(!row?.review)fail(404,'Reviewed payroll not found within your access.');
    const preview=await loadPayrollExport(tx,req.user!,{month:row.record.month,year:row.record.year,kind:'all'});
    if(preview.rows.find(r=>r.id===id)?.fingerprint!==input.fingerprint)fail(409,'Payroll or WPS details changed. Refresh before saving.');
    const version=await saveVersionedSetting(tx,recordKey(id),input.version,{record:input.record,sourceVersion:row.review.version});
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:'update',entityType:'wps_record',entityId:id,details:JSON.stringify({version,payrollVersion:row.review.version,reason:input.reason})});
    return {version};
  }));
}));
router.post('/download',handle(async(req,res)=>{
  const input=exportRequestSchema.parse(req.body);
  if(input.format==='wps'&&!canManageWps(req.user!))fail(403,'Payroll preparation access is required for WPS exports.');
  const output=await db.transaction(async tx=>{
    // Payroll and WPS setting changes must not race the final file validation.
    const locked=await tx.select({id:payroll.id}).from(payroll).innerJoin(employees,eq(employees.id,payroll.employeeId)).where(and(inArray(payroll.id,input.records.map(r=>r.id)),employeeScope(req.user!,'payroll_management',input.format==='wps'?'update':'read'))).orderBy(payroll.id).for('share',{of:payroll});
    if(locked.length!==input.records.length)fail(404,'One or more payroll records are outside your access.');
    if(input.format==='wps')await tx.execute(sql`select pg_advisory_xact_lock(19283023)`);
    const preview=await loadPayrollExport(tx,req.user!,input.filter);
    const index=new Map(preview.rows.map(r=>[r.id,r]));
    const rows=input.records.map(selected=>{
      const row=index.get(selected.id);
      if(!row)fail(404,'A selected payroll record no longer matches these filters. Refresh your selection.');
      if(row.fingerprint!==selected.fingerprint)fail(409,'Payroll, employee or WPS details changed. Refresh and review your selection.');
      if(row.status==='cancelled')fail(409,'Remove cancelled payroll records from your selection.');
      return row;
    }).sort((a,b)=>a.employeeId-b.employeeId||a.id-b.id);
    let filename=`payslips-${input.filter.year}-${String(input.filter.month).padStart(2,'0')}`,content:string,type:string;
    if(input.format==='wps'){
      if(input.confirmed!==true)fail(400,'Confirm the WPS payment details before exporting.');
      if(input.settingsVersion!==preview.settingsVersion)fail(409,'Company WPS settings changed. Refresh before exporting.');
      if(preview.settingsIssues.length)fail(409,'Complete company WPS settings: '+preview.settingsIssues.join(' '));
      const blocked=rows.filter(r=>r.wps!.issues.length);
      if(blocked.length)fail(409,`${blocked.length} selected payroll record(s) need WPS corrections. ${blocked[0].name}: ${blocked[0].wps!.issues[0]}`);
      const identities=rows.map(r=>r.wps!.employee.qid||r.wps!.employee.visaId),accounts=rows.map(r=>r.wps!.employee.account);
      if(new Set(identities).size!==rows.length)fail(409,'Duplicate QID or visa IDs are present in the selected payroll.');
      if(new Set(accounts).size!==rows.length)fail(409,'More than one selected employee uses the same bank account. Correct their WPS payment details.');
      if(rows.some(r=>r.wps!.lastExport)&&(!input.allowReexport||(input.reason||'').trim().length<5))fail(409,'This selection includes payroll already exported to WPS. Confirm re-export and provide a reason.');
      const reviews=await tx.select().from(payrollReviews).where(inArray(payrollReviews.payrollId,rows.map(r=>r.id)));
      for(const review of reviews){
        const unpaid=(review.policy as {unpaidLeave?:unknown}).unpaidLeave;
        if(unpaid!==undefined)await assertUnpaidLeaveUnchanged(tx,rows.find(r=>r.id===review.payrollId)!.employeeId,{start:review.periodStart,end:review.periodEnd},unpaid);
      }
      const time=await tx.select({line:payrollTimeLines,sheet:workforceTimesheets}).from(payrollTimeLines).innerJoin(workforceTimesheets,eq(workforceTimesheets.id,payrollTimeLines.timesheetId)).where(inArray(payrollTimeLines.payrollId,rows.map(r=>r.id)));
      for(const {line,sheet} of time){
        if(sheet.status!=='approved'||sheet.version!==line.timesheetVersion)fail(409,'Approved time changed. Return the payroll for reconciliation before exporting WPS.');
        await requireApprovedPresence(tx,sheet.assignmentId,sheet.actualEndAt);
      }
      const file=sifFile(preview.settings!,rows,input.filter);
      filename=file.filename;content=file.content;type='text/csv; charset=utf-8';
      const fileKey='payroll_wps_file:'+filename,hash=fingerprint(content),[existing]=await tx.select().from(appSettings).where(eq(appSettings.key,fileKey));
      if(existing&&(existing.value as {hash:string}).hash!==hash)fail(409,'A different WPS file already uses this minute’s filename. Wait until the next minute before exporting this selection.');
      const manifest={filename,at:new Date().toISOString(),hash,ids:rows.map(r=>r.id),total:totalMoney(rows),actor:req.user!.userId};
      await tx.insert(appSettings).values({key:fileKey,value:manifest}).onConflictDoNothing();
      for(const row of rows)await tx.insert(appSettings).values({key:exportKey(row.id),value:{filename,at:manifest.at}}).onConflictDoUpdate({target:appSettings.key,set:{value:{filename,at:manifest.at},updatedAt:new Date()}});
    }else if(input.format==='csv'){
      filename+='.csv';content='\uFEFF'+payrollCsv(rows);type='text/csv; charset=utf-8';
    }else{
      filename+='.html';content=payslipDocument(await getCompanySettings(tx),rows,input.filter);type='text/html; charset=utf-8';
    }
    await tx.insert(activityLogs).values({userId:req.user!.userId,action:'export',entityType:'payroll_export',details:JSON.stringify({format:input.format,filename,recordIds:rows.map(r=>r.id),filter:input.filter,reason:input.reason||null})});
    return {filename,content,type};
  });
  res.set('X-Content-Type-Options','nosniff');
  res.set('Content-Disposition',`attachment; filename="${output.filename}"`);
  res.type(output.type).send(output.content);
}));
export default router;
