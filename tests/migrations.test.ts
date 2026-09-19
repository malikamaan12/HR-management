import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Match the production node-postgres migrator's simple-query execution. PGlite's
// prepared-query driver rejects valid multi-statement PostgreSQL migration SQL.
// Keep deployed migration files and hashes unchanged.
function migrationDb(pg: PGlite) {
  return drizzle({ query: async (input: any, params: unknown[] = []) => {
    const text = typeof input === 'string' ? input : input.text;
    const result = params.length ? await pg.query(text, params) : (await pg.exec(text)).at(-1)!;
    return input.rowMode === 'array' ? { ...result, rows: result.rows.map((row: any) => result.fields.map(field => row[field.name])) } : result;
  } } as any);
}

test('the complete deployment migration journal applies to an empty database and reruns safely', async () => {
  const pg = new PGlite();
  try {
    const db = migrationDb(pg);
    const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
    const journal = JSON.parse(readFileSync(new URL('../migrations/meta/_journal.json', import.meta.url), 'utf8'));
    await migrate(db, { migrationsFolder });
    const first = await pg.query<{ count: number }>('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
    expect(first.rows[0].count).toBe(journal.entries.length);
    await pg.query('SELECT 1 FROM users LIMIT 0');
    await pg.query('SELECT 1 FROM assignment_reviews LIMIT 0');
    await migrate(db, { migrationsFolder });
    const rerun = await pg.query<{ count: number }>('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations');
    expect(rerun.rows[0].count).toBe(journal.entries.length);
  } finally { await pg.close(); }
});


test.each([25,26,27,28,38,41])('upgrades live journal through migration %i without changing existing records',async(cutoff)=>{
 const {mkdtempSync,copyFileSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');const root=mkdtempSync(path.join(tmpdir(),'hr-upgrade-'));const pg=new PGlite();
 try{
  const current=fileURLToPath(new URL('../migrations',import.meta.url)),journal=JSON.parse(readFileSync(path.join(current,'meta/_journal.json'),'utf8'));
  const prior={...journal,entries:journal.entries.filter((entry:any)=>entry.idx<=cutoff)};for(const entry of prior.entries)copyFileSync(path.join(current,entry.tag+'.sql'),path.join(root,entry.tag+'.sql'));
  (await import('node:fs')).mkdirSync(path.join(root,'meta'));writeFileSync(path.join(root,'meta/_journal.json'),JSON.stringify(prior));const db=migrationDb(pg);await migrate(db,{migrationsFolder:root});
  await pg.exec("INSERT INTO users(username,email,password,first_name,last_name,role) VALUES ('migration-test','migration@example.test','not-a-real-credential','Migration','Test','super_admin'); INSERT INTO candidates(full_name_en,email,phone,source) VALUES ('Existing Candidate','existing@example.test','Synthetic','other'); INSERT INTO app_settings(key,value) VALUES ('retained-test-policy','{\"configured\":true}'::jsonb)");
  await pg.exec("INSERT INTO employees(employee_id,first_name,last_name,gender,date_of_birth,nationality,qid_number,primary_mobile,residential_address,emergency_contact_name,emergency_contact_number,type,department,position,location,joining_date) VALUES ('UPGRADE-1','Existing','Worker','female','1990-01-01','Test','UPGRADE-QID','Test','Test','Test','Test','temporary','Operations','Host','Mall','2020-01-01'); INSERT INTO documents(employee_id,document_type,document_number,issue_date,expiry_date,status,document_file) VALUES (1,'Passport','RETAINED-NUMBER','2020-01-01','2030-01-01','valid','private/retained.pdf'); INSERT INTO document_renewal_requests(document_id,requested_by,expected_version,proposal) VALUES (1,1,0,'{}'::jsonb); INSERT INTO bulk_import_jobs(file_name,file_url,uploaded_by,status,total_rows,successful_rows,failed_rows) VALUES ('retained.csv','inline-upload',1,'completed',2,2,0)");
  await pg.exec("INSERT INTO lifecycle_templates(name,kind,tasks,created_by) VALUES ('Existing orientation','onboarding','[{\"title\":\"Orientation\",\"kind\":\"general\",\"required\":true,\"offsetDays\":0}]'::jsonb,1); INSERT INTO lifecycle_cases(employee_id,kind,template_id,template_snapshot,start_date,created_by,reason) VALUES (1,'onboarding',1,'{\"name\":\"Existing orientation\"}'::jsonb,'2020-01-01',1,'Preserve existing workflow'); INSERT INTO lifecycle_tasks(case_id,title,kind,required,owner_id,due_date,status,evidence,completed_by) VALUES (1,'Orientation','general',true,1,'2020-01-01','completed','Existing evidence',1)");
  await migrate(db,{migrationsFolder:current});
  expect((await pg.query('SELECT version,active FROM lifecycle_templates')).rows[0]).toEqual({version:1,active:true});
  expect((await pg.query('SELECT status,review_required,review_state,evidence FROM lifecycle_tasks')).rows[0]).toEqual({status:'completed',review_required:false,review_state:'not_required',evidence:'Existing evidence'});
  expect((await pg.query('SELECT review_policy_snapshot FROM lifecycle_cases')).rows[0].review_policy_snapshot).toBe(null);
  expect((await pg.query('SELECT document_number,document_file FROM documents')).rows[0]).toEqual({document_number:'RETAINED-NUMBER',document_file:'private/retained.pdf'});
  expect((await pg.query('SELECT status,version,assigned_reviewer_id,policy_snapshot FROM document_renewal_requests')).rows[0]).toEqual({status:'pending',version:1,assigned_reviewer_id:null,policy_snapshot:null});
  expect((await pg.query('SELECT status,successful_rows,submission_key FROM bulk_import_jobs')).rows[0]).toEqual({status:'completed',successful_rows:2,submission_key:null});
  expect((await pg.query('SELECT full_name_en,record_version FROM candidates')).rows).toEqual([{full_name_en:'Existing Candidate',record_version:1}]);expect((await pg.query("SELECT value FROM app_settings WHERE key='retained-test-policy'")).rows).toEqual([{value:{configured:true}}]);
  await migrate(db,{migrationsFolder:current});expect((await pg.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n).toBe(journal.entries.length);
 }finally{await pg.close();const resolved=path.resolve(root),allowed=path.resolve(tmpdir())+path.sep;if(!resolved.startsWith(allowed)||!path.basename(resolved).startsWith('hr-upgrade-'))throw Error('Unexpected cleanup path');rmSync(resolved,{recursive:true,force:true});}
});
