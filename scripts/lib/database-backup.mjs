import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, unlink, stat, realpath, access, mkdtemp, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

const magic = Buffer.from('E3HRBKP1'), headerBytes = 36, tagBytes = 16;
function encryptionKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 16 || passphrase.length > 1024) throw new Error('Set BACKUP_PASSPHRASE to a unique passphrase of 16–1024 characters');
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function encryptArchive(source, output, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12), header = Buffer.concat([magic, salt, iv]);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(passphrase, salt), iv);
  cipher.setAAD(header);
  const file = await open(output, 'wx', 0o600);
  try {
    await file.writeFile(header);
    let size = 0;
    for await (const chunk of source) { size += chunk.length; await file.writeFile(cipher.update(chunk)); }
    if (size < 5) throw new Error('The database export was empty');
    await file.writeFile(cipher.final()); await file.writeFile(cipher.getAuthTag()); await file.sync();
  } catch (error) { await file.close(); await unlink(output).catch(() => {}); throw error; }
  await file.close();
}

export async function decryptArchive(input, output, passphrase) {
  const size = (await stat(input)).size;
  if (size < headerBytes + tagBytes + 5) throw new Error('Invalid encrypted database backup');
  const source = await open(input, 'r'), header = Buffer.alloc(headerBytes), tag = Buffer.alloc(tagBytes);
  try { await source.read(header, 0, header.length, 0); await source.read(tag, 0, tag.length, size - tagBytes); }
  finally { await source.close(); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(passphrase, header.subarray(8, 24)), header.subarray(24, 36));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  const file = await open(output, 'wx', 0o600);
  try {
    for await (const chunk of createReadStream(input, { start: headerBytes, end: size - tagBytes - 1 })) await file.writeFile(decipher.update(chunk));
    await file.writeFile(decipher.final()); await file.sync();
  } catch { await file.close(); await unlink(output).catch(() => {}); throw new Error('Backup authentication failed: wrong passphrase or damaged file'); }
  await file.close();
  const check = await open(output, 'r'), prefix = Buffer.alloc(5);
  try { await check.read(prefix, 0, 5, 0); } finally { await check.close(); }
  if (prefix.toString() !== 'PGDMP') { await unlink(output); throw new Error('Backup does not contain a PostgreSQL custom archive'); }
}

export function databaseConnection(url, restore = false, confirmDatabase = '') {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Supply the explicit database connection environment variable'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hash || !parsed.username || !parsed.hostname) throw new Error('Invalid PostgreSQL connection');
  if ([...parsed.searchParams.keys()].some(key => key !== 'sslmode') || parsed.searchParams.getAll('sslmode').length > 1) throw new Error('Only sslmode is accepted as a database URL option');
  const host = parsed.hostname.replace(/^\[|\]$/g, ''), local = ['127.0.0.1', '::1'].includes(host);
  const database = decodeURIComponent(parsed.pathname.slice(1)), user = decodeURIComponent(parsed.username), password = decodeURIComponent(parsed.password);
  if (!database || database.includes('/') || [database, user, password].some(value => /[\0\r\n]/.test(value))) throw new Error('Invalid database connection values');
  const sslmode = parsed.searchParams.get('sslmode') || (local ? 'disable' : 'require');
  if (!['disable', 'require', 'verify-full'].includes(sslmode) || (!local && sslmode === 'disable')) throw new Error('Remote backups require TLS');
  if (restore && (!local || !/^hr_restore_[a-z0-9_]+$/i.test(database) || confirmDatabase !== database)) throw new Error('Restore requires a loopback database named hr_restore_* and matching --confirm-db');
  return { host, database, user, password, port: Number(parsed.port || 5432), sslmode };
}

export function commandEnvironment(connection, inherited = process.env) {
  // Never pass app secrets or inherited libpq service/host/options overrides to tools.
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|HOME|USERPROFILE|LANG|LC_ALL)$/i.test(key)));
  return { ...env, PGHOST: connection.host, PGPORT: String(connection.port), PGDATABASE: connection.database,
    PGUSER: connection.user, PGPASSWORD: connection.password, PGSSLMODE: connection.sslmode, PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'e3-hr-recovery' };
}

function command(binary, args, env, stream = false) {
  const child = spawn(binary, args, { shell: false, windowsHide: true, env, stdio: ['ignore', stream ? 'pipe' : 'ignore', 'pipe'] });
  let warnings = false;
  child.stderr.on('data', () => { warnings = true; });
  const timer = setTimeout(() => child.kill(), 300000);
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('PostgreSQL client tool is unavailable; install pg_dump and pg_restore or set their executable paths')));
    child.once('close', code => code === 0 && !warnings ? resolve() : reject(new Error('PostgreSQL tool failed or reported warnings. Check client/server versions, connection permissions and the recovery guide.')));
  }).finally(() => clearTimeout(timer));
  // Attach immediately: a failed spawn must not become an unhandled rejection.
  done.catch(() => {});
  return { child, done };
}

