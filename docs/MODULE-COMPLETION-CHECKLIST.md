# HR module completion plan

18 September 2026: reviewed employee imports, employee correction requests and document approval/assignment controls are live in release `1d00133`, Render deployment `dep-dammk3ou01pc73ardpp0`. Startup migrations, public health/readiness and authenticated workflow screens passed verification. See [EMPLOYEE-DOCUMENT-REVIEW-RELEASE.md](EMPLOYEE-DOCUMENT-REVIEW-RELEASE.md) for the combined test results and acceptance limits. Next: onboarding review and versioned checklist templates.

18 September 2026: reporting snapshots, candidate corrections and shared event/FEC navigation are deployed in release `d64f3c2`. Render deployment `dep-damm7usri2ms73drt3ig`, startup migration completion, public health/readiness responses and the authenticated Reports screen were verified. See [REPORTING-CORRECTIONS-RELEASE.md](REPORTING-CORRECTIONS-RELEASE.md) for validation and branch compatibility limits.

Employee import review, employee corrections and document review governance are now reconciled against this live baseline. Older local implementations are preserved in enhancement commit `b0b3e2a`, but their different migration history prevents direct deployment. Reuse compatible behavior through new additive migrations and scoped APIs; preserve the existing live employee, onboarding and document workflows. Complete a combined regression/build check after the batch. EOS integration, Resend sender setup and WhatsApp remain separate deferred work.

Updated 16 September 2026. Attendance/leave, payroll and recruitment/onboarding/offboarding core workflows are deployed, and Learning, Benefits, Expenses, team task ownership, advanced reporting, operational reminders and absence coverage are live in release `f69d238`. The application is live at https://e3-hr.onrender.com on Render Free and Supabase Free. This checklist separates the current foundation from workflows that still need implementation and acceptance. It does not certify every module as finished.

## Release standard

Each section must support its main workflow end to end, enforce server-side record and field permissions, show usable validation/error/empty states, preserve an audit trail for consequential changes, and pass relevant tests. Verify employee, team lead, HR and administrator experiences. Test synthetic data in an isolated database; do not seed production with demonstration employees. Release additive migrations only after local verification. Keep hosting at $0.

## Order of work

| Order | Section | Existing foundation | Completion work |
| --- | --- | --- | --- |
| 1 | Employee records | Directory, profiles, account links, permanent/temporary/contract types | Current pass: paginated search, private-field projection, manager selection/cycle checks, edit conflicts, transactional history, profile documents and form corrections. Also implemented: lifecycle events, controlled termination/reactivation and onboarding/offboarding checklists. Employee-requested contact corrections and reviewed CSV imports are deployed in release 1d00133. Next: broader transfers and remaining onboarding governance. |
| 2 | Attendance and leave | Clock/breaks, manual attendance, requests and approvals | Deployed: admin company/employee rules, holiday calendars, ledger/accrual/carryover, roster-aware daily view, reviewed corrections and functional leave calendar. Optional next scope: half-day requests and multi-stage approvals. |
| 3 | Event, temporary and FEC workforce | Sites, teams, dated memberships/grants, shifts/offers/acceptance, conflicts | Deployed: recurring rosters, shift revisions with fresh acceptance, cancellation, private unavailable periods, HR-verified qualifications and replacement staffing with employee acceptance. Also deployed: membership end-date revisions/history, operational incidents with ownership/resolution/reopening, and mobile arrival/departure with dated team/employee rules and independent visit review. Also deployed: weekly unavailable patterns with exceptions, renewal due lists, dated qualification/employee reminder policies and independent HR renewal verification. Next: whole-series roster edits, certificate evidence uploads/external validation and device/offline attendance integrations. Keep employment type separate from event/FEC team assignment. |
| 4 | Team lead dashboard | Scoped staffing gaps, leave approval queue, timesheets and review metrics | Deployed unified approval queue, absence coverage for approved leave overlapping accepted shifts, direct time/leave/review links, and task ownership with owner assignment and status tracking. |
| 5 | Timesheets and payroll | Assignment approvals/corrections, payroll locks, draft/process/payment references and CSV | Deployed: dated company/employee pay rules, approved-time lines, daily overtime, allowances/deductions, reviewed adjustments, payslips, reconciliation and cancellation/regeneration. Bank submission and statutory calculation adapters remain separate integrations. |
| 6 | HR helpdesk | Private queues, messages, files, history and status | Deployed: dated category routing with employee overrides, owner assignment, saved response/resolution targets, overdue filter, explicit escalation and searchable knowledge articles with publication/visibility controls and version history. Optional next scope: automated escalation/reminders and business-hour calendars. |
| 7 | Ratings and performance | Assignment rubric/evidence, acknowledgement/dispute and independent HR resolution | Deployed: configurable review cycles/criteria/rating labels, per-employee settings, self and manager assessments, independent HR calibration/publication, acknowledgement, objectives/development actions and scoped reports with sample counts. Ratings do not automatically change payroll or employment. Bulk assignment and participant withdrawal remain extensions. |
| 8 | Recruitment, onboarding and offboarding | Requisitions, candidates, offers and onboarding tasks | Deployed: requisition approval, interviews/results, offer responses/reissue, candidate-to-employee handoff, reusable checklists, owners/dates, document collection, asset return and account/session deactivation. |
| 9 | Documents and compliance | Private upload, expiry data and signed download | Implemented: document versions, scoped renewal requests and independent review. Release 1d00133 adds a deployed scoped register, admin replacement policies, assigned renewal reviewers, due dates and audit history. Remaining: production file-delivery acceptance, retention rules and notifications once email is configured. |
| 10 | Reports and analytics | Basic organization reporting | Deployed headcount, attendance summary, turnover, leave, staffing-cost and compliance reports with date/department/site/team filters, reconciled totals, saved views, drill-down rows and CSV/PDF export. |
| 11 | Self-service, learning, benefits and expenses | Learning, benefits and expense workflows implemented | Learning catalogue, enrolment/completion verification and certificates; configurable benefit eligibility, reservations and activation; itemised expense claims, receipts, approval and reimbursement references. Optional LMS/payroll/tax integrations remain. |
| 12 | EOS and notifications | EOS design/contract only; email integration configuration pending | Versioned API, service credentials/scopes, idempotency, signed webhooks, retry/reconciliation and event-to-shift/timesheet mapping. Implement against EOS documentation when available. Configure Resend with an owned sender domain. WhatsApp later. |

