# E3 HR development and deployment setup

Use Node.js 24 (minimum 22.16) and pnpm 11.19.0. Install with `pnpm install --frozen-lockfile`. The checked-in `pnpm-workspace.yaml` allows only the locked esbuild install scripts and explicitly skips optional bufferutil compilation and the es5-ext notification script. Unknown dependency scripts still fail in CI; review the policy when updating dependencies. See [pnpm build settings](https://pnpm.io/settings/builds#allowbuilds).

1. Copy `.env.example` to `.env`. Set DATABASE_URL to an isolated PostgreSQL database, APP_URL to the app origin and APP_TIMEZONE to the company timezone (for example Asia/Qatar). Use separate random JWT_SECRET and JWT_REFRESH_SECRET values of at least 32 characters.
2. For a NEW empty database, run `pnpm db:migrate`. Existing databases require backup and schema reconciliation first; do not apply the initial migration or `db:push` blindly. Reconcile any previously applied manual SQL with the migration journal.
3. Create the first administrator explicitly: privately set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD, then run `pnpm admin:bootstrap`. Use a unique password of 12–72 bytes. The script refuses if any administrator exists. Remove the bootstrap password afterward. No default-password accounts are created.
4. Run `pnpm dev`. The app and API share PORT (default 5000). Create employee records, then use User Management to explicitly link accounts to employees. Roles and account IDs do not establish employee ownership.
5. Run `pnpm check`, `pnpm test` and `pnpm build`. Start the built app with `pnpm start`.

## Storage and email

For free hosting, set STORAGE_PROVIDER=supabase and configure SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY and SUPABASE_STORAGE_BUCKET. Copy the endpoint and region from the project's Storage S3 settings. Use a private bucket and keep S3 keys on the server: they bypass storage RLS. [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication).

Existing R2 deployments remain supported with STORAGE_PROVIDER=r2 (the default when unset), R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME. Changing providers does not copy existing files. Uploads use the authenticated server, validate PDF/PNG/JPEG signatures and are limited to 10 MB. Downloads require employee or case access and use 60-second signed attachment links. Keep either provider's bucket private. Legacy external document links require re-upload. Object storage holds files; PostgreSQL holds HR and workflow records.

Resend requires RESEND_API_KEY and EMAIL_FROM for an existing verified sender domain. Keep Resend on Free. Set APP_URL to the HTTPS production origin. On Render only, an unset APP_URL uses the platform's RENDER_EXTERNAL_URL; an explicit custom domain takes precedence. Production startup rejects invalid public origins. Password resets use hashed, one-time tokens. Storage/email tests use mocks; live delivery still needs verification. Never commit credentials or real employee data.

## Hosting

The Express server serves the React frontend and API together. `render.yaml` defines one Render Free Node web service in Frankfurt, with manual deployments, generated signing secrets and a database readiness probe. Supply DATABASE_URL from a NEW Supabase Free project's IPv4-compatible session pooler with TLS certificate verification enabled. Disable the Supabase Data API and automatic table exposure before migration; the app uses its own server authorization and direct SQL. Enable automatic RLS on new public tables as an additional safeguard. Do not grant anonymous access to HR tables.

The startup command is `pnpm db:migrate && pnpm start`; Free Render has no pre-deploy command or service shell. Run first-admin bootstrap locally against the same database after migration. The build installs the development dependencies needed by Vite and esbuild. No Render database, paid disk or paid worker is provisioned. Render's free database expires after 30 days and is not used. See [Deployment-Guide.md](docs/Deployment-Guide.md) and [Render Free](https://render.com/docs/free).

The budget is $0: keep Free plans, no card, paid add-ons or upgrades. Render sleeps after 15 minutes idle. Supabase can pause after one week idle and includes a 500 MB database and 1 GB file storage. Resend allows 3,000 emails monthly and 100 daily. This is an initial rollout with possible delays or interruptions. Check [Supabase pricing](https://supabase.com/pricing) and [Resend pricing](https://resend.com/pricing). Supabase Free has no automatic database backups; make private manual database and file backups and test restore.

Review business policies in Settings before accepting real HR records. Leave days use configured weekends; holiday calendars, automatic accrual, bank/WPS transmission, biometric hardware and WhatsApp are not implemented. Payroll payment references record externally completed payments. `/healthz` checks the HTTP process. `/readyz` returns 200 only when the database can read the users table, otherwise a generic 503. Neither probe verifies storage, email, administrator setup or every business workflow.
