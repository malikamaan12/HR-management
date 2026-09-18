# HR module completion plan

Current local checkpoint: **18 September 2026, Batch 14**. This development branch covers 295 passing tests across 24 files, production builds and focused browser acceptance. GitHub main has a separate, newer live implementation; direct deployment of this branch is unsafe until migration and feature reconciliation. See [RELEASE-READINESS.md](RELEASE-READINESS.md).


Updated 15 September 2026. The application is live at https://e3-hr.onrender.com on Render Free and Supabase Free. Release `ee08c0e83ad2ccf28aaa5b67dce27533e34b81ce` passed 135 tests across 13 files, TypeScript checking and both production builds, was pushed to `malikamaan12/HR-management` on `main`, and is live in Render deployment `dep-dak8s7ek1f9s73cdu7j0`. Startup migrations completed, database readiness returned HTTP 200, and the authenticated live Documents screen and renewal request queue load; upload and renewal/history passed with isolated synthetic records. External production file delivery was not re-tested. This checklist separates the current foundation from workflows that still need implementation and acceptance. It does not certify every module as finished.

## Release standard

Each section must support its main workflow end to end, enforce server-side record and field permissions, show usable validation/error/empty states, preserve an audit trail for consequential changes, and pass relevant tests. Verify employee, team lead, HR and administrator experiences. Test synthetic data in an isolated database; do not seed production with demonstration employees. Release additive migrations only after local verification. Keep hosting at $0.

## Order of work

| Order | Section | Existing foundation | Completion work |
| --- | --- | --- | --- |
| 1 | Employee records | Directory, profiles, account links, permanent/temporary/contract types | Deployed: paginated search, private-field projection, manager selection/cycle checks, edit conflicts, transactional history, profile documents, append-only lifecycle events and controlled termination/reactivation. Next: transfer-specific field history, termination checklist and employee-requested corrections. |
| 2 | Attendance and leave | Clock/breaks, manual attendance, requests and approvals | Management office calendar and versioned Admin calculation controls are live. Next: holiday calendar acceptance, leave balance ledger, accrual/carryover policies, roster-aware attendance, corrections and approval inbox. Remove or complete calendar placeholders. |
| 3 | Event, temporary and FEC workforce | Sites, teams, dated memberships/grants, shifts/offers/acceptance, conflicts | Skill catalogue management, HR qualification entry/renewal, roster skill selection and full-shift qualification checks are implemented and tested; see [the qualification guide](Workforce-Qualifications.md). Remaining work: recurring rosters, shift revisions, availability, replacements, operational incidents and mobile arrival workflow. Keep employment type separate from event/FEC team assignment. |
| 4 | Team lead dashboard | Scoped staffing gaps, timesheets and review metrics | Unified team approvals, absence coverage, task ownership, delegated access expiry and drill-down actions. |
| 5 | Timesheets and payroll | Assignment approvals/corrections, payroll locks, draft/process/payment references and CSV | Versioned Admin controls for break treatment, rounding, payable-time mode and payroll final-total rounding are live. Confirm payroll cycle/rates; approved time to pay lines, overtime rules, allowances/deductions, adjustment approvals, payslips and reconciliation. Bank submission remains a separate integration. |
| 6 | HR helpdesk | Private queues, messages, files, history and status | Category routing, owner assignment, response targets/escalation, employee visibility checks and searchable knowledge articles. |
| 7 | Ratings and performance | Assignment rubric/evidence, acknowledgement/dispute and independent HR resolution | Review cycles, objectives, calibration, development plans and fair reporting with sample counts. Ratings must not silently drive payroll or employment decisions. |
| 8 | Recruitment, onboarding and offboarding | Requisitions, candidates, offers and onboarding tasks | Complete candidate-to-employee handoff, reusable checklists, owners/due dates, document collection, asset return and account deactivation. |
| 9 | Documents and compliance | Private upload, expiry data and signed download | Document renewal/replacement, preserved prior files, scoped historical downloads and conflict-safe saves are implemented and tested; see [the renewal guide](Document-Renewals.md). Browser upload/renewal passed with isolated records. Optional renewal requests, independent approval/rejection and requester withdrawal are implemented with private proposals and decision history. Remaining work: named reviewer assignment, mandatory approval policy, production file-delivery acceptance, retention rules and notifications once email is configured. |
| 10 | Reports and analytics | Basic organization reporting | Agreed metric definitions, scoped drill-downs, date/site/team filters, reconciled totals and real export actions. |
| 11 | Self-service, learning, benefits and expenses | Partial screens and basic APIs | Audit actual workflows; complete requests, approvals, entitlements, course completion and reimbursement records before advertising them as ready. |
| 12 | EOS and notifications | EOS design/contract only; email integration configuration pending | Versioned API, service credentials/scopes, idempotency, signed webhooks, retry/reconciliation and event-to-shift/timesheet mapping. Implement against EOS documentation when available. Configure Resend with an owned sender domain. WhatsApp later. |

## Employee foundation acceptance