## Employee foundation acceptance

- Directory searches all scoped records, paginates consistently and supports type/status filtering. Names, IDs, departments, roles and locations are searchable; `%` and `_` are literal search characters.
- Directory payloads contain professional fields only. Profile and legacy list responses redact private data for team/event readers. HR reads stay within existing row scope; finance receives payroll/bank details without private demographics, addresses or emergency contacts. Employees can see their own linked record.
- Create/edit authority remains with the existing administrator/HR director/legacy HR roles. Department HR readers are not silently granted new write authority. Employee contact correction requests now use independent HR review.
- General employee writes cannot change account links, permission roles, photos or record versions. Account linking stays in the existing administrator workflow.
- A database trigger advances the version on every update, including imports and account linking. The new PATCH API requires `expectedVersion`; stale writes receive HTTP 409. Integrations must GET the current record before writing. Creation/update audit entries commit with the employee write and contain field names, not personal values.
- Both reporting-manager links are checked for missing/inactive managers and indirect loops. The employee API serializes hierarchy writes with a short table lock; assess a more granular hierarchy strategy if write volume grows. Reviewed CSV imports now validate the complete included set and serialize final creation with the same hierarchy lock.
- Civil dates preserve the selected day across timezones. Required text, dates and email fields are checked; unknown protected fields are rejected. Nationality, gender, religion and marital status are not guessed. Department, job title and nationality accept free text.
- Profile documents use existing scoped upload and signed-download endpoints. Record history is paginated. Sensitive tabs and edit controls follow server capabilities.

## Inputs needed for subsequent phases

- Management working week confirmed: Sunday–Thursday, 09:00–17:00, Asia/Qatar; Friday/Saturday off. The scoped policy and employee assignment are implemented; see [the management schedule guide](Management-Office-Schedule.md). Administrators now set holidays and leave/calendar rules, including dated employee overrides, in HR Rules.
- Administrators configure the monthly payroll cycle, rates, daily overtime cap and independent pay approver in HR Rules; no code changes are needed for supported policy values.
- EOS API/repository when available; EOS is still under development.
- Resend sender domain and configuration. No email or WhatsApp delivery is represented as live yet.

## Attendance, payroll and lifecycle release

See [the operations guide](Attendance-Payroll-Lifecycle-Guide.md) for implemented behavior, supported policy options, legacy-data reconciliation and migration instructions. See [the current status](../IMPLEMENTATION-STATUS.md) for latest verification. No production employee data was modified during implementation.

## Employee foundation validation record

Employee API tests cover permissions, more than 100 records, filters and wildcards, account-versus-employee identity, private fields, duplicates, dates, protected writes, stale edits, manager cycles and atomic audit failure. The original 90 tests and 12 employee tests pass, as do TypeScript and frontend/server builds. Isolated browser checks passed for directory search beyond 100 records, create/edit, saved civil dates, manager selection, explicit save, history and employee-locked document selection. Browser file attachment and role-by-role screen acceptance remain separate checks.

## Learning, benefits and expenses release

Migration `0024_learning_benefits_expenses` is deployed in release `80eb010`. The live pages and core workflows are accepted: course enrolment/completion certificates, configurable benefit eligibility/reservations/activation, and itemised expense claims with private receipts, approvals and reimbursement references. Optional LMS, payroll/tax and country-specific integrations remain.

## Performance and helpdesk release

See [the operating guide](Performance-Helpdesk-Guide.md) for review stages, privacy, policy precedence, elapsed-hour deadlines, explicit escalation and article publishing. Migration 0023 adds these workflows. Release `c2727e7` is live; see the deployment guide for acceptance evidence.
