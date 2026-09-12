# E3 HR — next-generation product and delivery plan

13 September 2026 · Proposed roadmap, not a production-readiness certification

Expanded after comparison with Workday, SAP SuccessFactors, Rippling, BambooHR, HiBob, Deputy and Bayzat: see [competitive gap assessment](HR-Competitive-Gap-Plan.md). It adds employee services, expenses/advances, benefits, compensation/headcount planning, learning, employee listening and event margin workflows. These additions require separate scope selection and re-estimation; the ranges below do not cover the entire expanded backlog.

## Product direction

Build one workspace for permanent employees, contract employees and event staff: a reliable employee record, a shared approval inbox, and a mobile-friendly self-service portal. Improve the current React/Express/PostgreSQL application incrementally. A full rewrite would delay the workflows that are already implemented.

The first release should let HR onboard someone, link their account, record attendance, approve leave, manage documents, prepare payroll and produce reports with a traceable history. The distinctive next-generation capability is event workforce operations: availability, skills, roster conflicts, shift acceptance and approved hours flowing into payroll.

Assumptions: initially one organization with multiple departments and locations; Qatar-focused operations; HR owns policy decisions; one primary developer with regular HR/payroll reviewer access. Multiple customer organizations, commercial SaaS billing and native mobile applications require a separate scope decision.

## Delivery sequence

Estimates below are planning ranges after credentials and policy inputs are available. They are not commitments and exclude external bank/vendor approval delays.

| Phase | Proposed effort | Deliverables | Exit criteria |
|---|---|---|---|
| 0 — Establish staging | 3–5 working days | GitHub baseline, CI, isolated managed PostgreSQL, private R2, Resend sender, migrations, administrator setup, error monitoring and restore rehearsal | A fresh environment can be built from the repository; real test upload/download and password reset work; restore succeeds; no production employee data in tests |
| 1 — Complete core operations | 2–3 weeks | Role and field permissions, manager/team workflows, employee lifecycle, approval inbox, holiday calendar, leave ledger, reliable attendance corrections, document versioning | Employee/manager/HR/admin acceptance matrix passes, including forbidden actions; concurrent approvals and clock actions are safe; every sensitive change has an audit event |
| 2 — Payroll and event operations | 3–4 weeks | Effective-dated salary components, payroll preview/approval/lock, payslips, adjustment ledger, event roles/rates, roster conflicts, shift acceptance, timesheet approval | Approved hours reconcile with payroll; agreed payroll examples match to the cent; processed periods cannot silently change; employee payslips are private |
| 3 — Employee experience | 2–3 weeks | Responsive portal/PWA, English/Arabic and RTL, accessible forms, task inbox, onboarding/offboarding checklists, document reminders and delivery tracking | Critical journeys work on mobile and keyboard; HR and employee users complete a guided pilot; reminders are idempotent and failures are visible |
| 4 — Assisted HR and integrations | 2–4 weeks, separately prioritized | Permission-aware policy assistant, document extraction for review, draft HR communications, skills-based roster suggestions; then selected WhatsApp/accounting/LMS connectors | Suggestions cite sources where applicable; humans approve consequential actions; evaluation cases pass; integration retries cannot duplicate effects |

Suggested first pilot: one HR reviewer, one payroll reviewer, two managers and a small employee/event-staff group using synthetic data first. Expand only after an entire approved pay period has been reconciled.

## Priority backlog

| Priority | Work item | Acceptance example |
|---|---|---|
| P0 | Enforce resource and field permissions consistently | A manager can see direct reports' attendance but cannot read another team's identity documents or salary |
| P0 | Use managed PostgreSQL in integration tests | Migrations, joins, transactions and concurrent decisions pass on the same database engine used for staging |
| P0 | Establish live R2/Resend checks | Upload, authorized download, expired link, rejected cross-user access and password reset delivery are verified |
| P0 | Remove remaining simulated-success paths | Every enabled action persists data or clearly explains an unavailable capability |
| P1 | Implement a leave ledger | Entitlement, accrual, reservation, approval, cancellation and adjustments reconcile without double deduction; holiday and cross-year cases are tested |
| P1 | Build the approval inbox | Configured approvers can approve once, delegate with expiry and record reasons; self-approval policy is enforced server-side |
| P1 | Reconcile attendance and payroll | Timezone, overnight shifts, breaks, missing clocks and corrections are resolved before a period is locked |
| P1 | Add payroll approval and payslips | HR previews calculations, an authorized reviewer approves, finance records settlement, employees see only their own payslips |
| P1 | Complete event staffing | Availability and overlapping shifts are checked; rate changes do not rewrite historical approved costs |
| P2 | Complete recruitment and offboarding | Candidate-to-employee conversion preserves required records; offboarding revokes access and tracks assets/checklists |
| P2 | Improve performance and learning | Goals and review visibility follow policy; skills/training track explicit evidence and completion |
| P2 | Improve reporting | Definitions and date semantics are visible; exports use scoped data, neutralize CSV formulas and record who exported |