export async function outsideRepository(output) {
  let parent = await realpath(path.dirname(path.resolve(output)));
  const canonical = path.join(parent, path.basename(output));
  for (;;) {
    try { await access(path.join(parent, '.git')); throw new Error('Save private backups outside every Git checkout'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = path.dirname(parent); if (next === parent) break; parent = next;
  }
  if (!canonical.endsWith('.e3hrbackup')) throw new Error('Use the .e3hrbackup extension');
  return canonical;
}

export async function createDatabaseBackup({ output, databaseUrl, passphrase, binary = 'pg_dump' }) {
  const destination = await outsideRepository(output), connection = databaseConnection(databaseUrl);
  // Validate the passphrase before starting any database connection.
  encryptionKey(passphrase, Buffer.alloc(16));
  const { child, done } = command(binary, ['--format=custom', '--schema=public', '--schema=drizzle', '--no-owner', '--no-acl', '--no-password', '--lock-wait-timeout=10000'], { ...commandEnvironment(connection), PGOPTIONS: '-c default_transaction_read_only=on' }, true);
  let created = false;
  try {
    await encryptArchive(child.stdout, destination, passphrase); created = true;
    await done;
  } catch (error) { child.kill(); await done.catch(() => {}); if (created) await unlink(destination).catch(() => {}); throw error; }
}

export async function withDecryptedBackup(input, passphrase, fn) {
  const directory = await mkdtemp(path.join(tmpdir(), 'e3-hr-restore-')), archive = path.join(directory, 'database.dump');
  try { await decryptArchive(input, archive, passphrase); return await fn(archive); }
  finally { await unlink(archive).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(directory); }
}

export async function verifyDatabaseBackup({ input, passphrase, binary = 'pg_restore' }) {
  await withDecryptedBackup(input, passphrase, async archive => {
    await command(binary, ['--list', archive], commandEnvironment({ host: '', port: 5432, database: '', user: '', password: '', sslmode: 'require' })).done;
  });
}

export function restoreContentsList(list) {
  // An initdb-created scratch database already owns an empty public schema.
  // Preserve it and restore its objects; never use --clean or drop a schema.
  return list.split(/\r?\n/).map(line => /^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s+/.test(line) ? '; ' + line : line).join('\n');
}

async function archiveContents(binary, archive, env) {
  const { child, done } = command(binary, ['--list', archive], env, true);
  const chunks = []; let size = 0;
  try {
    for await (const chunk of child.stdout) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Archive contents list exceeds the supported size'); chunks.push(chunk); }
    await done; return Buffer.concat(chunks).toString('utf8');
  } catch (error) { child.kill(); await done.catch(() => {}); throw error; }
}

export async function restoreDatabaseBackup({ input, passphrase, databaseUrl, confirmDatabase, binary = 'pg_restore' }) {
  const connection = databaseConnection(databaseUrl, true, confirmDatabase);
  await withDecryptedBackup(input, passphrase, async archive => {
    // Validate the archive before even opening the isolated target connection.
    const contents = await archiveContents(binary, archive, commandEnvironment(connection));
    const pool = new Pool({ host: connection.host, port: connection.port, database: connection.database, user: connection.user, password: connection.password,
      ssl: connection.sslmode === 'disable' ? false : { rejectUnauthorized: connection.sslmode === 'verify-full' }, connectionTimeoutMillis: 5000, max: 1 });
    try {
      const result = await pool.query({ text: `SELECT
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%') OR
        EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%') OR
        EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') OR
        EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS occupied`, query_timeout: 5000 });
      if (result.rows[0]?.occupied !== false) throw new Error('Restore refused: use a new empty scratch database');
    } catch (error) {
      if (error.message === 'Restore refused: use a new empty scratch database') throw error;
      throw new Error('Unable to verify the isolated restore database');
    } finally { await pool.end(); }
    const listFile = archive + '.list';
    try {
      await writeFile(listFile, restoreContentsList(contents), { flag: 'wx', mode: 0o600 });
      await command(binary, ['--dbname', connection.database, '--use-list', listFile, '--no-owner', '--no-acl', '--no-password', '--single-transaction', '--exit-on-error', archive], commandEnvironment(connection)).done;
    } finally { await unlink(listFile).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
}
