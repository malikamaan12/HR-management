# Local release readiness — 18 September 2026

Current checkpoint: Batch 14 is implemented and validated locally. See the Batch 14 section below for validation and the discovered live-branch divergence; historical Batch 13 figures below are retained for traceability.

Batch 13 completes a focused review of route permissions and workflow bypasses. This workspace contains the accumulated local batches 3–13. They have not been committed, pushed or deployed in this batch. The live release recorded on 15 September is historical deployment evidence; production was not inspected or changed during this review.

## Fixed in this batch

| Area | Result |
| --- | --- |
| Legacy route authorization | Permission checks now match Express's case-insensitive routing and decoded employee IDs. Malformed identifiers and encoded path separators fail closed. Recruitment dashboard totals require the same organization-wide access as recruitment records. |
| Event staff privacy | Profile, assignment, event roster, rating and communication-recipient lists filter employees in SQL. The existing event-manager role sees temporary employees under its event-staff scope; it cannot use these routes to read or create records for permanent staff. Employee-specific profile URLs enforce self access. Modern Workforce team grants remain separate. |
| Actor identity | Legacy event ratings use the signed-in user's active linked employee, constrain criterion scores to 1–5 and reject self-rating. Messages use the signed-in sender. Event creators cannot be overwritten, and adding a recipient cannot fabricate a read acknowledgement. These endpoints store records; this review sent no external messages. |
| Recruitment and approval bypasses | Removed duplicate legacy recruitment/onboarding handlers. Raw application, individual checklist-task and candidate updates are rejected. Direct insertion of leave approvals is rejected; leave decisions must use the workflow that checks scope, balances and evidence. Existing read aliases remain available to authorized HR. |
| Onboarding editing | The editor supports notes and cancellation with a reason, a current revision and transactional private history. Employee, checklist, dates and progress cannot be overwritten. Task reviews and document checks determine completion. Cancellation stops subsequent task changes. Failed history writes roll back the edit. |
| Page access | Shared navigation/page rules hide organization-only tools from restricted roles and display an access-restricted screen on direct navigation. Self-service workforce, helpdesk, timesheet and account pages remain available. API authorization remains authoritative. |
| Response handling | All API responses carry `Cache-Control: no-store`; unknown APIs return JSON 404 rather than the application's HTML. The reminder interval is cleared when its server closes. |

## Validation

- The complete regression run passed **285 tests across 23 files**, including 13 new tests against the actual registered application routes.
- Coverage includes anonymous and denied responses, case/HEAD/encoded-ID variants, self/team/event scopes, forged actors and workflow fields, onboarding revisions, cancellation and audit rollback. Existing module tests and empty-database/repeated migration checks passed in the same run.
- TypeScript and both production builds passed. Browser acceptance found a stale onboarding-history query after saving; the frontend cache invalidation was corrected, and final TypeScript/frontend builds passed. The final browser check saved a new note, reopened the editor without reloading and displayed both history entries. A temporary employee saw restricted navigation and an access-restricted screen when opening Settings directly. The preview tab and process were closed.
- Isolated browser acceptance uses synthetic accounts and an in-memory database. It is not production load testing or an exhaustive security assessment.
- The frontend remains approximately **1.704 MB minified** (454 KB gzip) in its main chunk and emits the existing size warning.

## Existing local workflow coverage

The accumulated batches cover employee records/corrections/imports; attendance corrections; leave ledger/accrual/carryover; event/FEC workforce scheduling, availability and replacements; scoped team queues; timesheets and payroll handoff; helpdesk routing/reminders/knowledge; assignment ratings and performance cycles; recruitment, interviews, offers and hiring handoff; reviewed onboarding/documents; offboarding and settlements; learning; expenses/benefits; equipment; handbook acknowledgements; probation; transfers/incidents; contract renewals; and return-to-work clearance. The [batch plan](LOCAL-COMPLETION-PLAN.md) records the precise limits of each implementation. A passing regression suite does not mean every screen, external integration or business policy is finished.

## Remaining work

| Priority | Work remaining | Acceptance needed |
| --- | --- | --- |
| Before production use of calculations | Configure the approved payroll cycle, rates, overtime, proration, leave and settlement rules through administrator controls. | HR/finance approval of example outputs. The confirmed management schedule remains Sunday–Thursday, 09:00–17:00, Asia/Qatar. |
| Next release acceptance | Verify the accumulated migrations and representative role workflows on the actual deployment after an explicit push/release instruction. Exercise private storage upload and signed download with designated synthetic files. | Deployment, database and storage evidence; no real employee data needed for smoke checks. |
| Data retention | Define cleanup/retention for staged import rows, former document versions and audit/history records. | Approved retention periods and recoverability rules before implementing deletion. No cleanup policy is inferred. |
| EOS | Integrate the implemented HR-side API contract with EOS when its endpoints and authentication are available. Outbound signed webhooks, delivery retries and cross-system reconciliation remain pending. | EOS contract, test environment and end-to-end acceptance. See [EOS API v1](EOS-API-v1.md). |
| Email / WhatsApp | Complete Resend sender/domain configuration and verify delivery; WhatsApp is deferred as requested. | An approved sender and integration configuration. Keep the user's no-paid-services constraint. |
| Next engineering batch | Broader legacy report/export/communication handler audit, legacy event screens versus Workforce consolidation, versioned candidate corrections, and frontend loading/accessibility improvements. | Role-specific end-to-end acceptance, including mobile layout and larger data sets. Retired raw candidate editing is not a replacement candidate-correction feature. |

The next batch should consolidate and finish these existing workflows before adding more disconnected module screens.

## Batch 14 — reporting, candidate corrections and shared operations (18 September 2026)

Implemented owner-private report snapshots and exact saved CSV export; explicit headcount, date-based turnover, saved approved leave bookings, derived document expiry and site-timezone workforce delivery definitions; versioned administrator reporting policy; candidate correction history and identity locks after the first offer; a shared Workforce entry for event/FEC operations with earlier event records; and route-level loading with a recovery screen.

Validation: 294 of 295 tests passed in the consolidated run. The one failing new test omitted a mandatory synthetic timesheet note; after fixing the fixture, all 10 affected report/candidate tests passed. The combined result covers 295 tests across 24 files. TypeScript and both production builds passed. Main bundle: 612.14 KB minified / 178.78 KB gzip, down from 1,704.41 KB / 454.10 KB. A size warning remains. Isolated browser acceptance verified saved report generation/reopening, CSV action, candidate correction/version/history, shared Workforce and archive navigation, and a 390 px report layout. No production records were created.

Release reconciliation: freshly fetched GitHub main is f0904f7c90012d4bd4c8a8df37224925db510ccb. Render is live at f69d23839ddc99d9cd8a59a1893f82046adcfec4. Main has a separate implementation and migration history from this development branch. Do not deploy this branch directly or replace the live migration journal. Preserve it as the tested local-module branch, and port this batch onto the live baseline with additive migrations and an upgrade check. Earlier local batches require separate compatibility reconciliation before release.
