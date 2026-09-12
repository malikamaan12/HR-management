# E3 HR development and staging setup

Use Node.js 24 (minimum 22.16) and pnpm 11.19.0. Install with `pnpm install --frozen-lockfile`.

1. Copy `.env.example` to `.env`. Set DATABASE_URL to an isolated PostgreSQL database, APP_URL to the app origin, and APP_TIMEZONE to the company timezone (for example Asia/Qatar). Use separate random JWT_SECRET and JWT_REFRESH_SECRET values of at least 32 characters.
2. For a NEW empty database, run `pnpm db:migrate`. This applies the checked-in migrations with Drizzle's migration journal. Existing databases require backup and schema reconciliation first; do not apply the initial migration or `db:push` blindly. If the initial SQL was previously applied manually, reconcile migration history before running the migrator.
3. Create the first administrator explicitly: set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD in the server environment, then run `pnpm admin:bootstrap`. Use a unique password of 12–72 bytes. The script refuses if any administrator exists. Remove the bootstrap password afterward. No default-password accounts are created.
4. Run `pnpm dev`. The app and API share PORT (default 5000). Create employee records, then use User Management to explicitly link accounts to employees. Roles and account IDs do not establish employee ownership.
5. Run `pnpm check`, `pnpm test`, and `pnpm build`. Start the built app with `pnpm start`.

## Storage and email

R2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME. Keep the bucket private. Document uploads go through the authenticated server, validate PDF/PNG/JPEG signatures, and are limited to 10 MB. Downloads require employee access and use 60-second signed attachment links. Existing external document URLs must be re-uploaded. R2 stores files; PostgreSQL stores employee, payroll and workflow records. See [Cloudflare's S3 SDK documentation](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

Resend requires RESEND_API_KEY and EMAIL_FROM for a verified sender domain. Set APP_URL to the HTTPS production origin. Password reset links use hashed, one-time tokens and the reset page. Email and R2 integration tests use mocks; live delivery still needs staging verification. Never commit credentials or actual employee data.

## Hosting

The Express server serves the React frontend and API together. `render.yaml` is a staging template with manual deployments, a health check, server secrets, and a pre-deploy migration command. Supply an isolated PostgreSQL database URL and select the desired service region/plan in Render before applying the template. Creating the file does not provision or deploy anything. See [Render Blueprint reference](https://render.com/docs/blueprint-spec).

Review database backup/restore, migrations and the business policies in Settings before accepting real HR data. The app currently calculates leave days from configured weekends; it does not implement holiday calendars, automatic accrual, bank/WPS transmission, biometric hardware or WhatsApp. Payroll payment references record externally completed payments. `healthz` checks the HTTP process, not database or vendor readiness.
