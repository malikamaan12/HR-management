# Reports & Analytics deployment — 19 September 2026

Application commit `1436980a86fbc419d68ce6ff14a938de836e5b59` is live at [Reports & Analytics](https://e3-hr.onrender.com/reports). It was pushed to `malikamaan12/HR-management` on `main`, then deployed manually to the existing Render Free service.

## Deployment evidence

- Service: `srv-dajuem0jo6nc73fb36r0`; the free plan, provider configuration, build/start commands and manual-deployment setting were preserved.
- [Deployment `dep-dan5leugekts73fq0di0`](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dan5leugekts73fq0di0) began at **12:49:47 GMT+3** on 19 September 2026 with the exact tested commit selected.
- Render checked out `1436980a86fbc419d68ce6ff14a938de836e5b59`. Frozen-lockfile installation and client/server builds passed. The build finished at **12:50:16**; its existing main-bundle size warning remains.
- Startup ran `pnpm db:migrate && pnpm start`. **Database migrations completed** appeared at **12:50:55**. This release registers additive migration `0044_reports_analytics_workspace.sql`; prior deployed migration files are unchanged.
- The application began serving on port 10000 at **12:51:13**. Render reported **Deploy succeeded / Live** at **12:51:19**, duration **1m32s**.

## Live acceptance

- `/healthz`: HTTP 200, `ok`; `/readyz`: HTTP 200, `ready`.
- `/`: HTTP 200, serving expected release asset `/assets/index-Dp02AYjy.js`; Render also built `/assets/Reports-CfbQaRac.js`.
- Signed-out `/api/reporting/snapshots/catalog` and `/api/reporting/snapshots/runs`: HTTP 401.
- Signed-in administrator: all **20 report types** loaded. Saved views, schedules and run history loaded their empty states successfully. Reporting rules loaded default version 0 with the average-endpoint turnover denominator, 5,000-row cap, minimum performance sample of 5 and scheduled reporting enabled. No browser application errors were recorded.
- Live acceptance was read-only: no report snapshot, view, schedule, rule or employee record was created or changed. Existing user tabs were preserved.

The [implementation guide](Reports-Analytics-Guide.md) records 54 distinct passing reporting/migration checks, TypeScript/build checks and isolated administrator/supervisor browser verification. Actual PDF save/print acceptance remains separate. Scheduled reports run while the existing free service is awake and may be delayed by free-host sleep. No paid service was added.