- Directory searches all scoped records, paginates consistently and supports type/status filtering. Names, IDs, departments, roles and locations are searchable; `%` and `_` are literal search characters.
- Directory payloads contain professional fields only. Profile and legacy list responses redact private data for team/event readers. HR reads stay within existing row scope; finance receives payroll/bank details without private demographics, addresses or emergency contacts. Employees can see their own linked record.
- Create/edit authority remains with the existing administrator/HR director/legacy HR roles. Department HR readers are not silently granted new write authority. Employee correction requests are a later workflow.
- General employee writes cannot change account links, permission roles, photos or record versions. Account linking stays in the existing administrator workflow.
- A database trigger advances the version on every update, including imports and account linking. The new PATCH API requires `expectedVersion`; stale writes receive HTTP 409. Integrations must GET the current record before writing. Creation/update audit entries commit with the employee write and contain field names, not personal values.
- Both reporting-manager links are checked for missing/inactive managers and indirect loops. The employee API serializes hierarchy writes with a short table lock; assess a more granular hierarchy strategy if write volume grows. Existing bulk-import business validation remains a separate completion task.
- Civil dates preserve the selected day across timezones. Required text, dates and email fields are checked; unknown protected fields are rejected. Nationality, gender, religion and marital status are not guessed. Department, job title and nationality accept free text.
- Profile documents use existing scoped upload and signed-download endpoints. Record history is paginated. Sensitive tabs and edit controls follow server capabilities.

## Inputs needed for subsequent phases

- Management working week confirmed: Sunday–Thursday, 09:00–17:00, Asia/Qatar; Friday/Saturday off. The scoped policy and employee assignment are implemented; see [the management schedule guide](Management-Office-Schedule.md). Holiday policy, leave rules and other employee calendars still need confirmation.
- Payroll cycle, time rounding, approved rate structure and who signs off pay.
- Time rounding and break methods can now be configured under Settings → Rules & calculations. Confirm the approved payroll cycle, rates, overtime and proration policy before enabling those future fields.
- EOS API/repository when available; EOS is still under development.
- Resend sender domain and configuration. No email or WhatsApp delivery is represented as live yet.

## Validation record

Employee API tests cover permissions, more than 100 records, filters and wildcards, account-versus-employee identity, private fields, duplicates, dates, protected writes, stale edits, manager cycles and atomic audit failure. Calculation-rule tests cover admin permissions, future/effective dates, same-day precedence, stale publication conflicts, immutable history, previews, holiday counting, attendance and timesheet snapshots, payroll rounding and rollback. The full suite has 135 passing tests across 13 files; TypeScript and frontend/server builds pass. Isolated browser checks passed for directory search beyond 100 records, create/edit, saved civil dates, manager selection, explicit save, history, employee-locked document selection and the admin Rules & calculations editor. Browser original upload/renewal passed with isolated records and in-memory storage. Production file-delivery acceptance and remaining role-by-role screen acceptance are separate checks.

## Local development checkpoint — Batches 3–8

The deployed-release information above remains historical. Local enhancements and their exact implementation/validation boundaries are recorded in [LOCAL-COMPLETION-PLAN.md](LOCAL-COMPLETION-PLAN.md), through Batch 8. The latest local regression passed 226 tests across 18 files plus TypeScript and both builds. New equipment custody and policy acknowledgement pages are local only. This does not certify completion of every legacy module or represent a new deployment.


Local Batch 9 adds probation reviews, independently approved employee transfers and operational incident tracking, with admin-editable pinned rules and scoped version history. All 236 tests have passing verification: 235 in the consolidated run and the corrected migration test in its targeted rerun. TypeScript and production builds passed; isolated browser checks saved a transfer and incident and loaded probation. These modules remain local and unpushed. See [the Batch 9 scope and remaining limits](LOCAL-COMPLETION-PLAN.md).


Local Batch 10 adds independently reviewed contract renewals and an admin-configurable expiry queue, versioned reusable exit templates, and independent return-to-work equipment clearance for specific completed exit versions. The full suite passed 246 tests across 20 files; a final clearance-version refinement then passed all 17 affected tests plus TypeScript and the server build. Frontend build and isolated template-to-exit browser checks passed. Work remains local, uncommitted and unpushed. Exact limits and validation are in [LOCAL-COMPLETION-PLAN.md](LOCAL-COMPLETION-PLAN.md).


Local Batch 11 adds admin-controlled document replacement approval rules, named renewal reviewers with reassignment/history, pinned review targets and overdue queues, and a scoped searchable/paginated document register. The consolidated suite passed 255 tests; the final Qatar-date refinement then passed all 46 affected tests including one added midnight-boundary case. TypeScript, builds and isolated policy-to-assignment-to-approval browser acceptance passed. Defaults preserve optional approval until an administrator configures the policy. Initial uploads, retention and production storage acceptance remain separate. Changes remain local, uncommitted and unpushed; see [the detailed Batch 11 scope](LOCAL-COMPLETION-PLAN.md).


Local Batch 12 replaces immediate CSV writes with private admin-owned import drafts, per-row correction/exclusion, duplicate/date/manager-cycle validation, atomic versioned commits, repeat-safe retries and downloadable result reports. Supports permanent, temporary and contract employees with event eligibility and work schedules. This imports new employee records only; login accounts stay in User Management. All 272 current tests have passing verification across the consolidated run and focused reruns; TypeScript, production builds and a synthetic upload-to-correction-to-commit browser check passed. No push or deployment. Exact validation history and remaining limits are in [LOCAL-COMPLETION-PLAN.md](LOCAL-COMPLETION-PLAN.md).


Local Batch 13 closes legacy URL permission gaps, scopes event-staff data, prevents forged event/rating identities, removes duplicate workflow bypasses, and adds revision-safe onboarding notes/cancellation with private history. Navigation and direct-page access now agree on restricted management pages. All 285 tests passed together; final TypeScript/builds and isolated browser acceptance passed after fixing history refresh. Nothing was pushed or deployed. The next connected engineering batch is legacy reports/exports/communications and event-screen consolidation, followed by versioned candidate corrections and frontend loading/accessibility work; see [the release-readiness report](RELEASE-READINESS.md).
