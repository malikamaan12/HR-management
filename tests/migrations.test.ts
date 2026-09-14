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
