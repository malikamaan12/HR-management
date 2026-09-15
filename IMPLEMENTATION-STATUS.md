# E3 HR module status — 16 September 2026

The requested attendance/leave → payroll → recruitment/onboarding/offboarding implementation is complete for the core workflows described below. These changes are local and have not been deployed. Administrators manage changing company policies and employee-specific overrides in **HR Rules**; effective dates and saved snapshots preserve history.

## Current status

| Module | Status | What works |
| --- | --- | --- |
| Employee records | Core foundation implemented | Scoped directory, private fields, manager validation, conflict-safe edits, history, account links and documents. |
| Attendance | Core workflow implemented locally | Clock/breaks, overnight clock-out, calendars/holidays/grace, roster comparison, reviewed corrections and CSV reports. |
| Leave | Core workflow implemented locally | Configurable entitlements/accrual/carryover, balance ledger, pending reservations, approvals, cancellations/refunds and calendar. |
| Payroll | Core workflow implemented locally | Dated salary/hourly rules, approved time lines, overtime, adjustments, independent approval, regeneration, payslips, reconciliation and external payment references. |
| Recruitment | Core workflow implemented locally | Requisition approval, candidates, screening, interviews/results, offers/responses and transactional employee handoff. |
| Onboarding/offboarding | Core workflow implemented locally | Reusable checklists, owners/deadlines, document/asset evidence, completion, cancellation and employee/account deactivation. |
| Workforce | Core workflows and roster enhancements implemented locally | Scoped scheduling, recurring rosters, shift revisions with fresh consent, one-off/weekly unavailability, verified qualifications and renewals, replacement staffing, membership history, incidents and mobile arrival/departure with dated rules. |
| Timesheets and assignment reviews | Core workflows implemented locally | Approved time, rubric-based reviews/disputes and team overview. |
| HR helpdesk | Core workflow and support operations implemented locally | Confidential cases, messages/files/history, dated company and employee routing rules, response targets, overdue queue, explicit escalation and searchable versioned knowledge articles. |
| Performance and development | Core review cycle implemented locally | Configurable weighted criteria/rating labels, employee deadlines, self-assessment, assigned manager review, independent HR calibration/publication, acknowledgement, objectives/development actions and scoped reports with sample counts. |
| Documents and reports | Foundation implemented; enhancements remain | Private storage and base exports exist; renewal/version/retention workflows and reporting refinements remain. |
| Learning, benefits and expenses | Partial | Existing screens/basic APIs require complete request, approval, entitlement, completion and reimbursement workflows. |
| Team lead dashboard | Partial | Scoped team overview exists; unified approvals and operational drill-downs remain. |

See [the workflow and configuration guide](docs/Attendance-Payroll-Lifecycle-Guide.md) for operating instructions, calculation conventions and legacy-data reconciliation. See [the module checklist](docs/MODULE-COMPLETION-CHECKLIST.md) for the remaining backlog.

## What remains

1. **Release acceptance and deployment:** reconcile existing leave/payroll data, configure actual company/employee rules, verify intended roles against managed PostgreSQL, back up and apply the migration journal. Migrations 0010–0018 are new in this release; verify 0008–0009 are applied as well. No production data was seeded or changed during these checks.
2. **Workforce enhancements:** whole-series roster changes, external certificate validation/evidence uploads and device/offline attendance integrations. Weekly unavailability, date exceptions, qualification renewal due lists, configurable reminder windows and HR verification are now implemented alongside the earlier staffing workflows.
3. **Performance and helpdesk extensions:** core review cycles, objectives/development plans, calibration, routing, response targets, explicit escalation and knowledge articles are now implemented. Bulk review assignment/participant withdrawal, automated reminders/escalation and business-hour target calendars remain optional extensions. See [the operating guide](docs/Performance-Helpdesk-Guide.md).
4. **Documents and reports:** browser file-upload acceptance, renewal/version/retention workflows, agreed metrics, filters and scoped drill-downs.
5. **Learning, benefits and expenses:** complete and verify their request, approval, entitlement and reimbursement workflows. They are not represented as completed modules.
6. **Integrations:** EOS API adapter, verified Resend sender and live delivery, WhatsApp/biometric devices, and bank/WPS submission. These remain separate work.

The current release supports full-day leave and monthly payroll. Half-day leave, multi-stage approvals, automatic unpaid-leave deductions, statutory tax/EOS calculations and country-specific payslip/WPS formats require additional policy options or integrations. The UI records external payment references and does not transfer funds.

## Validation

For this performance/helpdesk phase, TypeScript passed and all 20 focused tests across two suites passed. These checks cover the complete review cycle, weighted calibration, employee privacy, independent approval, stale versions, reviewer scope revocation, objective audit rollback, helpdesk target snapshots/escalation, confidential routing and knowledge publication/version history. The full historical suite and browser acceptance were not repeated in this phase.

Before this phase, all 164 tests across 13 suites passed, including 56 workforce tests. Tests use isolated PGlite databases and the complete migration chain; email/storage tests use mocks. New coverage includes effective employee overrides, accrual/carryover, balance reservations and refunds, corrections, grace/midnight handling, dated rates, shared daily overtime, regeneration/history, payment rollback, interview scope/versions, offer reissue, employee handoff, task ownership and offboarding session revocation.

Browser checks use temporary synthetic accounts and an in-memory database. They cover admin rule revisions, leave request calculations/reservations, payroll generation/submission/independent approval/payment-reference recording, requisition creation/submission, and employee task completion followed by HR checklist completion. Workforce browser checks also verify recurring shift preview/creation, revised offers and employee acceptance, cancellation and updated coverage, HR qualification creation/verification, candidate qualification checks, private unavailable periods/cancellation and replacement acceptance. The latest checks verify membership revisions/history, employee-specific arrival rules, arrival/departure, independent visit review, incident ownership/resolution and the employee page at a 390-pixel mobile viewport. Further browser checks verify weekly preview/save, single-date exceptions and stopping future dates, renewal evidence submission, HR verification, cleared due reminders and reminder configuration. These checks do not establish that the hosted application has received this release.

TypeScript and production builds pass. Vite continues to report the existing large frontend bundle warning. Hosting and external service configuration are documented in [Deployment-Guide.md](docs/Deployment-Guide.md); this task does not change service plans or hosting configuration.
