import Papa from 'papaparse';
import {z} from 'zod';
import {and,eq,inArray,or,sql} from 'drizzle-orm';
import {employees,employeeImportRows,bulkImportJobs} from '@shared/schema';
import {employeeWriteFields,checkEmploymentDates} from '@shared/employee-records';
import {employeeImportColumns,type ImportPayload,type ImportIssue} from '@shared/employee-import';
import {OnboardingError} from './onboarding-workflow';
import {recordHistory} from './workplaceRecords';
export const IMPORT_MAX_ROWS=500,IMPORT_MAX_BYTES=2*1024*1024;
export const importPayloadSchema=z.object(Object.fromEntries(employeeImportColumns.map(c=>[c.key,z.string().max(2000)]))).partial().strict();
const fail=(message:string):never=>{throw new OnboardingError(400,message);};
const canonical=(s:string)=>s.trim().toLowerCase();
const headerKey=(s:string)=>s.trim().toLowerCase().replace(/[ _-]/g,'');
const aliases=new Map(employeeImportColumns.map(c=>[headerKey(c.key),c.key]));aliases.set('email','personalEmail');aliases.set('employeetype','type');
export function parseEmployeeCsv(buffer:Buffer):{rowNumber:number;payload:ImportPayload;included:boolean}[]{
 if(!buffer.length||buffer.length>IMPORT_MAX_BYTES)fail('Choose a non-empty UTF-8 CSV file up to 2 MB');
 let content:string;try{content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{fail('Save the file as UTF-8 CSV before uploading');}
 if(content!.includes('\0'))fail('Binary data is not supported; upload UTF-8 CSV');
 const parsed=Papa.parse<string[]>(content!,{header:false,delimiter:',',skipEmptyLines:'greedy',dynamicTyping:false,preview:IMPORT_MAX_ROWS+2});
 if(parsed.errors.length)fail('CSV quoting or record structure is invalid. Use comma-separated UTF-8 CSV with quoted values when needed');
 if(parsed.data.length<2)fail('The file needs a header and at least one employee record');
 if(parsed.data.length>IMPORT_MAX_ROWS+1)fail('Import at most 500 employee records per file');
 const headers=parsed.data[0].map(h=>aliases.get(headerKey(h)));
 if(headers.some(h=>!h))fail('The file contains unsupported columns. Use the current template; account credentials, roles and system fields are not imported');
 if(new Set(headers).size!==headers.length)fail('Two columns map to the same employee field. Remove duplicate headers or aliases');
 const missing=employeeImportColumns.filter(c=>c.required&&!headers.includes(c.key));
 if(missing.length)fail('Required columns missing: '+missing.map(c=>c.key).join(', '));
 return parsed.data.slice(1).map((cells,index)=>{
  if(cells.length!==headers.length)fail('CSV record '+(index+2)+' has the wrong number of fields; check commas and quotation marks');
  const payload=Object.fromEntries(headers.map((h,i)=>[h!,cells[i].trim()]));
  const valid=importPayloadSchema.safeParse(payload);if(!valid.success)fail('CSV record '+(index+2)+' has a value longer than 2,000 characters');
  return {rowNumber:index+2,payload,included:true};
 });
}
type Staged={id:number;rowNumber:number;payload:unknown;included:boolean;employeeId:number|null};
type Validated=Staged&{payload:ImportPayload;errors:ImportIssue[];values?:z.infer<typeof employeeWriteFields>};
export async function validateImportRows(tx:any,rows:Staged[]){
 const result:Validated[]=rows.map(row=>{
  const payload=importPayloadSchema.parse(row.payload) as ImportPayload,errors:ImportIssue[]=[];
  const input:Record<string,unknown>={};
  for(const col of employeeImportColumns){const value=payload[col.key]?.trim();if(value===undefined||value==='')continue;
   if(col.key==='managerEmployeeId'||col.key==='secondaryManagerEmployeeId')continue;
   if(col.kind==='boolean'){if(!['true','false'].includes(value.toLowerCase()))errors.push({field:col.key,message:'Use true or false'});else input[col.key]=value.toLowerCase()==='true';}
   else if(col.kind==='integer'){if(!/^\d+$/.test(value))errors.push({field:col.key,message:'Use a non-negative whole number'});else input[col.key]=Number(value);}
   else input[col.key]=col.options?value.toLowerCase():value;
  }
  const parsed=employeeWriteFields.safeParse(input);
  if(!parsed.success)errors.push(...parsed.error.issues.map(e=>({field:String(e.path[0]||'record'),message:e.code==='invalid_enum_value'?'Choose an allowed value from the field guide':e.code==='invalid_type'?'A value in the expected format is required':e.message})));
  else{const message=checkEmploymentDates(parsed.data);if(message)errors.push({field:'dates',message});}
  return {...row,payload,errors,values:parsed.success?parsed.data:undefined};
 });
 const included=result.filter(r=>r.included),refs=[...new Set(included.flatMap(r=>[r.payload.employeeId,r.payload.managerEmployeeId,r.payload.secondaryManagerEmployeeId]).filter(Boolean).map(canonical))],qids=[...new Set(included.map(r=>r.payload.qidNumber).filter(Boolean).map(canonical))];
 const existing: {id:number;employeeId:string;qidNumber:string;status:string}[]=refs.length||qids.length?await tx.select({id:employees.id,employeeId:employees.employeeId,qidNumber:employees.qidNumber,status:employees.status}).from(employees).where(or(refs.length?inArray(sql`lower(trim(${employees.employeeId}))`,refs):undefined,qids.length?inArray(sql`lower(trim(${employees.qidNumber}))`,qids):undefined)):[];
 const ids=new Map<string,Validated[]>(),identity=new Map<string,Validated[]>();
 for(const r of included){for(const [key,map] of [[r.payload.employeeId,ids],[r.payload.qidNumber,identity]] as const){if(!key)continue;const normalized=canonical(key);map.set(normalized,[...(map.get(normalized)||[]),r]);}}
 for(const r of included){
  for(const [field,map] of [['employeeId',ids],['qidNumber',identity]] as const){const key=r.payload[field]&&canonical(r.payload[field]);if(!key)continue;
   if((map.get(key)?.length||0)>1)r.errors.push({field,message:'Duplicate value in included CSV records'});
   if(existing.some(e=>canonical(e[field])===key))r.errors.push({field,message:'Already used by an existing employee; this import only creates new employees'});
  }
  for(const field of ['managerEmployeeId','secondaryManagerEmployeeId']){const key=r.payload[field]&&canonical(r.payload[field]);if(!key)continue;
   if(key===canonical(r.payload.employeeId||'')){r.errors.push({field,message:'An employee cannot report to themselves'});continue;}
   const candidates=existing.filter(e=>canonical(e.employeeId)===key),pending=ids.get(key)||[];
   if(candidates.length+pending.length!==1)r.errors.push({field,message:'Choose one existing manager or one included employee from this file'});
   else if(candidates[0]?.status==='inactive')r.errors.push({field,message:'The selected manager is inactive'});
  }
 }
 // Existing records cannot point to these not-yet-created IDs. Cycles can only be introduced between staged employees.
 for(const r of included){const origin=canonical(r.payload.employeeId||''),seen=new Set<string>(),queue=[r];
  while(queue.length){const node=queue.pop()!;for(const field of ['managerEmployeeId','secondaryManagerEmployeeId']){const parent=node.payload[field]&&canonical(node.payload[field]);if(!parent)continue;
   if(parent===origin){if(!r.errors.some(e=>e.field==='managers'))r.errors.push({field:'managers',message:'Reporting relationships form a cycle'});continue;}
   if(seen.has(parent))continue;seen.add(parent);const matches=ids.get(parent);if(matches?.length===1)queue.push(matches[0]);
  }}
 }
 // Invalid managers propagate to dependents, including chains of staged managers.
 let changed=true;while(changed){changed=false;for(const r of included)for(const field of ['managerEmployeeId','secondaryManagerEmployeeId']){const parent=r.payload[field]?ids.get(canonical(r.payload[field])):undefined;if(parent?.length===1&&parent[0].errors.length&&!r.errors.some(e=>e.field===field)){r.errors.push({field,message:'Correct or replace the referenced manager record first'});changed=true;}}}
 return {rows:result,existing,includedRows:included.length,failedRows:included.filter(r=>r.errors.length).length};
}
export async function saveImportValidation(tx:any,jobId:number,validation:Awaited<ReturnType<typeof validateImportRows>>,version:number){
 await tx.execute(sql`UPDATE employee_import_rows AS r SET errors=v.errors FROM jsonb_to_recordset(${JSON.stringify(validation.rows.map(r=>({id:r.id,errors:r.errors})))}::jsonb) AS v(id integer,errors jsonb) WHERE r.id=v.id AND r.job_id=${jobId}`);
 const [job]=await tx.update(bulkImportJobs).set({includedRows:validation.includedRows,failedRows:validation.failedRows,validatedAt:new Date(),version}).where(eq(bulkImportJobs.id,jobId)).returning();return job;
}
export function importJobView(job:typeof bulkImportJobs.$inferSelect){return {id:job.id,fileName:job.fileName,status:job.status,version:job.version,totalRows:job.totalRows||0,successfulRows:job.successfulRows||0,failedRows:job.failedRows||0,includedRows:job.includedRows,excludedRows:job.submissionKey?(job.totalRows||0)-job.includedRows:0,validRows:job.submissionKey?job.includedRows-(job.failedRows||0):0,createdAt:job.createdAt,completedAt:job.completedAt,validatedAt:job.validatedAt,committedFromVersion:job.committedFromVersion,staged:!!job.submissionKey};}
export async function importHistory(tx:any,req:any,job:typeof bulkImportJobs.$inferSelect,action:string,reason:string,extra:Record<string,unknown>={}){
 const {fileName,...safe}=importJobView(job);await recordHistory(tx,req,'employee_import',{...safe,action,...extra},reason);
}
export function importReportCsv(rows:{rowNumber:number;included:boolean;errors:unknown;employeeId:number|null}[]){
 // Report contains record coordinates and validation guidance, not source personal data.
 return Papa.unparse(rows.flatMap(r=>(r.errors as ImportIssue[]).length?(r.errors as ImportIssue[]).map(e=>({record:r.rowNumber,included:r.included,outcome:r.included?'needs correction':'excluded',field:e.field,message:e.message,createdEmployeeRecordId:r.employeeId??''})):[{record:r.rowNumber,included:r.included,outcome:r.employeeId?'imported':r.included?'valid':'excluded',field:'',message:'',createdEmployeeRecordId:r.employeeId??''}]),{escapeFormulae:true});
}
