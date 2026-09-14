# E3 HR status — 14 September 2026

Core application repairs, the first workforce enhancement, HR helpdesk, assignment timesheets, assignment reviews and the team overview are implemented and ready for staging verification. This is not a claim that every advanced workflow is production-ready.

## Deployment preparation

The Render Blueprint defines one Free Node service using an external Supabase Free database and private file storage, with migrations at startup, generated signing secrets and a database readiness endpoint. No paid Render database, pre-deploy command or service shell is required. The public URL is validated and can use Render's assigned HTTPS origin. The migration journal was tested on empty PGlite and rerun safely. Supabase storage preserves existing authorization and signed downloads; R2 remains supported. Git publication, managed PostgreSQL verification, first-administrator setup and live storage/Resend verification remain pending. The budget is $0, with no card or paid upgrade; Free services can sleep, pause or reach quotas. See [the deployment guide](docs/Deployment-Guide.md).

## Implemented

- Assignment reviews with versioned rubrics, criterion evidence, improvement actions, employee acknowledgement/comments/disputes and independent HR amendment/upholding/withdrawal. Team overview combines scoped staffing gaps, pending time approvals, missing reviews and criterion trends with sample counts. See [the review guide](docs/Assignment-Reviews-Guide.md).

- Assignment-linked timesheets for event/FEC/mall teams: employee actual hours, explicit dated reviewer grants, approve/return/correct flow, separate policy-based payable minutes, revision snapshots, overlap/self-approval prevention and confirmed links to processed payroll that lock the time record. Pay calculation remains separate. See [the timesheet guide](docs/Timesheet-Enhancement-Guide.md).

- HR Helpdesk with employee requests, scoped HR queues, confidential cases, assignment to HR responders, public replies/internal notes, private attachments, versioned status transitions, close/reopen and case-specific audit history. See [the helpdesk guide](docs/HR-Helpdesk-Guide.md).

- Workforce page for event, FEC and mall-activation teams: sites/time zones, dated membership and lead grants, shift offers, employee acceptance/decline, cancellation reasons, roster coverage and audited changes. Capacity, overlapping schedules, approved leave and employment dates are checked. See [the workforce guide](docs/Workforce-Enhancement-Guide.md) for scope and setup.

- Real authentication and approval checks, separate signing secrets, hashed passwords, rotating sessions, lockout, logout/session revocation, and one-time Resend password resets. Browser tokens are held in memory and secure cookies; no default administrator bypass or seed password.
- Fixed frontend request argument handling, HTTP methods, request bodies, query filters and employee IDs. Removed the full-project TypeScript errors.
- Real employee, event profile, roster, assignment, event rating and communication persistence. Explicit unique account-to-employee linking; account linking cannot be changed through ordinary employee edits.
- Scoped employee, attendance, leave, payroll and document access. Legacy advanced management endpoints fail closed when they cannot support the caller's scope. Targeted announcements filter their audience.
- Attendance state transitions, duplicate clock prevention, multiple breaks, manual records and report queries. Work totals exclude breaks. A failed clock request is not automatically repeated.
- Leave requests force pending status, calculate working days from saved weekend settings, require approval permissions, deny self-approval and prevent repeated decisions.
- Payroll draft create/edit, integer-cent calculation, duplicate-period prevention, protected processed records, CSV export, print and external payment-reference recording.
- Private Supabase S3 or R2 uploads and authorized expiring download links, content validation, upload rollback cleanup and actual employee names.
- Persisted company settings, administrator account management, role/deactivation session revocation, profile updates, secure employee CSV import and configuration status.
- Real report tables and CSV exports. Event cost output explicitly identifies estimates and unpriced assignments. Removed demo employee records and invented dashboard figures, including assumed annual leave allowances and payday dates.
- Checked-in PostgreSQL migrations, first-admin setup script, environment template and Render production Blueprint.

## Verification

90 automated tests pass using an isolated PGlite PostgreSQL-compatible database and all schema migrations. Coverage includes authentication/session/reset attacks, employee ownership with differing account/employee IDs, event persistence, attendance breaks, payroll calculations and state restrictions, leave self-approval and duplicate decisions, settings authorization, account linking/deactivation, employee dashboard, request construction, CSV escaping and mocked Supabase/R2/Resend calls. Supabase tests verify private object handling, endpoint validation and refusal to silently fall back to R2 when Supabase configuration is missing. Workforce tests cover dated scope, roster privacy, acceptance capacity/overlap, leave and contract checks, legacy scheduling conflicts and time zones. Helpdesk tests cover confidential queues and files, internal notes, assignment/revocation, transitions, concurrent changes and upload rollback. Timesheet tests cover private drafts, actual-time bounds, dated review grants, correction snapshots, overlapping claims, competing decisions, payroll permissions/inclusion locks and atomic revision rollback. Assignment review tests cover verified work, performance grants, employee responses, independent HR decisions, duplicate/concurrent writes, history preservation, scoped overview metrics and trend exclusions.

Strict TypeScript checking and frontend/server production builds pass. The frontend still emits a large-bundle warning. Browser checks with disposable records covered sign-in/session reload, employee list, payroll draft save/reload, report generation, company settings save, attendance/event screens, workforce setup/offer/acceptance/coverage confidential helpdesk request/assignment/reply/resolution/closure, and timesheet submission/reload/reviewer approval/payroll linking/lock persistence, and assignment review publication/dispute/HR amendment/employee acknowledgement with overview trends. These checks do not replace complete role-by-role acceptance testing against managed PostgreSQL.

## Remaining before production

- Apply/reconcile workforce, helpdesk and timesheet and review migrations through 0007 in staging. Complete timed observations linked to assignments, payroll time line items/adjustments, shift revisions/recurrence, qualification checks, advanced helpdesk routing/targets, configurable rating rubrics and review follow-up tasks, and the EOS adapter in subsequent enhancement slices. The EOS contract remains a proposal; it is not a live integration.

- Connect Supabase Free PostgreSQL with its Data API disabled, private Supabase storage, Resend Free with a verified sender and Render Free. Exercise real uploads/downloads, password-reset delivery and manual backup restore. Mock tests do not establish live integration success. No bank transfers are implemented.
- Verify the deployed Git revision and complete staging checks before promoting this source snapshot to production.
- Reconcile any existing database and explicitly configure company timezone, weekends, leave types/balances and employee-account links. Automatic accrual, holiday calendars and advanced multi-stage leave balance/workflow rules are not completed.
- Complete acceptance tests for recruitment/onboarding, performance reviews, roster scheduling, bulk import and every intended management role. Some advanced endpoints remain organization-scope-only; team/self variants are not fully implemented.
- Training and benefits pages were absent from the source and their dead sidebar links were removed. Training/LMS, QR/biometric devices, WhatsApp, Slack/AI and bank/WPS submission are outside the verified core workflows.
- Documents use private object storage, but legacy document links require re-upload. Formal payslip/WPS formats and country-specific payroll rules need confirmed business requirements.

See SETUP.md for reproducible commands. There are no live service credentials in this branch.
