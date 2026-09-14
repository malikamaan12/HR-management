# E3 HR deployment

Prepared on 14 September 2026. No hosting resource, live database, production administrator, or public URL has been created by preparing this file.

## Deployment target

Use the existing React + Express application on Render, with PostgreSQL for records, Cloudflare R2 for private files, and Resend for email. The root `render.yaml` provisions a NEW database; it must not be pointed at an existing HR database without backup and migration reconciliation.

The proposed resources are one `0.5c-512mb` web service ($7/month), one `0.1c-256mb` Postgres instance ($6/month), and 5 GB of database storage ($1.50/month): **$14.50/month for these resources**, plus the selected workspace plan, usage overages, taxes and any R2/Resend charges. This is a small initial deployment and needs capacity monitoring. Confirm the actual dashboard quote before purchase. [Current Render pricing](https://render.com/pricing).

Both resources use Frankfurt. Database public access is disabled; its internal connection string is injected into the web service. Deployments are manual. The database is PostgreSQL 17. Render generates the two JWT signing secrets. No credentials belong in Git. [Blueprint reference](https://render.com/docs/blueprint-spec).

## Release sequence

1. Authenticate Git for `malikamaan12/HR-management`. Check remote refs again. The prepared local release branch is `release/hr-foundation`; publish it as `main` without force or tags. Never publish the old development branch. If the remote gained unrelated commits, reconcile before pushing.
2. In the signed-in Render workspace, create a Blueprint from this repository's `main` branch. Review the web service, database, region and total price. Confirm these names do not belong to existing services before applying.
3. Render builds the frontend/server, then runs `pnpm db:migrate`. All eight migrations through `0007_assignment_reviews` must succeed before serving the release. A failed migration must be investigated; do not replace it with `db:push`.
4. Wait for a successful deploy and confirm `/readyz` returns 200. Its query verifies access to the users table. The app uses Render's assigned HTTPS origin; set APP_URL explicitly when a custom domain is attached.
5. In the service shell, set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD privately, then run `pnpm admin:bootstrap`. Use the owner's real email and a unique password of 12–72 bytes. The script refuses an existing administrator. Remove the bootstrap password from the shell/environment immediately afterward. No default administrator is shipped.
6. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME to the service environment. Keep R2 private. Add RESEND_API_KEY and EMAIL_FROM after the sender domain is verified. Redeploy to apply changes. Without these values, uploads and password-reset email remain unavailable.
7. Validate HTTPS sign-in, refresh/logout, company settings, employee-account links, a disposable shift/timesheet/review workflow, and role restrictions. With explicit approval to send the verification email, test password reset to the owner's address; validate private R2 upload and download. Remove disposable records through supported application flows. Confirm managed database backups and recovery before entering real HR records.
8. Record the actual live URL, service/database identifiers, exact Git revision and validation results. A successful build or `/healthz` alone is not proof that a usable HR application is live.

## Operations

- `/healthz` is process liveness. `/readyz` is uncached database readiness and returns a generic 503 during an outage. It does not check first-admin creation, all migrations, or external vendors.
- Use a database backup before schema changes. Render's deploy rollback changes application code; it does not reverse PostgreSQL migrations. Review backward compatibility before rollback.
- Changing JWT secrets signs users out. Change APP_URL when changing domains, and recheck reset links and secure cookies.
- EOS and WhatsApp remain outside this deployment. Existing feature limitations are listed in `IMPLEMENTATION-STATUS.md`.
