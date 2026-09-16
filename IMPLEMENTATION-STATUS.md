# E3 HR module status — 16 September 2026

The requested attendance/leave → payroll → recruitment/onboarding/offboarding implementation is complete for the core workflows described below. The combined release is deployed at [e3-hr.onrender.com](https://e3-hr.onrender.com), with the latest Learning/Benefits/Expenses code in revision `80eb010`. Administrators manage changing company policies and employee-specific overrides in **HR Rules**; effective dates and saved snapshots preserve history.

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
| Documents and reports | Document renewal core implemented; reporting enhancements remain | Private upload/download, document versions, scoped renewal requests and independent review; base exports and scoped reporting. Retention automation and reporting refinements remain. |
| Learning, benefits and expenses | Core workflows implemented | Learning catalogue/enrolment/completion certificates; configurable benefit entitlements and approvals; itemised expenses, private receipts, approvals and reimbursement references. |
| Team lead dashboard | Partial | Scoped team overview includes leave, time and assignment review queues; further unified approvals and operational drill-downs remain. |

See [the workflow and configuration guide](docs/Attendance-Payroll-Lifecycle-Guide.md) for operating instructions, calculation conventions and legacy-data reconciliation. See [the module checklist](docs/MODULE-COMPLETION-CHECKLIST.md) for the remaining backlog.

## What remains

1. **Business setup:** configure actual company/employee rules and assign operational roles before entering employee records. Deployment and database migrations are complete. Migrations 0015–0024 are new in this combined release; deployed migrations 0000–0014 are preserved. No production demonstration records were added.
2. **Workforce enhancements:** whole-series roster changes, external certificate validation/evidence uploads and device/offline attendance integrations. Weekly unavailability, date exceptions, qualification renewal due lists, configurable reminder windows and HR verification are now implemented alongside the earlier staffing workflows.
3. **Performance and helpdesk extensions:** core review cycles, objectives/development plans, calibration, routing, response targets, explicit escalation and knowledge articles are now implemented. Bulk review assignment/participant withdrawal, automated reminders/escalation and business-hour target calendars remain optional extensions. See [the operating guide](docs/Performance-Helpdesk-Guide.md).
4. **Documents and reports:** production file-delivery acceptance, retention automation, agreed metrics, filters and scoped drill-downs. Document versions and independently reviewed renewal requests are implemented.
5. **Learning, benefits and expenses:** optional extensions include LMS synchronisation, automated reminders, payroll deductions and country-specific benefit/tax rules. Core request, approval, evidence, entitlement and reimbursement workflows are implemented in migration 0024.
6. **Integrations:** EOS API adapter, verified Resend sender and live delivery, WhatsApp/biometric devices, and bank/WPS submission. These remain separate work.

The current release supports full-day leave and monthly payroll. Half-day leave, multi-stage approvals, automatic unpaid-leave deductions, statutory tax/EOS calculations and country-specific payslip/WPS formats require additional policy options or integrations. The UI records external payment references and does not transfer funds.

## Release validation — 16 September 2026

The combined release contains both the existing live document renewal, employee lifecycle, calculation-rule and skill controls and the new operational modules. TypeScript and both production builds passed. Across the full suite and the focused fixture-correction rerun, all 211 tests in 16 suites pass. The existing frontend bundle-size warning remains.

A private read-only snapshot of 88 application/migration tables (362 rows) was saved outside Git. All 15 pre-existing migration hashes match the preserved SQL after normalizing Windows line endings. The snapshot was restored in isolated PGlite, migrations 0015–0024 were applied, and every existing application table retained its row count. Production had no employee, leave, payroll, document or workforce-team records at backup time. No production demonstration records were added.

Group calculation rules continue to control attendance/timesheet rounding, paid breaks, leave counting/holiday exclusions and payroll rounding. New HR Rules supply dated company or employee entitlements, calendars, pay rates and approvers. Attendance corrections preserve calculation snapshots and require independent approval; payroll adjustments retain the generated period snapshot.

See [Deployment-Guide.md](docs/Deployment-Guide.md) for the exact live revision and deployment acceptance. External email, device and bank integrations remain separate configuration/work.

Deployment succeeded on 16 September 2026 at 15:36 Asia/Qatar for revision `80eb010` (migration `0024_learning_benefits_expenses`). Render startup confirmed `Database migrations completed`, and `/readyz` returned HTTP 200. The authenticated Learning, Benefits and Expenses pages loaded successfully with their catalogue, request, approval and admin-rule controls.
