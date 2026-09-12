# E3 HR status — 13 September 2026

Core application repairs are implemented and ready for staging verification. This is not a claim that every advanced workflow is production-ready.

## Implemented

- Real authentication and approval checks, separate signing secrets, hashed passwords, rotating sessions, lockout, logout/session revocation, and one-time Resend password resets. Browser tokens are held in memory and secure cookies; no default administrator bypass or seed password.
- Fixed frontend request argument handling, HTTP methods, request bodies, query filters and employee IDs. Removed the full-project TypeScript errors.
- Real employee, event profile, roster, assignment, event rating and communication persistence. Explicit unique account-to-employee linking; account linking cannot be changed through ordinary employee edits.
- Scoped employee, attendance, leave, payroll and document access. Legacy advanced management endpoints fail closed when they cannot support the caller's scope. Targeted announcements filter their audience.
- Attendance state transitions, duplicate clock prevention, multiple breaks, manual records and report queries. Work totals exclude breaks. A failed clock request is not automatically repeated.
- Leave requests force pending status, calculate working days from saved weekend settings, require approval permissions, deny self-approval and prevent repeated decisions.
- Payroll draft create/edit, integer-cent calculation, duplicate-period prevention, protected processed records, CSV export, print and external payment-reference recording.
- Private R2 uploads and authorized expiring download links, content validation, upload rollback cleanup and actual employee names.
- Persisted company settings, administrator account management, role/deactivation session revocation, profile updates, secure employee CSV import and configuration status.
- Real report tables and CSV exports. Event cost output explicitly identifies estimates and unpriced assignments. Removed demo employee records and invented dashboard figures, including assumed annual leave allowances and payday dates.
- Checked-in PostgreSQL migrations, first-admin setup script, environment template and Render staging template.

## Verification

30 automated tests pass using an isolated PGlite PostgreSQL-compatible database and all schema migrations. Coverage includes authentication/session/reset attacks, employee ownership with differing account/employee IDs, event persistence, attendance breaks, payroll calculations and state restrictions, leave self-approval and duplicate decisions, settings authorization, account linking/deactivation, employee dashboard, request construction, CSV escaping and mocked R2/Resend calls.

Strict TypeScript checking and frontend/server production builds pass. The frontend still emits a large-bundle warning. Browser checks with disposable records covered sign-in/session reload, employee list, payroll draft save/reload, report generation, company settings save, and attendance/event screens. These checks do not replace complete role-by-role acceptance testing against managed PostgreSQL.

## Remaining before production

- Connect a staging PostgreSQL database, Resend verified sender, private R2 bucket and hosting environment; exercise real uploads/downloads, password-reset delivery and backup restore. No real emails, cloud buckets, deployments or bank transfers were performed.
- Verify the deployed Git revision and complete staging checks before promoting this source snapshot to production.
- Reconcile any existing database and explicitly configure company timezone, weekends, leave types/balances and employee-account links. Automatic accrual, holiday calendars and advanced multi-stage leave balance/workflow rules are not completed.
- Complete acceptance tests for recruitment/onboarding, performance reviews, roster scheduling, bulk import and every intended management role. Some advanced endpoints remain organization-scope-only; team/self variants are not fully implemented.
- Training and benefits pages were absent from the source and their dead sidebar links were removed. Training/LMS, QR/biometric devices, WhatsApp, Slack/AI and bank/WPS submission are outside the verified core workflows.
- Documents use private object storage, but legacy document links require re-upload. Formal payslip/WPS formats and country-specific payroll rules need confirmed business requirements.

See SETUP.md for reproducible commands. There are no live service credentials in this branch.

