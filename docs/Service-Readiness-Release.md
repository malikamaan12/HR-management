# Service readiness and recovery — 19 September 2026

Status: implemented locally, not pushed or deployed. The live application remains `e99c47e`. This batch can be prepared while the owner supplies the actual employee import data.

## Delivered

- Settings and Operational setup share an administrator-only service status panel. It reports a real database probe, configuration errors and the current storage verification record. A failed status request has an explicit error state rather than appearing as missing configuration.
- Explicit Supabase private-storage verification checks a fresh synthetic object's upload, byte contents, signed attachment download, anonymous access denial and removal. A saved lease serializes checks across processes; a one-minute cooldown limits repeat probes. Results and activity records are persisted in existing tables. No employee object is read or deleted. Configuration fingerprints invalidate prior evidence after provider/credential changes.
- Cleanup retry accepts only the saved result timestamp. The stored synthetic key and original configuration select the object; arbitrary keys/URLs are rejected. Failed full-check status remains until another full check passes.
- Database backup uses existing Node and free PostgreSQL clients. It encrypts a streamed custom archive, refuses overwrites and Git destinations, checks archive authentication, and restricts restoration to an explicitly named empty loopback scratch database. PostgreSQL credentials remain outside command arguments and output. No production restore, scheduled backup or bucket export is implemented.
- The operator recovery guide is downloadable through an administrator-only, uncached endpoint. It explains separate private-file backups and the acceptance evidence still required.

## Validation

- TypeScript and production client/server builds passed. The existing approximately 632 kB main-client chunk warning remains.
- One combined focused run: **19 tests passed across three files**. It covers administrator-only access, recovery-guide access, sanitized outage/configuration responses, saved check/audit history, concurrent-run leases, cooldown, configuration changes, cleanup scope/stale requests, anonymous exposure, oversized responses, upload/read/cleanup failures, encrypted roundtrip, wrong passphrase, damaged archives, overwrite prevention, interrupted export cleanup, loopback/name/confirmation restrictions, child environment isolation, Git output restrictions and temporary plaintext cleanup.
- Provider calls in automated tests are mocked and route data is isolated in PGlite. PostgreSQL client executables are not installed on this workstation. An actual PostgreSQL custom-archive export/restore and Supabase probe must be completed separately before recording those services as accepted.
- No production data, configuration, email, storage objects or EOS endpoints were changed. No schema migration or paid dependency was added.

## Release and operating steps

Include this batch in the next consolidated release. After deployment, an administrator can run the explicit storage probe against the configured private bucket. Run the documented encrypted database backup and restore drill on a trusted operator machine with PostgreSQL tools. Preserve the archive and passphrase separately, and verify private-file recovery separately. Employee import, venue configuration and actual operating policy choices remain with the ongoing setup work.
