# Onboarding and offboarding experience

The live `/onboarding` route uses `Lifecycle.tsx`. Its long combined page has been reorganized into an employee overview and a focused checklist for the selected workflow.

## Employee overview

- Separate joining, leaving and all-workflow views.
- Searchable, paginated employee cards with required-task progress, workflow state, joining/exit date, overdue tasks and pending reviews.
- Summary cards calculated from the visible workflow list. The existing 500-record API limit is disclosed when reached; these are not unbounded company totals.
- A separate task inbox retains assigned tasks, independent reviews and overdue reviews. Opening a task focuses that task within its employee checklist.
- A start-workflow dialog previews the selected saved template and opens the created workflow after a successful save.

## Employee checklist

- Checklist, Training, Salary & Benefits and History sections reduce the amount of content shown at once.
- Required-task progress is distinguished from final completion eligibility. Partial viewers are told that their progress covers only visible tasks.
- Completion requirements show outstanding required tasks, pending independent reviews, required induction, handbook acknowledgements, recorded compensation, equipment clearance and the exit date, as appropriate to the workflow type and viewer access.
- Task updates and independent reviews use focused dialogs. Evidence is collapsible in the task table, and tasks can be filtered by pending, review, completed or required state.
- Completion is disabled while known blockers remain. Final server-side document/evidence validation and existing completion checks remain authoritative.
- Completion and cancellation use distinct decision dialogs. Offboarding retains explicit confirmation that employee access will be revoked.

## Permissions and data

The compensation section now opens only for viewers admitted by the same employee/self and payroll-access scope used by the compensation API. Cancellation controls match the existing independent-HR requirement for offboarding. Task owners are no longer shown an update action for a completed task that only a manager may reopen.

The existing workflow/template schemas, version checks, review rules, assignment rules and completion mutations are retained. New API fields expose counts, current business date, UI capabilities and completion-requirement status; they do not invent workflows, preset checklist content or create employee data. No new database migration is required for this change.

## Release status

Production frontend and server bundles compiled successfully. The existing large shared frontend-chunk warning remains. No tests, type-check suite, browser audit or production database mutations were performed, following the user's instruction to skip tests and audits.

Not deployed. The preceding Helpdesk and org-chart changes are also pending deployment; the Helpdesk update requires migration `0048_helpdesk_workspace` when the combined release is deployed.