## Architecture

Keep a modular server with separate employee, attendance, leave, payroll, staffing, document and identity services. Move business rules out of route handlers. Share validated API contracts with the frontend and use transactions for state transitions.

| Layer | Proposed choice | Purpose |
|---|---|---|
| Web application | Existing React + TypeScript, responsive PWA first | Reuse implemented screens; add route-level loading and a consistent design system |
| API hosting | Render Node web service for the existing Express app | Keep frontend and API on one origin initially; Render supports Express deployment ([documentation](https://render.com/docs/deploy-node-express-app)) |
| Business records | Managed PostgreSQL + Drizzle migrations | Employees, permissions, payroll, workflow state, audit and notification jobs |
| Files | Private Cloudflare R2 | Store document objects; keep metadata and authorization in PostgreSQL. R2 supports the S3 SDK and expiring signed URLs ([documentation](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)) |
| Email | Resend | Transactional delivery using configured API credentials and a verified domain ([documentation](https://resend.com/docs/send-with-nodejs)) |
| Background work | Transactional outbox and worker, initially using PostgreSQL | Reliable reminders, exports and email with retries, idempotency and failure review |
| Observability | Structured logs, request IDs, error tracking and health/readiness checks | Diagnose failures without logging document content, credentials or sensitive HR payloads |

Vercel is not needed for the first release: keeping the existing application together is a project-specific architecture decision. Reassess a separate frontend deployment only if a measured operational need appears. R2 complements the database; it does not replace it. Select hosting regions and data-retention rules with the business before production provisioning.

## Data model changes

- Preserve a single person/employee identity with explicit account links, employment assignments, contracts and effective dates. Support different employee types through policy and assignment data.
- Add company/location/department membership and reporting relationships. Introduce organization isolation before serving multiple independent customers; test it on every access path.
- Model leave and payroll as appendable ledgers with controlled adjustments, not mutable totals alone. Store policy versions and calculation inputs alongside results.
- Separate event schedules, assignments, accepted shifts, recorded timesheets and approved payable hours. Record rates at the time of approval.
- Add document versions, classification, retention dates and scoped access events. Scan uploads and quarantine suspicious content before future automated extraction.
- Add workflow definitions, instances, decisions, delegations, notifications and outbox records. Each action needs an actor, timestamp, state and idempotency key.

## AI features worth building

1. Policy answers: retrieve only policies the employee may read, cite the relevant version and explain uncertainty. HR publishes approved policy content.
2. Document assistance: suggest extracted fields and expiry dates from authorized documents; require confirmation before saving changes.
3. HR drafting: draft announcements, onboarding tasks and letters from approved templates. Sending remains a separate user action.
4. Roster assistance: suggest staff based on availability, declared skills, qualifications and conflicts, with an explanation and manager review.

Do not introduce automatic hiring rejection, disciplinary decisions, employee risk scores or autonomous payroll changes. Treat uploaded text as untrusted content, separate tools from retrieved instructions, log assistant actions without sensitive payloads, and evaluate both permission leakage and factual accuracy. Choose the AI provider after confirming data handling, budget and evaluation requirements.

## Release gates and proposed targets

- Security: no unresolved high-severity findings; tests cover every supported role/resource combination and sensitive export/download path. Require MFA for administrators before production expansion.
- Correctness: agreed payroll fixtures reconcile exactly; leave ledger reconciliation is automatic; duplicated requests cannot produce duplicated payroll, approval or notification effects.
- Reliability: test restoration into an isolated database and record observed recovery time. Proposed starting objectives are a maximum 24-hour data-loss window and 4-hour restoration window, subject to the selected backup service and business approval.
- Performance: proposed p95 normal API response below 500 ms at an agreed pilot workload; larger reports run as jobs. Establish a measured baseline before setting scale claims.
- Delivery: CI runs typecheck, meaningful tests and production build; staging gets a migration rehearsal; production releases have a verified rollback procedure. Code rollback alone is not a database rollback.
- Acceptance: HR signs off policy behavior, payroll signs off calculations/file formats, and representative employees complete the main journeys.

## First implementation sprint

1. Connect staging credentials and verified sender domain; apply migrations only to a new database after review.
2. Add CI and managed-PostgreSQL test coverage; re-run the existing 30 tests and build in CI.
3. Finish a role-by-role acceptance matrix for the current application; prioritize actual failures before additional features.
4. Specify leave and payroll policies using worked examples; implement the leave ledger and approval state transitions first.
5. Add readiness monitoring, outbox delivery and a backup-restore rehearsal.

Inputs needed to refine the roadmap: approximate workforce and concurrent event size, organizational structure, approvers, working week/holidays, leave and payroll rules, required bank file format, supported languages and pilot owners. No specific legal entitlement or bank integration is assumed to be verified by this plan.
