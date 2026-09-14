# HR module completion plan

Updated 14 September 2026. The application is live at https://e3-hr.onrender.com on Render Free and Supabase Free. This checklist separates the current foundation from workflows that still need implementation and acceptance. It does not certify every module as finished.

## Release standard

Each section must support its main workflow end to end, enforce server-side record and field permissions, show usable validation/error/empty states, preserve an audit trail for consequential changes, and pass relevant tests. Verify employee, team lead, HR and administrator experiences. Test synthetic data in an isolated database; do not seed production with demonstration employees. Release additive migrations only after local verification. Keep hosting at $0.

## Order of work

| Order | Section | Existing foundation | Completion work |
| --- | --- | --- | --- |
| 1 | Employee records | Directory, profiles, account links, permanent/temporary/contract types | Current pass: paginated search, private-field projection, manager selection/cycle checks, edit conflicts, transactional history, profile documents and form corrections. Next: effective-dated employment changes, transfers, termination checklist and employee-requested corrections. |
| 2 | Attendance and leave | Clock/breaks, manual attendance, requests and approvals | Confirm company working week/timezone; holiday calendar, leave balance ledger, accrual/carryover policies, roster-aware attendance, corrections and approval inbox. Remove or complete calendar placeholders. |
| 3 | Event, temporary and FEC workforce | Sites, teams, dated memberships/grants, shifts/offers/acceptance, conflicts | Recurring rosters, shift revisions, qualifications, availability, replacements, operational incidents and mobile arrival workflow. Keep employment type separate from event/FEC team assignment. |
| 4 | Team lead dashboard | Scoped staffing gaps, timesheets and review metrics | Unified team approvals, absence coverage, task ownership, delegated access expiry and drill-down actions. |
| 5 | Timesheets and payroll | Assignment approvals/corrections, payroll locks, draft/process/payment references and CSV | Confirm payroll cycle/rates; approved time to pay lines, overtime rules, allowances/deductions, adjustment approvals, payslips and reconciliation. Bank submission remains a separate integration. |
| 6 | HR helpdesk | Private queues, messages, files, history and status | Category routing, owner assignment, response targets/escalation, employee visibility checks and searchable knowledge articles. |
| 7 | Ratings and performance | Assignment rubric/evidence, acknowledgement/dispute and independent HR resolution | Review cycles, objectives, calibration, development plans and fair reporting with sample counts. Ratings must not silently drive payroll or employment decisions. |
| 8 | Recruitment, onboarding and offboarding | Requisitions, candidates, offers and onboarding tasks | Complete candidate-to-employee handoff, reusable checklists, owners/due dates, document collection, asset return and account deactivation. |
| 9 | Documents and compliance | Private upload, expiry data and signed download | Validate browser upload flow, renewal requests, version history, retention rules and notifications once email is configured. |
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

- Working week, company timezone, holiday policy and leave rules.
- Payroll cycle, time rounding, approved rate structure and who signs off pay.
- EOS API/repository when available; EOS is still under development.
- Resend sender domain and configuration. No email or WhatsApp delivery is represented as live yet.

## Validation record

Employee API tests cover permissions, more than 100 records, filters and wildcards, account-versus-employee identity, private fields, duplicates, dates, protected writes, stale edits, manager cycles and atomic audit failure. The original 90 tests and 12 employee tests pass, as do TypeScript and frontend/server builds. Isolated browser checks passed for directory search beyond 100 records, create/edit, saved civil dates, manager selection, explicit save, history and employee-locked document selection. Browser file attachment and role-by-role screen acceptance remain separate checks.
