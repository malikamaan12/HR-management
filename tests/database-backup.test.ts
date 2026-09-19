import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, readdir, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { encryptArchive, decryptArchive, databaseConnection, commandEnvironment, outsideRepository, restoreContentsList, withDecryptedBackup } from '../scripts/lib/database-backup.mjs';

let folder: string;
const passphrase = 'Synthetic backup passphrase 2026!';
beforeEach(async () => { folder = await mkdtemp(path.join(tmpdir(), 'hr-backup-test-')); });
afterEach(async () => { for (const name of await readdir(folder, { withFileTypes: true })) { const target = path.join(folder, name.name); if (name.isDirectory()) await rmdir(target); else await unlink(target); } await rmdir(folder); });
const file = (name: string) => path.join(folder, name);

test('encrypted archive roundtrip preserves bytes and never stores the source plaintext', async () => {
  const original = Buffer.from('PGDMPsynthetic private employee payload');
  await encryptArchive(Readable.from([original.subarray(0, 7), original.subarray(7)]), file('backup.e3hrbackup'), passphrase);
  expect((await readFile(file('backup.e3hrbackup'))).includes(Buffer.from('private employee'))).toBe(false);
  await decryptArchive(file('backup.e3hrbackup'), file('restored.dump'), passphrase);
  expect(await readFile(file('restored.dump'))).toEqual(original);
});

test('wrong passphrase and tampering remove incomplete plaintext files', async () => {
  await encryptArchive(Readable.from([Buffer.from('PGDMPsynthetic payload')]), file('backup.e3hrbackup'), passphrase);
  await expect(decryptArchive(file('backup.e3hrbackup'), file('wrong.dump'), 'wrong passphrase long enough')).rejects.toThrow(/authentication/);
  const archive = await readFile(file('backup.e3hrbackup')); archive[40] ^= 1; await writeFile(file('backup.e3hrbackup'), archive);
  await expect(decryptArchive(file('backup.e3hrbackup'), file('tampered.dump'), passphrase)).rejects.toThrow(/authentication/);
  expect(await readdir(folder)).toEqual(['backup.e3hrbackup']);
});

test('existing output files are preserved and stream failure removes only newly created output', async () => {
  await writeFile(file('existing.e3hrbackup'), 'keep');
  await expect(encryptArchive(Readable.from([Buffer.from('PGDMPdata')]), file('existing.e3hrbackup'), passphrase)).rejects.toThrow();
  expect(await readFile(file('existing.e3hrbackup'), 'utf8')).toBe('keep');
  async function* broken() { yield Buffer.from('PGDMPpartial'); throw new Error('export failed'); }
  await expect(encryptArchive(Readable.from(broken()), file('partial.e3hrbackup'), passphrase)).rejects.toThrow('export failed');
  expect(await readdir(folder)).toEqual(['existing.e3hrbackup']);
});

test('restore requires a literal loopback host, a scratch database name and exact confirmation', () => {
  expect(databaseConnection('postgres://user:secret@127.0.0.1/hr_restore_drill', true, 'hr_restore_drill').database).toBe('hr_restore_drill');
  for (const url of ['postgres://user:secret@db.example.com/hr_restore_drill', 'postgres://user:secret@localhost/hr_restore_drill', 'postgres://user:secret@127.0.0.1/production', 'postgres://user:secret@127.0.0.1/hr_restore_drill?host=db.example.com']) {
    expect(() => databaseConnection(url, true, 'hr_restore_drill')).toThrow();
  }
  expect(() => databaseConnection('postgres://user:secret@127.0.0.1/hr_restore_drill', true, 'different')).toThrow();
  expect(() => databaseConnection('postgres://user:secret@db.example.com/app?sslmode=disable')).toThrow(/TLS/);
});

test('PostgreSQL child environment excludes inherited routing, options and application secrets', () => {
  const connection = databaseConnection('postgres://user:p%40ss@db.example.com/app?sslmode=require');
  const env = commandEnvironment(connection, { PATH: 'tools', PGHOSTADDR: 'malicious', PGSERVICE: 'override', PGOPTIONS: 'unsafe', JWT_SECRET: 'private', DATABASE_URL: 'private', BACKUP_PASSPHRASE: 'private' });
  expect(env.PGPASSWORD).toBe('p@ss'); expect(env.PGHOST).toBe('db.example.com'); expect(env.PATH).toBe('tools');
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGOPTIONS', 'JWT_SECRET', 'DATABASE_URL', 'BACKUP_PASSPHRASE']) expect(env).not.toHaveProperty(key);
});

test('backup destination refuses a Git checkout and invalid extension', async () => {
  await expect(outsideRepository(file('backup.sql'))).rejects.toThrow(/extension/);
  await mkdir(file('.git')); await expect(outsideRepository(file('backup.e3hrbackup'))).rejects.toThrow(/Git checkout/);
});

test('contents selection skips only the default public schema and preserves tables and journal', () => {
  const list = '5; 2615 2200 SCHEMA - public postgres\n6; 2615 2201 SCHEMA - drizzle postgres\n7; 1259 2300 TABLE public users postgres\n8; 1259 2301 TABLE drizzle __drizzle_migrations postgres';
  expect(restoreContentsList(list)).toBe('; ' + list);
});

test('decrypted temporary archive is cleaned even when the restore operation fails', async () => {
  await encryptArchive(Readable.from([Buffer.from('PGDMPsynthetic')]), file('backup.e3hrbackup'), passphrase);
  let archivePath = '';
  await expect(withDecryptedBackup(file('backup.e3hrbackup'), passphrase, async (archive: string) => { archivePath = archive; expect(await readFile(archive, 'utf8')).toBe('PGDMPsynthetic'); throw new Error('restore failure'); })).rejects.toThrow('restore failure');
  await expect(readFile(archivePath)).rejects.toThrow();
});
