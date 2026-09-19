# HR letters and service readiness deployment — 19 September 2026

Application commit `eb3fb5cc490c02a40020d4f45cb80a7614b03f76` is live at [e3-hr.onrender.com](https://e3-hr.onrender.com). It includes the HR Letter Centre and the preceding administrator service-readiness/encrypted-recovery tools. Both commits were pushed to `malikamaan12/HR-management` on `main` before deployment.

## Deployment evidence

- Existing Render **Free** service: `srv-dajuem0jo6nc73fb36r0`. No hosting plan, environment, build/start command or automatic-deployment setting was changed.
- [Deployment `dep-dan3mm6k1f9s73fb2p5g`](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dan3mm6k1f9s73fb2p5g) was started manually with the exact tested commit at **10:35:52 GMT+3**.
- Render checked out the expected commit from the selected repository. The locked dependency install and client/server build passed at **10:36:24**. The existing client chunk-size warning remains.
- Startup ran `pnpm db:migrate && pnpm start`; **Database migrations completed** appeared at **10:37:01**. This release adds migration `0042_hr_letters.sql`; older migrations are unchanged.
- The server started on port 10000 at **10:37:19**. Render reported **Deploy succeeded / Live** at **10:37:27**, duration **1m35s**.

## Live acceptance

- `/healthz`: HTTP 200, `ok`; `/readyz`: HTTP 200, `ready`.
- `/`: HTTP 200 and the expected client asset `/assets/index-UMlj6Iof.js`.
- Signed-out `/api/hr-letters/context` and `/api/settings/system-readiness`: HTTP 401.
- The signed-in administrator opened **HR Letter Centre**, its HR queue, the template catalogue and the template editor. The new tables returned empty results without errors. Employment confirmation, compensation statement and general HR letter starting points were present. No template, request, letter or employee was saved during acceptance.
- **Settings → Service readiness & recovery** loaded successfully and reported a verified database connection, configured public URL and `Asia/Qatar` timezone. Supabase credentials are configured, but no completed storage verification is recorded. Resend API key and sender email are still missing; the restore drill is still pending.

The earlier local checks remain recorded in [HR-Letters-Guide.md](HR-Letters-Guide.md) and [Service-Readiness-Release.md](Service-Readiness-Release.md). This deployment acceptance checks startup, access barriers and the deployed screens; it does not represent a real employee approval, email delivery, storage probe or backup restore drill. No new database backup or restore was performed during this deployment. No production business configuration or employee data was edited.

Next operating steps: publish company-approved letter templates, configure authorized independent HR reviewers, import the actual employee records when ready, and complete provider/recovery acceptance separately. No paid service was added.
