# Local completion work

User direction, 15 September 2026: stop pushing and deploying; finish the remaining modules locally first. Do not push GitHub or deploy Render again without a subsequent user instruction.

Latest direction: "proceed ana later push it" authorizes a later consolidated push after the work and verification, not repeated pushes during implementation. Deployment remains paused.

Use MODULE-COMPLETION-CHECKLIST.md as the acceptance inventory. Keep implementation and verification status separate from the deployed release. Preserve the $0 budget. Do not populate production with synthetic records. Business calculations must be configurable by Admin/Super Admin rather than invented as fixed defaults. EOS, Resend sender setup and WhatsApp remain external integration dependencies.

## Implemented locally, not deployed

- Leave calendar now reads approved, scoped leave and omits private reasons. Random balance values are removed. Approval controls follow server capabilities; employees can cancel their pending requests. Successful changes refresh all leave views. Overlapping approvals are rejected.
- Migration 0015 adds an allocation ledger. Admin/Super Admin can enter signed whole-day allocations with a reason and idempotency reference. Accounts activate explicitly per employee/type/year. Available days derive from allocations less approved and pending requests; rejection/cancellation releases reservations. Atomic employee locks serialize allocations and requests. Cross-year requests split their saved calendar snapshot; legacy cross-year records without snapshots block managed-account activation until reconciled. Existing legacy balances are not silently imported. Type names remain stable accounting keys. Automated accrual/carryover, fractional days and legacy reconciliation still require implementation.
- Mobile leave uses the same validated calendar and reservation path. Employee dashboard uses managed ledger availability when present, otherwise its legacy balance source.
- Migration 0016 adds helpdesk knowledge articles and version history. Admin/Super Admin/HR Director can draft, publish, revise and withdraw publication. Employees see published content only. Search is literal, paginated and authenticated. Updates reject stale versions and roll back if history cannot be saved. General guidance is kept separate from private case messages.
- Migration 0017 adds versioned category response/resolution targets editable by Admin/Super Admin. New cases pin the policy and deadlines; later policy changes do not rewrite them. Targets count elapsed hours including weekends and employee waiting time. Only a public staff response satisfies the response target. Reopening retains original deadlines. The overdue queue retains confidential-case access restrictions. Automatic reminders, escalation and category auto-assignment remain pending.

## Verification

### Employee correction requests

Migration 0025 adds one pending contact/address/emergency correction per employee with original values, proposed values, reason and decision history. Employees can request changes only for their linked record and withdraw pending requests. Independent HR employee writers can approve/reject within employee scope. Finance/team readers cannot access private proposals. Approval checks the original employee record version; conflicts require a fresh request rather than overwriting intervening edits. Approval, employee update, decision and audit commit together, with field names only in general audit logs. The profile has request/review controls and the employee directory has an HR pending inbox. Employment, identity, account, salary and banking fields are excluded. Team-wide unified approvals, browser acceptance and expanded correction policies remain pending. 37 employee-record/migration tests, TypeScript and the server build passed; no push/deployment.

### Final-settlement controls

Migration 0024 adds itemized final-settlement drafts with earning/deduction amounts and mandatory calculation/supporting-record basis. Amounts are summed in integer cents; negative net totals are rejected. Duplicate employee/exit-date drafts are rejected. Draft edit, submission, independent approval/return, external payment reference and immutable revision snapshots commit atomically with audit records. Preparers (including earlier editors) cannot review their own work; employees cannot manage their own settlement. Paid records cannot be edited. The Payroll screen supports these actions and history within existing detailed payroll roles and row permissions. These are manually verified amounts: gratuity/leave-payout formula configuration, payroll overlap reconciliation, automatic payout generation and bank transfers are not implemented. Twelve focused calculation/migration tests passed before the final capability projection adjustment; the final 11-test calculation rerun, TypeScript and frontend/server builds also passed. No push/deployment occurred.

Latest consolidated local regression: 156 tests passed across 14 files after payroll reconciliation. TypeScript and frontend/server builds passed; the existing frontend bundle-size warning remains. This supersedes earlier focused-run counts for the current local code. The final Payroll-page integration was included in the frontend build. Browser acceptance for recently added workflows and the remaining implementation checklist are still outstanding.

### Payroll reconciliation

