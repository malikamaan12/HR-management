import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('the complete deployment migration journal applies to an empty database and reruns safely', async () => {
  const pg = new PGlite();
  try {
    const db = drizzle(pg);
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


test('upgrades the live journal with existing candidate and policy data without rewriting earlier migrations',async()=>{
 const {mkdtempSync,copyFileSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');const root=mkdtempSync(path.join(tmpdir(),'hr-upgrade-'));const pg=new PGlite();
 try{
  const current=fileURLToPath(new URL('../migrations',import.meta.url)),journal=JSON.parse(readFileSync(path.join(current,'meta/_journal.json'),'utf8'));
  const prior={...journal,entries:journal.entries.slice(0,-1)};for(const entry of prior.entries)copyFileSync(path.join(current,entry.tag+'.sql'),path.join(root,entry.tag+'.sql'));
  (await import('node:fs')).mkdirSync(path.join(root,'meta'));writeFileSync(path.join(root,'meta/_journal.json'),JSON.stringify(prior));const db=drizzle(pg);await migrate(db,{migrationsFolder:root});
  await pg.exec("INSERT INTO users(username,email,password,first_name,last_name,role) VALUES ('migration-test','migration@example.test','not-a-real-credential','Migration','Test','super_admin'); INSERT INTO candidates(full_name_en,email,phone,source) VALUES ('Existing Candidate','existing@example.test','Synthetic','other'); INSERT INTO app_settings(key,value) VALUES ('retained-test-policy','{\"configured\":true}'::jsonb)");
  await migrate(db,{migrationsFolder:current});expect((await pg.query('SELECT full_name_en,record_version FROM candidates')).rows).toEqual([{full_name_en:'Existing Candidate',record_version:1}]);expect((await pg.query("SELECT value FROM app_settings WHERE key='retained-test-policy'")).rows).toEqual([{value:{configured:true}}]);
  await migrate(db,{migrationsFolder:current});expect((await pg.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n).toBe(journal.entries.length);
 }finally{await pg.close();const resolved=path.resolve(root),allowed=path.resolve(tmpdir())+path.sep;if(!resolved.startsWith(allowed)||!path.basename(resolved).startsWith('hr-upgrade-'))throw Error('Unexpected cleanup path');rmSync(resolved,{recursive:true,force:true});}
});
