# E3 HR service readiness and recovery

This batch adds local tools and administrator controls. It does not mean that production storage, email delivery or a production backup has been verified. Keep the existing Free plans. No additional hosted service, subscription or dependency is required.

## Administrator checks

Open **Operational setup → Services & recovery**, or **Settings**. Only an administrator or super administrator can view service status or run the storage check.

- Database status checks a real query against the employee account table.
- Storage configuration means valid-looking server settings are present. **Verify private storage** creates a tiny synthetic object in the configured Supabase bucket, reads it back, downloads a signed attachment, checks denial of anonymous access and removes it. Each stage has its own result. The check does not touch an employee file. Concurrent runs and runs less than a minute apart are rejected.
- A changed storage configuration invalidates the relevance of the saved result. The timestamp is evidence of one past check, not continuous monitoring. A check can take up to one minute. Refresh if it was started in another tab.
- If cleanup fails, use **Retry temporary-file cleanup**. That action can remove only the recorded synthetic object, using the original storage configuration. If configuration changed, restore that configuration first or have the operator remove the recorded object in the original bucket and investigate the saved check before proceeding. No arbitrary object-key deletion endpoint exists.
- Email configuration reports the presence of Resend credentials, a sender address and a valid application URL. It sends no email and does not certify domain verification or delivery.
- A successful file probe does not prove every application upload permission or mobile device workflow. Complete those acceptance checks with the actual operational configuration.

## Encrypted database backups

Run these tools on an operator's trusted computer, outside Render's ephemeral filesystem. Install the free PostgreSQL client tools (`pg_dump` and `pg_restore`) matching the server's major version, or compatible newer clients. Set `PG_DUMP_PATH` and `PG_RESTORE_PATH` to executable paths if the tools are not on PATH. These tools are not bundled with the app.

The command exports the application `public` schema and the `drizzle` migration journal in PostgreSQL custom format. It includes app users, password hashes, sessions, policies and HR records. It excludes Supabase-managed schemas, global roles, provider settings and actual storage objects. Schema dependencies outside the selected schemas must be provisioned separately during disaster recovery.

Privately set these environment variables for the current process:

- `BACKUP_DATABASE_URL`: the source PostgreSQL/session-pooler connection. It is explicitly required; the tool does not load `.env` or fall back to `DATABASE_URL`.
- `BACKUP_PASSPHRASE`: a unique secret of at least 16 characters. Keep it in the company's password manager, separately from the archive. A lost passphrase cannot be recovered by this tool.
- `PG_DUMP_PATH` / `PG_RESTORE_PATH`: optional executable paths.

Do not paste credentials into chat, command arguments, Git or shared logs. Only the `sslmode` URL option is accepted; remote connections require TLS. Connection credentials are passed to the PostgreSQL child process through its environment. Other app credentials and inherited PostgreSQL routing/options variables are excluded.

Create a private output folder outside all Git checkouts, then run from the application checkout:

```text
npm run db:backup -- --output "C:/Private HR Backups/hr-2026-09-19.e3hrbackup"
npm run db:backup:verify -- --input "C:/Private HR Backups/hr-2026-09-19.e3hrbackup"
```

Replace the example folder and date with your actual private path. The backup command refuses existing files and paths inside Git checkouts. It streams the archive through AES-256-GCM encryption, with a fresh salt/nonce and an scrypt-derived key. A failed export removes the newly created partial archive. The verification command authenticates/decrypts the archive and checks that `pg_restore` can read its contents. It does not connect to a target database or certify restoration.

Keep an additional encrypted copy on separately controlled storage. Choose a backup frequency and retention period with the owner. These commands do not create a scheduled job or a paid backup service. Clear the credential environment variables after use.

## Isolated restore drill

Use only a trusted archive created from your own application database. PostgreSQL restore executes database definitions contained in an archive. Do not restore untrusted third-party files.

1. Create a new empty local PostgreSQL database named `hr_restore_` followed by a name, such as `hr_restore_drill`. Keep the local database accessible only to the operator. Do not run the HR web server, schedulers or email workers against it during the drill.
2. Privately set `RESTORE_DATABASE_URL` to that database at `127.0.0.1` or `::1`, and set `BACKUP_PASSPHRASE` to the original passphrase. Remote restore hosts are rejected. The database name must match the explicit argument below.
3. Run:

```text
npm run db:restore:local -- --input "C:/Private HR Backups/hr-2026-09-19.e3hrbackup" --confirm-db hr_restore_drill
```

4. The tool authenticates the entire encrypted archive before contacting the target. It rejects a nonempty target, preserves the default empty `public` schema, and restores the archive in a single transaction without `--clean`, dropping tables or creating another database. It removes the temporary decrypted archive on normal success/failure. Use an encrypted operator disk: an abrupt process or computer crash may leave its private temporary directory behind.
5. Check the restored migration journal and representative employee, payroll, workflow and document-reference counts against the source snapshot. Verify that historical versions, relationships and sequence-generated IDs are intact. Record the date, archive, app revision, operator, result and any failures in the team's recovery record.
6. Verify private-file recovery separately. A readable database archive alone is insufficient. Delete the disposable local database through your database administration tool when the drill is complete.

The tool intentionally does not restore to production. A real disaster recovery operation requires a separately reviewed target, provider configuration, secrets, storage recovery and cutover plan. Local restore success does not establish hosted-provider compatibility.

## Private files and training media

The database contains object keys, not file bytes. Back up the private bucket separately using an operator-approved S3-compatible tool or the provider's supported export process, preserving the exact object keys. Keep the copy private and encrypted. Cover `documents/`, `helpdesk/`, `employee-services/` and `induction/`; temporary `deployment-checks/` objects are not business records.

Restore a sample into a separate private recovery bucket, compare bytes and confirm unauthorized downloads are denied. Do not change the live storage provider or bucket as a test. This batch does not implement automatic bucket backup, record a completed restore drill, send Resend email or contact EOS.

## References

- PostgreSQL custom archives and selected-schema limitations: https://www.postgresql.org/docs/18/app-pgdump.html
- PostgreSQL restore lists and single-transaction behavior: https://www.postgresql.org/docs/18/app-pgrestore.html