Added a read-only, employee-scoped monthly reconciliation endpoint and screen with CSV export. It recalculates against the record's saved policy, compares net and rounding adjustments, flags duplicate records and missing processed-payment evidence, and reports pending/processed totals using integer cents. Missing snapshots and invalid data are flagged and excluded from recalculated totals; partial totals are labeled. No current-policy substitution or bank receipt verification is implied. Nine calculation-rule tests and TypeScript passed; server build passed. Final-settlement calculations, reconciliation sign-off, payroll adjustment approval and approved-timesheet-to-pay mapping remain pending. No push or deployment yet.

### Offboarding and asset return

Migration 0023 adds one open exit case per employee, versioned task updates, checklist/asset kinds, owners, dates and completion evidence. The Onboarding screen now includes offboarding creation, task tracking and completion/cancellation. Every task must be done before completion. HR management handles cases; self-offboarding is denied. Optional account deactivation requires Admin/Super Admin, protects Super Admin accounts from ordinary administrators, and revokes sessions in the same transaction as case completion and audit. Task titles/types remain fixed after creation; cancellation permits a replacement case. Employment termination remains the existing employee lifecycle action. This does not calculate final settlement, manage an asset inventory, schedule future deactivation or provide reusable exit templates. Ten focused onboarding/migration tests and TypeScript passed; server build passed. Browser acceptance remains pending. No production data, push or deployment was touched.

### Accepted-offer handoff

Migration 0022 adds unique offer/application/candidate/employee links. HR employee writers can link an accepted offer with a recorded acceptance date to an existing active employee after exact trimmed QID matching and offer/application/employee conflict checks. The employee must be created and verified through the existing employee form; missing personal fields are never invented. Application status becomes hired in the same transaction as the link and audit entry. Identical retries return the existing link; conflicting links are rejected. Linked offers/applications are protected from later updates at the database layer. The Offers screen provides employee search, link confirmation and a link to onboarding checklist selection. This is a verified-record linking workflow, not automatic candidate-to-employee record creation or automatic onboarding start. Eight focused onboarding/migration tests passed. Browser acceptance and offboarding remain pending; no push/deployment occurred.

### Versioned onboarding checklists

Migration 0021 adds template versions, active template-task selection and preserved revision snapshots. Checklist create/edit now saves the template and all tasks in one transaction, with mandatory reason, strict validation and stale-version rejection. The editor loads existing tasks, uses PUT for edits, shows revision history and rejects unsupported employee types. Prior task rows are retained for existing employee assignments; new onboarding selects only the current active tasks. The legacy task-by-task POST now directs clients to the atomic checklist editor. Existing legacy templates have their prior contents preserved at the first edit. Six onboarding/migration tests passed, including rollback, access denial, old assignment preservation and new assignment dates; TypeScript and server build passed. Candidate-to-employee handoff, offboarding and browser acceptance remain pending.

### Onboarding workflow follow-up

Migration 0020 adds task versions. Starting onboarding now validates the employee/template, rejects empty or mismatched templates and duplicate active onboarding, computes civil due dates in UTC, and creates the checklist, tasks and audit entry in one transaction. Task updates validate status, active owner and due date, reject stale versions, serialize progress calculation per onboarding, and commit task/progress/audit changes together. Reopening clears completion dates. The Tasks screen now has an editor for status, owner, due date and notes. Generated employee/assignee names and email addresses have been replaced with real records (missing work email remains null). Management access remains organization-wide and permission-gated; this does not grant employee self-service task access. Three integration tests plus the migration test passed; TypeScript and server build passed. Browser acceptance, candidate handoff, template editing/version snapshots, onboarding record editing, document collection, offboarding and account deactivation remain incomplete.

### Manual escalation follow-up

Migration 0019 adds an active escalation flag. Requesters and authorized case handlers can flag unresolved requests with a public reason. Only a non-requester triage reviewer can clear an active escalation; resolving/closing the case clears it with a history entry. Reopening does not silently reinstate a cleared escalation. UI controls use server capabilities; the escalated queue retains existing case scope. Every escalation/clear action checks the case version and commits history atomically. No email is sent and no handler/access change is made. Automated deadline escalation and notifications remain pending. The focused helpdesk/migration suite passed 21 tests, including stale retries, unauthorized clearance, confidential queue filtering, resolution/reopening, and audit rollback. TypeScript and the server build passed.

### Category routing follow-up

Migration 0018 adds immutable category/confidentiality routing policies. Admins configure ordinary routing; Super Admins can also configure confidential routing. The editor supports eligible-handler search, disabling automatic assignment, reasons and revision history. A new case records its routing decision in internal history and checks the handler's current active/approved role before assigning. Self-requests and unavailable handlers remain unassigned for triage. Confidential routing never falls back to the ordinary category policy. Existing cases retain their assignment. Routing API, confidentiality, stale version, fallback and migration checks passed in a 19-test focused run; TypeScript and both frontend/server builds passed (the existing bundle-size warning remains). Escalation and notifications remain pending.

