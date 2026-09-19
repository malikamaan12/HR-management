# Combined validation — 19 September 2026

Scope: option 3 from the release plan, covering the current application plus the local payroll (`d0ae3ff`) and operational setup (`9e06370`) batches. This work is local. It does not change the deployed revision or publish real company configuration.

## Changes

- Dashboard shortcuts and cards now follow the existing role permissions. Supervisor and HR dashboards no longer offer administrator security actions or request restricted organization-wide activity logs. Event, document and attendance cards also check the relevant access. Server permissions are unchanged.
- Updated regression fixtures for strict leave inputs, versioned leave cancellation, the mandatory onboarding compensation package, business-calendar helpdesk deadlines, archived document counts and explicit attendance review grants. Negative assertions remain for forged input, unauthorized review and stale decisions.
- Migration tests use the same Drizzle node-postgres migrator as production, with a PGlite adapter for simple multi-statement queries. The old PGlite prepared-query driver rejected valid migration SQL. No deployed migration files or hashes were edited. Fresh install, repeat execution and upgrades through journal indexes 25, 26, 27, 28, 38 and 41 are checked with retained records.
- Added isolated workflow tests for induction, geofencing, attendance approvals, half-day leave, equipment, handbook, employment, retention and automation.
- Expanded the disposable local preview to include administrator, independent reviewer, HR, supervisor and employee accounts. It uses an in-memory database, ephemeral credentials and loopback-only access; it removes production provider credentials and does not load the production environment.

## Validation

Final combined test result: **350 tests passed across 28 files**, with no failures or skipped tests, in 191.59 seconds. Command: `npm run test -- --reporter=default --reporter=json --outputFile=dist/combined-validation-results.json`. The full log and JSON report are local ignored artifacts in `dist/`. Expected authentication and rollback error messages from negative tests are not failures.

TypeScript and production client/server builds passed. The existing Vite warning about the approximately 632 kB main chunk remains a performance follow-up, not a build failure.

The new scenarios check:

| Area | Verified behavior |
| --- | --- |
| Induction | Private answer keys, required lessons, server scoring, independent review, certificates, retry delay, attempt limits, timeouts, required-onboarding blocking and immutable course releases |
| Geofencing | Coverage required before activation, admin-only enforcement, HR boundary editing, missing/stale/future/inaccurate/outside GPS rejection and preserved boundary snapshots |
| Attendance | Temporary staff require independent review after clock-out; stale or repeated review cannot overwrite the decision |
| Leave | Exact half-day reservation/debit, ordered independent approval stages, complementary half-days, overlap rejection and clock-in outside approved leave |
| Equipment | Employee-only receipt, independent return inspection, competing issues, version conflicts and history rollback |
| Handbook | Draft privacy, immutable editions, exact-content acknowledgement, read prerequisite and retained prior acknowledgements |
| Employment | Independent approval, explicit application, stale profile rejection, reviewed service periods and overlap protection |
| Retention | Holds, policy changes, independent review, reversible archive/restore and preserved file references |
| Reminders/helpdesk | In-app delivery, deduplication, inactive/archived exclusions, business hours/holidays and confidential escalation scope |

## Browser verification

Used the actual built client and application routes against the disposable preview; no production records were created or changed.

- Administrator: operational readiness, six published safety courses, required-course publishing from release 1 to release 2, and embedded leave configuration. Security/activity controls remain available after the dashboard fix.
- Employee: own dashboard, safety catalogue, self-enrollment, opening a lesson and saved lesson completion; later required lessons and the quiz remain gated. Direct access to operational setup displays the administrator restriction.
- Supervisor: team overview shows only the assigned team, upcoming coverage and approval queues; dashboard headcount is scoped to self/direct report. Unauthorized dashboard shortcuts and activity panel are absent after the fix.
- HR: equipment registration saves the synthetic inventory item and history. Administrator security/activity controls are absent.

## Remaining release and operational work

1. Consolidated push/deploy is the next release step. These results describe the local revision only.
2. Enter actual employees, compensation, work sites/radii, supervisors, leave approvers and required training choices. Activate geofencing only after valid coverage exists.
3. Perform a real-device location and supervisor attendance check at a configured venue, and an owner-led payroll acceptance run using the approved business rules.
4. Production storage connectivity, Resend delivery, backup restoration and EOS integration are separate checks. No external email, WhatsApp or EOS calls were made in this batch.

This is a regression and role-based browser validation pass, not exhaustive acceptance of every screen, browser, device, integration or operating policy. PGlite verifies PostgreSQL behavior locally but does not exercise the hosted Supabase network/driver connection. No paid dependency or service was added.
