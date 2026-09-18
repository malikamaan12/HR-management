# Onboarding review and checklist versions — 18 September 2026

Built on GitHub main `12d52db` and deployed application `1d00133`. This release extends the existing `/api/lifecycle` onboarding/offboarding workflow. It does not merge the older enhancement branch's incompatible onboarding tables or migration sequence.

## Delivered

- Checklist templates have a stable ID, incrementing versions, retained snapshots/reasons and an active/archive flag. Optimistic version checks reject stale revisions. Running workflows keep their tasks, owners, dates and template snapshot. HR template-authoring roles remain unchanged; administrators and super administrators publish company approval rules.
- Templates can require independent review for individual tasks and an exact document type for document tasks. Company rules can additionally require review for general, document or asset-return tasks, with a 1–365 calendar-day review target. Default rules preserve current behavior. Each new workflow pins its policy, and candidate-to-employee handoff uses the same path.
- Assigned owners submit evidence. Scoped, independent HR reviewers approve or return submissions with a reason. The employee concerned, task owner and submitter cannot approve that submission. Reopening, withdrawal or reassignment clears the previous review; completed tasks must be reopened by management before editing. Version checks prevent stale task editors from overwriting newer work.
- The task inbox includes own tasks, eligible independent reviews and overdue reviews. Queue/history pagination and server-side department/owner checks apply. Workflow lists expose summary fields only; detailed reasons and task evidence stay in scoped detail/history responses. Document storage keys and numbers are not copied into task responses/history.
- Document evidence must be a private upload for the employee, of the configured type, issued and unexpired as of the company business date. Submission pins its saved version, file and dates. Approval and final completion reject replaced or expired evidence. The user must reopen and resubmit updated evidence.
- Final completion requires every required task/review and rejects outstanding optional submissions until reviewed or withdrawn. Existing offboarding date, future-shift and last-administrator protections remain; completion still deactivates the linked account and sessions transactionally. History/audit writes commit with each state change.

## Compatibility and migration

Additive migration `0028_lifecycle_review_templates` adds template/task versions, review fields and policy storage. Existing tasks keep their status/evidence and do not acquire new approval requirements. No original migration changes. Legacy management endpoints remain read-only through the existing module-access guard.

New clients pass the selected template version when starting a workflow. Existing integrations may omit it and use the current active template. Task PATCH requires an evidence/update reason; review-required completion requests become pending submissions. Consumers should check the returned state. Workflow lists now contain summary fields, with full authorized data available from the detail endpoint.

Templates and workflow lists retain the existing unpaginated management limits (workflow list 500; employee/owner pickers 1,000). Large-directory selection and broader search remain extensions. Review targets are calendar days; there is no automated escalation or email dispatch in this release. Initial file uploads continue through the existing document module.

## Verification

The combined suite passed **265 tests across 20 files**, including the prior HR workflows and migration upgrades through 0025, 0026 and the previous live 0027. Empty migration/rerun and retained legacy checklist/evidence checks passed. TypeScript and client/server production builds passed. A final workflow-list privacy adjustment then passed all **10 lifecycle-governance tests**, and the server was rebuilt; the full suite was not repeated after that focused change.

An isolated browser preview with synthetic employees verified administrator rule publication, template creation, starting a temporary employee's checklist, employee evidence submission, independent HR approval, final completion, retained workflow history, template revision and both saved template versions. Production HR data was not used in these write tests. The preview used in-memory storage; actual file delivery and mobile viewport acceptance were not part of this pass. Client entry: `/assets/index-zEfJJFkk.js`; main bundle 627.62 KB minified / 179.69 KB gzip, with the existing size warning.

## Deployment

Live on the existing Render Free service `srv-dajuem0jo6nc73fb36r0` and Supabase Free. No paid resources, dependency or environment changes.

- Application commit: `659b5c99d76002c489dd46eff81d3bf7f137f1fe`, published to `malikamaan12/HR-management` main.
- Render deployment [dep-dampgmgu01pc73emvt8g](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dampgmgu01pc73emvt8g) succeeded on 18 September 2026 at 23:02 Qatar time. Startup confirmed `Database migrations completed` before the service became live.
- `/healthz`, `/readyz` and `/` returned HTTP 200 with the expected client entry `/assets/index-zEfJJFkk.js`. Unauthenticated `/api/lifecycle` and `/api/lifecycle/tasks/queue` returned HTTP 401.
- The existing live browser session is signed out. Authenticated production screen verification is pending the owner's sign-in; the full synthetic preview flow passed as described above. No production employee records, checklists or rules were created or changed during acceptance.

## Remaining flow

Next: equipment issue/return register and handbook acknowledgements connected to employee workflows. Broader transfers/incidents, employment continuity and retention/deletion rules still need reconciliation. Real file-delivery acceptance, verified Resend sender setup and EOS integration remain outstanding; WhatsApp is deferred. This release does not certify every HR module as complete.