140 tests passed across 13 files before target-policy additions. The final mobile/dashboard changes also passed a focused 48-test rerun. After target-policy additions, 17 helpdesk/migration tests passed; this is not a claim that the complete expanded suite was rerun. Strict TypeScript and frontend/server builds passed after those additions. Isolated browser checks verified calendar rendering, employee search, a ledger adjustment from 20 to 22 days, knowledge draft creation, and saving a category policy at version 1 with two-hour response/eight-hour resolution targets. The frontend bundle-size warning remains. Synthetic preview data is separate from production.

Remaining checklist items are not considered finished until implemented and tested. Next local work: automated helpdesk escalation/notifications, lifecycle/recruitment checklists, payroll reconciliation, workforce revisions and the remaining module acceptance cases. Leave accrual/carryover and reconciliation are still pending. No deployment or push is authorized by this checkpoint.

## Accepted larger-batch roadmap

The user approved connected batches with consolidated testing and a later consolidated push. These are workstreams to finish, not claims that 20 new standalone applications are complete.

| Batch | Workstream | Current status |
| --- | --- | --- |
| 1 | 1. Team approval inbox | Local time/leave/performance lanes with independent permissions |
| 1 | 2. Team-lead dashboard actions | Local scoped inbox and staffing drill-down links |
| 1 | 3. Absence coverage and replacements | Local alerts, candidate checks, replacement offers and history |
| 1 | 4. Employee availability | Local declarations/cancellation integrated with eligibility |
| 1 | 5. Recurring rosters and shift revisions | Local bounded recurrence, retries and preserved revisions |
| 2 | 6. Attendance correction workflow | Local self-service requests, independent decisions and version history |
| 2 | 7. Roster-aware attendance reconciliation | Local completed-assignment / clock / timesheet comparison |
| 2 | 8. Leave accrual and carryover policies | Local versioned policies and administrator-posted runs |
| 2 | 9. Leave ledger legacy/fractional reconciliation | Local hundredth-day allocations, half-day requests and legacy year splits |
| 2 | 10. Time-to-pay, rate rules and adjustments | Local rate-based import, adjustments, reservation, release and paid locking |
| 3 | 11. Recruitment workflow completion | Pending completion |
| 3 | 12. Onboarding document/task completion | Pending completion |
| 3 | 13. Offboarding and settlement completion | Pending completion |
| 3 | 14. Performance cycles, goals and development | Pending completion |
| 3 | 15. Training and certification lifecycle | Pending completion |
| 4 | 16. Expense submission and approval | Pending completion |
| 4 | 17. Benefits administration | Pending completion |
| 4 | 18. Helpdesk automation and notifications | Pending; sender configuration is external |
| 4 | 19. Reports and operational analytics | Pending completion |
| 4 | 20. EOS API and webhook contract | HR-side work pending; EOS integration acceptance needs EOS |

### Batch 1 implementation scope

Migration 0026 adds availability declarations, recurring-roster request records, shift revision snapshots and replacement links. Scheduling grants still need to cover each entire shift. Availability belongs to the linked employee and cannot overwrite accepted commitments. Unavailability blocks offers and acceptance. Recurrence creates 2–12 occurrences atomically within 90 days, preserves site wall-clock time, rejects ambiguous/nonexistent clock-change times, and supports idempotent retries. These limits are technical request bounds, not pay/leave calculation rules.

A replacement immediately cancels the original assignment and creates an offer; the place remains unfilled until acceptance. Shift revision creates a successor, cancels old offers/acceptances, and preserves history. It does not auto-offer the successor. Past/current shifts cannot be revised. Coverage alerts expose only operational absence status, not private reasons. All changes and audit records commit together.

The team approval inbox includes scoped actionable timesheets, leave and missing assignment reviews. It uses existing independent review and leave permissions, with no new authority implied by scheduling access. Employee correction, expense and settlement decisions remain in their existing screens. Dashboard staffing excludes superseded shifts. Workforce includes employee availability, recurrence, candidate/replacement tools, coverage alerts and revision history.

Verification before final clock-change handling: TypeScript passed and 53 combined workforce/time/review/migration tests passed. Final consolidated regression and production builds are being recorded below when complete. Browser acceptance remains outstanding; all changes are local, uncommitted and not deployed.

