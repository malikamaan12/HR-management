import { parseArgs } from 'node:util';
import { createDatabaseBackup, verifyDatabaseBackup, restoreDatabaseBackup } from './lib/database-backup.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { output: { type: 'string' }, input: { type: 'string' }, 'confirm-db': { type: 'string' } } });
  const [action] = positionals;
  if (positionals.length !== 1 || !['backup', 'verify', 'restore'].includes(action)) throw new Error('Use backup --output FILE.e3hrbackup, verify --input FILE.e3hrbackup, or restore --input FILE.e3hrbackup --confirm-db hr_restore_NAME');
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (action === 'backup') {
    if (!values.output || values.input || values['confirm-db']) throw new Error('Backup requires only --output');
    await createDatabaseBackup({ output: values.output, databaseUrl: process.env.BACKUP_DATABASE_URL, passphrase, binary: process.env.PG_DUMP_PATH || 'pg_dump' });
    console.log('Encrypted application database backup created. Verify the archive and complete an isolated restore drill. Private storage files need a separate backup.');
  } else if (action === 'verify') {
    if (!values.input || values.output || values['confirm-db']) throw new Error('Verify requires only --input');
    await verifyDatabaseBackup({ input: values.input, passphrase, binary: process.env.PG_RESTORE_PATH || 'pg_restore' });
    console.log('Backup authenticated and PostgreSQL archive readable. A database restore drill is still required.');
  } else {
    if (!values.input || values.output || !values['confirm-db']) throw new Error('Restore requires --input and --confirm-db');
    await restoreDatabaseBackup({ input: values.input, databaseUrl: process.env.RESTORE_DATABASE_URL, confirmDatabase: values['confirm-db'], passphrase, binary: process.env.PG_RESTORE_PATH || 'pg_restore' });
    console.log('Restored into the empty local scratch database. Verify application records and private-file recovery before accepting the backup.');
  }
} catch (error) {
  // Only library validation messages are useful here. Never print a connection,
  // stack trace, raw child stderr or filesystem error containing private paths.
  console.error(error?.code ? 'Recovery operation failed. Check file access and the recovery guide.' : error.message);
  process.exitCode = 1;
}
