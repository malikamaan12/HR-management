# E3 HR free deployment

18 September 2026 lifecycle release candidate: versioned checklist templates, administrator review rules and independent task approvals are ready for the existing service. See [LIFECYCLE-REVIEW-RELEASE.md](LIFECYCLE-REVIEW-RELEASE.md).

18 September 2026: reviewed CSV imports, employee correction requests and administrator document review rules are live in commit `1d0013344a636aecc31ce32b640b79d4399405aa`. Render deployment `dep-dammk3ou01pc73ardpp0` succeeded, startup migrations completed, and public health/readiness plus authenticated workflow screens passed verification. See [EMPLOYEE-DOCUMENT-REVIEW-RELEASE.md](EMPLOYEE-DOCUMENT-REVIEW-RELEASE.md).

18 September 2026: reporting snapshots, candidate corrections and shared event/FEC navigation are live in commit `d64f3c21fef5c2bd838b7a9f31b6911f8597b4e8`. Render deployment `dep-damm7usri2ms73drt3ig` succeeded, startup migrations completed, and `/healthz` plus `/readyz` returned HTTP 200. See [REPORTING-CORRECTIONS-RELEASE.md](REPORTING-CORRECTIONS-RELEASE.md) for validation and branch compatibility limits.

Updated 18 September 2026. The existing Free service is live at [e3-hr.onrender.com](https://e3-hr.onrender.com), sourced from `malikamaan12/HR-management` on `main`. The employee/document review release extends reporting and candidate corrections in `d64f3c2`. Production had no employee records at this release's read-only check; no demonstration employees were added. The existing administrator and private storage remain configured; Resend sender setup remains pending. Automatic deployments remain off.

## Budget and services

The budget is **$0**. Use Render Free for the existing React + Express app, Supabase Free for PostgreSQL and private files, and Resend Free for email. Do not add a card, paid add-ons or upgrades. Use Render's assigned HTTPS address and an already-owned verified sender domain. If no sender domain is available, email remains pending; do not buy a domain.

The root `render.yaml` creates only one Free web service in Frankfurt. It creates no Render database, persistent disk or worker. Migrations run at startup because Free services lack pre-deploy commands and a service shell. Render's free PostgreSQL expires after 30 days and is not used. [Render Free](https://render.com/docs/free), [deploy commands](https://render.com/docs/deploys).

Free plan limits checked on 14 September 2026:

| Service | Allowance or limitation |
| --- | --- |
| Render Free | Sleeps after 15 minutes idle; restart can take about a minute. 750 Free instance hours per workspace monthly. No persistent local file storage or service shell. |
| Supabase Free | 500 MB database, 1 GB files, 5 GB egress plus 5 GB cached egress. Can pause after one week idle; no automatic database backups. |
| Resend Free | 3,000 emails monthly, at most 100 daily; verified sender domain required. |

Check dashboards for current limits and usage. Quotas can interrupt service; these plans are not an always-on service commitment. Do not generate artificial traffic to evade sleep or pause policies. [Supabase pricing](https://supabase.com/pricing), [Resend pricing](https://resend.com/pricing).

## Prepare Supabase

1. Create a dedicated project in a Free organization, preferably Frankfurt to match Render. Generate and privately save a strong database password. Keep Free and do not add a card.
2. **Before migration, disable Enable Data API and Automatically expose new tables.** Enable automatic RLS on new public tables. The app uses its own Express authorization and direct PostgreSQL connection, not Supabase Auth or browser database access. The server's database owner can access its tables with RLS enabled. Do not add anonymous policies or grants on HR tables. Verify Data API stays disabled after creation. [Data API security](https://supabase.com/docs/guides/api/securing-your-api).
3. In Connect, choose **Session pooler** (port 5432) and copy its exact connection string. This supports IPv4; the direct database endpoint may require IPv6. Substitute the saved password with URL encoding and retain TLS certificate verification, for example `sslmode=verify-full`. If the platform requires its database CA, configure the provided certificate as trusted; do not disable verification. Never put the connection string in Git, chat, frontend variables or logs. [Connection options](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. Create a **private** Storage bucket such as `private-hr`. Enable S3 access and create server-only S3 credentials. These bypass RLS and access all project buckets, so use a dedicated HR project. Copy the exact endpoint, region, access key ID and secret into Render's server environment. Do not substitute the anonymous/publishable project key. [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication).

## Publish and deploy

1. Publish reviewed changes to the user-selected `malikamaan12/HR-management` repository on `main` without force or tags. The latest release was reconciled on `release/reporting-corrections`. Check remote refs and reconcile unexpected commits first. The older `enhance/admin-calculation-rules` branch has a different migration history and must not replace live main. A different repository destination needs the owner's choice.
2. Use the existing Render Free service `srv-dajuem0jo6nc73fb36r0`; its source is connected to the selected repository's `main` branch. Use Manual Deploy to select the tested commit. Keep the existing environment, Free instance, build/start commands and `/readyz` health check. The root `render.yaml` documents the service; no additional database, disk or worker is required. For a new installation only, supply DATABASE_URL from Supabase's session pooler and distinct signing secrets; do not use example values.
3. The build installs locked dependencies and builds client/server. Each start runs `pnpm db:migrate && pnpm start`. All migrations through `0028_lifecycle_review_templates` must succeed before serving. The journal has passed empty-database, safe-rerun and prior-live upgrade tests, but failed real migrations still need investigation. Do not substitute `db:push`. Existing databases need backup and reconciliation first.
4. Wait for deployment and a 200 response from `/readyz`. The app uses Render's assigned HTTPS origin. Set APP_URL for an existing custom domain; do not copy the localhost value from `.env.example` into production.
5. After migration, run `pnpm admin:bootstrap` **locally** against the same database. Privately supply DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD for that process. Use the owner's real email and a unique password of 12–72 bytes. The script refuses an existing administrator. Remove the bootstrap password afterward. No default administrator is shipped.
6. Set STORAGE_PROVIDER=supabase and these server variables: SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY and SUPABASE_STORAGE_BUCKET. Keep the bucket private. Add RESEND_API_KEY and EMAIL_FROM for the existing verified sender, on Resend Free. Redeploy after environment changes. Missing credentials leave uploads or reset email unavailable.
7. Verify HTTPS sign-in, refresh/logout, settings, employee-account links and role restrictions. Exercise a disposable shift, timesheet and review workflow. Test private employee/helpdesk uploads and downloads, including denied unauthenticated access. Obtain explicit permission before sending a real password-reset test email to the owner. Remove disposable records through supported app flows.
8. Record the live URL, service/project identifiers, exact Git revision and test results. A build or `/healthz` alone does not prove a usable app. Test a manual backup and restore before accepting real HR records.

## Learning, benefits and expenses release — 16 September 2026

The release adds migration `0024_learning_benefits_expenses` and these scoped routes: `/api/learning`, `/api/benefits` and `/api/expenses`. Learning stores course versions, enrollment snapshots, completion evidence and independently verified certificates. Benefits stores dated employee/company policies, annual reservations, approvals and activation references. Expenses stores itemized claims, private receipts, policy snapshots, approvals and reimbursement references. All policy and request changes retain versioned audit history.

Validation completed before deployment: 211 tests across 16 suites passed, TypeScript passed, and production frontend/server builds passed. The focused service suite contains 9 tests; migration rerun checks passed. No production demonstration records are created by this release.

## Learning, benefits and expenses deployment acceptance — 16 September 2026

- Git revision: `80eb010d60cfcddf8d67f48887aa60ba45425685`; manual Render deployment: [dep-dal8pkoae00c73furgc0](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dal8pkoae00c73furgc0).
- Render: **Deploy succeeded**; startup log confirmed `Database migrations completed` and the service is live at `https://e3-hr.onrender.com`.
- Public readiness: `/readyz` returned HTTP 200.
- Authenticated smoke checks: `/learning` (course catalogue and enrolments/approvals), `/benefits` (requests, eligibility/balances and admin rules), and `/expenses` (itemised claims, receipts, approvals and reimbursement states) loaded with the expected controls. No operational records were created.

## Dashboard and reporting deployment acceptance — 16 September 2026

- Git revision: `7e642dabdf4b882493ce65d9d5a70e9044f87a0d`; manual Render deployment: [dep-dal901ajnfac73csja1g](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dal901ajnfac73csja1g).
- Render: **Deploy succeeded**; startup log confirmed `Database migrations completed` and the service is live at `https://e3-hr.onrender.com`.
- The release adds the unified Team Overview approval queue and the Attendance summary report with date/department filters and row-level drill-down output.

## Absence coverage deployment acceptance — 16 September 2026

- Git revision: `de6c4d10baf4dd7604605c0380644bce9dedcbbe`; manual Render deployment: [dep-dal97u67bikc73eqebo0](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dal97u67bikc73eqebo0).
- Render: **Deploy succeeded**; startup log confirmed `Database migrations completed` and the service is live at `https://e3-hr.onrender.com`.
- Team Overview now lists approved leave overlapping accepted shifts in the next 14 days, with links back to roster management.

## Team tasks, advanced reporting and operational reminders deployment acceptance — 16 September 2026

- Git revision: `f69d23839ddc99d9cd8a59a1893f82046adcfec4`; manual Render deployment: [dep-dalbinmk1f9s73fld980](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dalbinmk1f9s73fld980).
- Render: **Deploy succeeded**; startup log confirmed `Database migrations completed` and the service is live at `https://e3-hr.onrender.com`.
- Team Overview supports owner assignment and open/in-progress/completed action tracking. Reports support site/team filters, reconciled totals, saved views and CSV/PDF exports. Reminder runs cover pending approvals, document/leave expiry and training due dates with in-app deduplication.

## Operations

- Keep Free accounts without a payment method. Check quotas before imports or uploads. The app limits files to 10 MB each, but total storage is shared across the project.
- `/healthz` is process liveness. `/readyz` is uncached database readiness and returns a generic 503 during outages. It does not check all migrations, administrator setup, storage or email. Settings reports configuration presence, not successful vendor connectivity.
- Resume paused services in their dashboards. Do not upgrade automatically to solve quota or sleep limits.
- Make private manual database backups and separate file backups. A database dump holds file references rather than file contents. Test restore before depending on backups.
- Back up before schema changes. Render code rollback does not reverse PostgreSQL migrations; review schema compatibility first.
- Existing R2 deployments remain supported with STORAGE_PROVIDER=r2 and their R2 variables. Switching providers does not migrate files; verify a controlled file migration before changing a populated deployment. R2 activation is outside this $0 setup.
- Changing JWT secrets signs users out. Update APP_URL when changing domains and recheck reset links and cookies.
- EOS, WhatsApp and remaining advanced workflows are listed in `IMPLEMENTATION-STATUS.md`; deployment does not complete them.

## Combined module release preparation — 16 September 2026

The release merges the existing live branch into the new HR modules, preserving deployed migrations 0000–0014 and appending 0015–0023. A private read-only snapshot of 88 application/migration tables (362 rows) was saved outside Git. All deployed SQL hashes were verified (LF normalization), the snapshot restored in isolated PGlite, and the full upgraded journal preserved every existing application table row count. No employee, leave, payroll, document or workforce-team data needed legacy reconciliation. TypeScript, production frontend/server builds and 202 tests across 15 suites pass, including the focused correction-fixture rerun. Render deployment acceptance is recorded after the release below.

## Combined module release acceptance — 16 September 2026

- Git revision: `c2727e773519d1677140175d97512e590dd9253a`; manual deployment https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dakrlnm7bikc73fo8j00.
- Render: Deploy succeeded, duration 1m34s; startup logs confirmed Database migrations completed.
- Production journal: 24 entries, all hashes matched; public readiness: HTTP 200.
- Authenticated pages: review-cycle empty state and create control, helpdesk knowledge/routing controls and queue, document renewal queue. These read-only checks added no operational data.
- Live integrations beyond configured database/storage were not activated. Actual company and employee rules are configured in HR Rules and group Calculation Rules.