Final Batch 1 verification: 169 tests passed across all 14 test files, including positive approval-lane transitions, clock-change recurrence and atomic rejection of ambiguous occurrences. Final TypeScript check and frontend/server production builds passed. The existing frontend bundle-size warning remains. The duplicate roster offer form was removed in favor of the eligibility-aware candidates/replacements panel; the final frontend build includes this cleanup. No browser acceptance was performed for Batch 1, no production data was changed, and nothing was committed, pushed or deployed. Next connected implementation batch is attendance, leave accrual/reconciliation and time-to-pay rules (workstreams 6–10).

### Batch 2 — attendance, leave and time-to-pay

Migration 0027 adds attendance versions and database-written history; private correction requests; dated operation policies; fractional leave ledger values and year splits; and reserved payroll time entries. The management office calendar stays Sunday–Thursday, 09:00–17:00 Asia/Qatar. No production policy values were changed.

- Attendance: linked employees propose completed-time corrections; independent approvers with existing attendance row scope approve/reject. Employees may withdraw. Approval rejects an intervening version, recalculates under the original policy and writes history/audit atomically. Manual self-editing is blocked even for legacy roles with self-update access. Open clock sessions continue across midnight for up to 24 hours. Longer unresolved sessions require HR reconciliation. Existing manual recording remains for other employees within write scope.
- Reconciliation: completed accepted workforce assignments are compared with overlapping clock records and reported timesheets. Missing or differing evidence is flagged; no hours or payroll amounts are invented. Clock totals spanning multiple assignments require review. UI/API windows are bounded to 90 days and 300 rows; users must narrow larger windows. This does not add geofencing, QR or biometric providers.
- Leave: Admin/Super Admin publishes effective-dated monthly accrual, annual accrual cap, service eligibility, calendar-day proration and carryover cap. Runs preview and post per employee/type/period with permanent references and pinned policy evidence. Posting rechecks the preview; duplicates return the existing run. Carryover transfers available days out of the previous year and requires all source-year requests decided. Runs are explicitly administrator-triggered, not a background scheduler. No expiry/forfeiture automation was added.
- Reconciliation and fractions: ledger allocations support hundredths of a day. Optional single-date half-day requests require an enabled duration policy and reserve 0.5 days. Half-day absence still blocks workforce shifts on that date; AM/PM allocation is not implemented. Admins explicitly verify an opening available balance; existing used and reserved days are included when initializing the ledger. Legacy cross-year requests require an audited year split preserving their original total, rather than reinterpreting them with current calendars. Legacy balances are evidence only and are never silently imported.
- Time-to-pay: Admin/Super Admin publishes disabled-by-default hourly rate, per-timesheet overtime threshold/multiplier and cent-rounding policies by employee policy group. Payroll editors preview all approved timesheets whose shift starts in that payroll month in the site's timezone. Each line records approved minutes and the effective rate version. Signed adjustments require reasons. Import adds a separately identified allowance and reserves its timesheets; pending imports may be released with retained history. Recording an external completed-payment reference locks the imported sheets and preserves their revisions atomically. Own-time import/release/payment is rejected. This is an earning allowance, not replacement of basic salary: payroll must verify that basic salary does not already include those hours. Employee-specific negotiated rates, daily/weekly overtime aggregation, salary proration, automatic absence deductions and bank submission remain pending.

Verification: the initial full run passed 181 of 183 tests; the two failures were legacy clock-in message compatibility and migration statement boundaries. After fixing those, the 31-test auth/new-batch rerun passed, including two added self-edit/proration/rollback cases; the final migration rerun also passed. The suite now contains 185 tests across 15 files. Final TypeScript and frontend/server builds passed before the final wording/layout-only cleanup; the final frontend build is recorded below. Browser verification with an isolated in-memory database confirmed employee correction submission, independent admin approval with original/proposed values and updated checkout, and publication of a 1.25-day monthly accrual policy. Payroll import, half-day requests and carryover were covered by API integration tests; their complete browser acceptance is still pending. The existing frontend bundle-size warning remains. All work is local and uncommitted. No push, deployment, production data change or paid service was used.

Next connected implementation batch: recruitment completion, onboarding documents/tasks, offboarding/settlement completion, performance cycles/goals/development, and training/certification lifecycle (workstreams 11–15).

Final Batch 2 cleanup: frontend build passed after the policy field-order and wording changes. Migration 0027 also seeds history snapshots for existing attendance records before enabling history triggers; the final migration apply/rerun check passed. The isolated browser tab and preview server were closed after verification.
