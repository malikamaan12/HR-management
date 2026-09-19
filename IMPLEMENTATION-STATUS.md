# E3 HR module status — 19 September 2026

Latest local batch: **Internal Communication Hub** replaces Slack and the placeholder announcement/inbox screens with scoped direct messages, private groups, assignment-based workforce channels, private attachments, replies/mentions/unread state, published announcements with explicit acknowledgements, and administrator-managed rules. Migration 0043 is registered; no paid dependency was added. The combined 52-test run, TypeScript, production build and isolated administrator/employee browser checks passed; the final compatibility access fix has focused coverage. **This batch is not pushed or deployed.** The live revision remains `eb3fb5c`. See [Internal-Communication-Hub-Guide.md](docs/Internal-Communication-Hub-Guide.md) for scope, access and operating limits.

Latest deployment: **HR Letter Centre and service readiness/recovery tools are live** in application commit `eb3fb5cc490c02a40020d4f45cb80a7614b03f76`, Render Free deployment `dep-dan3mm6k1f9s73fb2p5g`, at 10:37:27 GMT+3 on 19 September 2026. Build and startup migrations passed, public health/readiness returned HTTP 200, the expected client asset was served, and authenticated letter/template/service-status screens loaded. No production business records or settings were changed. Resend configuration, a recorded storage probe and a backup restore drill remain pending. See [HR-Letters-Deployment.md](docs/HR-Letters-Deployment.md). This supersedes the local-only status of the two batches below.

Latest local addition: **HR Letter Centre** now includes administrator-managed versioned templates, employee requests, scoped HR preparation, independent issue, correction/cancellation/rejection, printable issued copies and revocation. Employment and compensation letters use saved records and dated salary components. Nineteen combined workflow/migration tests, TypeScript, production builds and a focused synthetic browser check passed. Additive migration 0042 is registered locally. This batch is not pushed or deployed and adds no paid service or dependency. See [HR-Letters-Guide.md](docs/HR-Letters-Guide.md).

Previous local addition, also awaiting release: administrator service readiness, an explicit private-storage verification/cleanup workflow, and encrypted database backup plus isolated restore tools are implemented. The focused 19 tests, TypeScript and production build passed. No actual provider probe or PostgreSQL restore drill has been completed. It adds no migration, dependency or paid service. See [Service-Readiness-Release.md](docs/Service-Readiness-Release.md).

Latest release: application commit `e99c47e96cf8ae4855fe974627fbcff06cf7928a` is deployed on Render Free as of 19 September 2026 at 08:59:19 GMT+3. Daily/per-assigned-event-shift pay, configurable unpaid-leave deductions, administrator operational setup and the dashboard permission fix are live. The combined run passed all 350 tests across 28 files, TypeScript and production builds; local browser checks covered administrator, HR, supervisor and employee roles. Live health/readiness, the expected client asset and authenticated setup/payroll screens passed. See [the validation and deployment record](docs/Combined-Validation-Release.md). Actual staff, boundaries, supervisors and company policies still need configuration; live readiness shows 0 active employees and 3 sites.

The following entries describe the earlier deployment baseline and its original verification scope; the latest record above supersedes their test-deferral and release status.

The combined HR module release is live at [e3-hr.onrender.com](https://e3-hr.onrender.com) on the existing Render Free service in application commit `b199199171094d1679d4b67cf1839989f60cf4f3`. It includes equipment, handbook, employment/service history, retention, helpdesk automation, recurring workforce/evidence, performance participation, advanced leave and configurable reminders, together with the internal induction academy, six editable safety courses, attendance geofences and supervisor approvals, and complete onboarding salary/benefit packages. No new paid service or dependency was added.

**Deployment completed on 19 September 2026 at 01:59:46 GMT+3.** TypeScript and client/server production builds passed; startup migrations completed at 01:59:21. Public health/readiness returned HTTP 200, the application root served the expected client asset, and the authenticated Learning Safety course library showed all six published courses. No employee enrollment or completion was fabricated. Full functional testing and audit remain deferred; real location setup and geofence activation remain operational tasks. See [the deployment release record](docs/Safety-Attendance-Compensation-Release.md). This latest note supersedes earlier build, migration and deployment deferral entries; historical notes below retain their original release context and do not establish full functional acceptance of this batch.

## Previous deployment baseline

The requested attendance/leave → payroll → recruitment/onboarding/offboarding implementation is complete for the core workflows described below. The combined release is deployed at [e3-hr.onrender.com](https://e3-hr.onrender.com), with the latest team tasks, reporting and reminders code in revision `f69d238`. Administrators manage changing company policies and employee-specific overrides in **HR Rules**; effective dates and saved snapshots preserve history.

## Current status

| Module | Status | What works |
| --- | --- | --- |
| Employee records | Core foundation implemented | Scoped directory, private fields, manager validation, conflict-safe edits, effective lifecycle history, controlled termination/reactivation, account links and versioned documents. |
| Attendance | Core workflow deployed | Clock/breaks, overnight clock-out, calendars/holidays/grace, roster comparison, reviewed corrections and CSV reports. |
| Leave | Core workflow deployed | Configurable entitlements/accrual/carryover, balance ledger, pending reservations, approvals, cancellations/refunds and calendar. |
| Payroll | Core workflow deployed | Dated salary/hourly rules, approved time lines, overtime, adjustments, independent approval, regeneration, payslips, reconciliation and external payment references. |
| Recruitment | Core workflow deployed | Requisition approval, candidates, screening, interviews/results, offers/responses and transactional employee handoff. |
| Onboarding/offboarding | Core workflow deployed | Reusable checklists, owners/deadlines, document/asset evidence, completion, cancellation and employee/account deactivation. |
| Workforce | Core workflows and roster enhancements deployed | Scoped scheduling, recurring rosters, shift revisions with fresh consent, one-off/weekly unavailability, verified qualifications and renewals, replacement staffing, membership history, incidents and mobile arrival/departure with dated rules. |
| Timesheets and assignment reviews | Core workflows deployed | Approved time, rubric-based reviews/disputes and team overview. |
| HR helpdesk | Core workflow and support operations deployed | Confidential cases, messages/files/history, dated company and employee routing rules, response targets, overdue queue, explicit escalation and searchable versioned knowledge articles. |
| Performance and development | Core review cycle deployed | Configurable weighted criteria/rating labels, employee deadlines, self-assessment, assigned manager review, independent HR calibration/publication, acknowledgement, objectives/development actions and scoped reports with sample counts. |
| Documents and reports | Core reporting workflow deployed | Private upload/download, document versions, scoped renewal requests and independent review; headcount, attendance, turnover, leave, staffing-cost and compliance reports with site/team/department filters, reconciled totals, saved views, drill-down rows and CSV/PDF export. |
| HR Letter Centre | Deployed; startup and administrator screens verified | Versioned administrator templates, scoped employee requests, dated employment/compensation snapshots, independent HR issue, corrections, cancellation, rejection, printable copies, revocation and history. |
| Learning, benefits and expenses | Core workflows implemented | Learning catalogue/enrolment/completion certificates; configurable benefit entitlements and approvals; itemised expenses, private receipts, approvals and reimbursement references. |
| Team lead dashboard | Core workflow deployed | Scoped team overview includes staffing coverage, leave/time/review queues, a unified approval queue, and task ownership with owner assignment and open/in-progress/completed tracking. |

See [the workflow and configuration guide](docs/Attendance-Payroll-Lifecycle-Guide.md) for operating instructions, calculation conventions and legacy-data reconciliation. See [the module checklist](docs/MODULE-COMPLETION-CHECKLIST.md) for the remaining backlog.

## Earlier backlog, superseded by the 19 September batch handoff

1. **Business setup:** configure actual company/employee rules and assign operational roles before entering employee records. Deployment and database migrations are complete. Migrations 0015–0024 are new in this combined release; deployed migrations 0000–0014 are preserved. No production demonstration records were added.
2. **Workforce enhancements:** whole-series roster changes, external certificate validation/evidence uploads and device/offline attendance integrations. Weekly unavailability, date exceptions, qualification renewal due lists, configurable reminder windows and HR verification are now implemented alongside the earlier staffing workflows.
3. **Performance and helpdesk extensions:** core review cycles, objectives/development plans, calibration, routing, response targets, explicit escalation and knowledge articles are now implemented. Bulk review assignment/participant withdrawal, automated reminders/escalation and business-hour target calendars remain optional extensions. See [the operating guide](docs/Performance-Helpdesk-Guide.md).
4. **Documents and reports:** production file-delivery acceptance and retention automation remain. Site/team filters, reconciled totals, saved report views and exports are implemented.
5. **Learning, benefits and expenses:** optional extensions include LMS synchronisation, automated reminders, payroll deductions and country-specific benefit/tax rules. Core request, approval, evidence, entitlement and reimbursement workflows are implemented in migration 0024.
6. **Integrations:** EOS API adapter, verified Resend sender and live delivery, WhatsApp/biometric devices, and bank/WPS submission. These remain separate work.

The current release supports full-day leave and monthly payroll. Half-day leave, multi-stage approvals, automatic unpaid-leave deductions, statutory tax/EOS calculations and country-specific payslip/WPS formats require additional policy options or integrations. The UI records external payment references and does not transfer funds.

## Release validation — 16 September 2026

The combined release contains both the existing live document renewal, employee lifecycle, calculation-rule and skill controls and the new operational modules. TypeScript and both production builds passed. Across the full suite and the focused fixture-correction rerun, all 211 tests in 16 suites pass. The existing frontend bundle-size warning remains.

A private read-only snapshot of 88 application/migration tables (362 rows) was saved outside Git. All 15 pre-existing migration hashes match the preserved SQL after normalizing Windows line endings. The snapshot was restored in isolated PGlite, migrations 0015–0024 were applied, and every existing application table retained its row count. Production had no employee, leave, payroll, document or workforce-team records at backup time. No production demonstration records were added.

Group calculation rules continue to control attendance/timesheet rounding, paid breaks, leave counting/holiday exclusions and payroll rounding. New HR Rules supply dated company or employee entitlements, calendars, pay rates and approvers. Attendance corrections preserve calculation snapshots and require independent approval; payroll adjustments retain the generated period snapshot.

See [Deployment-Guide.md](docs/Deployment-Guide.md) for the exact live revision and deployment acceptance. External email, device and bank integrations remain separate configuration/work.

Deployment succeeded on 16 September 2026 at 18:46 Asia/Qatar for revision `f69d238` (team task ownership, advanced reporting and operational reminders). Render startup confirmed `Database migrations completed`, and the service reported live at the primary URL.
