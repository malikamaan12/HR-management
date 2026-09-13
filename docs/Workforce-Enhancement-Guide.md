# Workforce enhancement — first implementation

13 September 2026. Implemented locally; staging database migration and deployment are still required.

## What is available

Open **Workforce** in the sidebar. Permanent, temporary and contract employees use the same employee records. An operational team is classified as an event, FEC or mall activation and belongs to a named site with an IANA time zone.

- HR administrators create sites, teams, dated employee memberships and dated lead permissions.
- Leads see only teams and shift intervals covered by a currently active grant. A view grant permits roster reading; a scheduling grant also permits shift creation, offers and assignment cancellation. Grants can be revoked immediately.
- A shift records role, station, required headcount, start/end instants and planned break minutes. Overnight shifts are supported up to 24 hours. The UI enters times in the selected site's zone, and rejects ambiguous or nonexistent times caused by daylight-saving changes.
- Offers appear under **My shifts & offers** for the linked employee account. Employees can accept or decline before the shift starts. Administrators cannot accept on another employee's behalf.
- Acceptance checks full-shift membership, active employment dates, approved leave, other accepted workforce assignments, legacy Attendance/Event Staff schedules and remaining headcount. Offers do not reserve capacity.
- Managers can cancel future offers or accepted assignments with a reason visible to the employee. Responses and management changes are audited in the existing activity log.
- The dashboard shows accepted coverage, unfilled places, pending responses, roster status and members for the selected 14-day window. These are scheduling counts, not live attendance or payroll hours.

## First-time setup

1. Have an administrator apply the migrations through the documented setup process. For an existing database, reconcile its migration baseline first; do not blindly replay the initial schema.
2. Create or verify each employee in Employee Database and link the employee to their account in User Management. The account and employee IDs are intentionally different concepts.
3. In Workforce, add the site with its real time zone, such as `Asia/Qatar`, then add the operational team and work type.
4. Add employees with membership dates covering their full shifts.
5. Grant an active approved account **View roster** or **Create shifts and manage offers**, with explicit access dates. Workforce administrators are `super_admin`, `admin`, `hr_director` and legacy `hr`. Other roles require an explicit grant; a management title alone does not authorize this module.
6. Sign in as the lead, choose the team and create a future shift. Offer it to a member. The employee signs in to accept or decline.
7. Confirm the accepted-place count. A rejected acceptance returns a specific conflict; adjust staffing instead of treating a pending offer as confirmed coverage.

Use a regular employee account plus a dated grant when a person needs only operational supervision. A grant does not alter existing role permissions in other modules. It does not grant payroll, identity-document or confidential HR-case access.

The view starts at the selected UTC date and spans 14 days; individual shifts display in the site's local time. The API accepts explicit offset timestamps and permits a maximum 31-day read window. Historical accepted assignments remain accepted scheduling records; they do not imply completed work.

## Internal API

All endpoints are below `/api/workforce` and require the application's current authenticated session. This is an internal application API, separate from the proposed EOS machine API.

| Endpoint | Purpose / access |
|---|---|
| `GET /teams` | Current visible teams; administrators also receive site setup choices |
| `POST /sites`, `POST /teams` | HR administrator setup |
| `GET /directory?kind=employees&q=...` or `kind=users` | Administrator-only search, minimum 2 characters, maximum 20 minimal results |
| `POST /teams/:teamId/members` | Administrator adds dated employee membership |
| `POST /teams/:teamId/grants` | Administrator grants dated view/schedule access to an approved user |
| `POST /teams/:teamId/grants/:id/revoke` | Administrator revokes a grant |
| `GET /teams/:teamId/dashboard?from=...&to=...` | Team and date-scoped roster, counts derived by UI, minimal member details |
| `POST /teams/:teamId/shifts` | Administrator or currently authorized scheduling lead |
| `POST /shifts/:id/offers` | Offer to a member covering the full shift |
| `GET /my-assignments?from=...&to=...` | Only the current account's explicitly linked employee assignments |
| `POST /assignments/:id/respond` | Employee-only `{ "decision": "accepted" }` or `"declined"` |
| `POST /assignments/:id/cancel` | Scheduling lead/admin; `{ "reason": "..." }`, minimum 5 characters |

Mutations use transactions, row locks and a unique shift/employee assignment index. Repeated identical offers and responses are safe retries. Capacity is checked under a shift lock; conflicting assignments and legacy schedule writes synchronize on the employee row. Approved leave overlapping an accepted workforce assignment requires cancellation/replanning first. Database constraints also validate date ordering, shift duration, headcount and breaks.

## Verification and remaining work

42 automated tests pass: the 30 existing regression tests plus 12 workforce tests. New coverage includes authorization and date boundaries, confidential-field exclusion, account-to-employee ownership, acceptance races, overlap/adjacent shifts, leave, contract dates, legacy schedule conflicts, cancellation, audit records and time-zone conversion. Tests run on isolated PGlite; managed PostgreSQL concurrency and migration checks remain part of staging acceptance.

Strict TypeScript checking and production frontend/server builds pass. The existing large frontend-bundle warning remains. A browser walkthrough with synthetic accounts verified site/team/member/grant setup, lead shift creation and offering, employee acceptance, persistence after reload and updated lead coverage. Synthetic records and preview credentials are not shipped to the application or source repository.

This implementation is the workforce foundation, not the entire operations roadmap. Next slices:

1. Shift editing/cancellation and membership changes with preserved history and renewed employee consent; recurrence, replacements, qualification checks and staffing requirements.
2. Assignment-linked attendance, break exceptions, timesheet submission/approval and payroll locking. Employment or compliance changes after acceptance need explicit operational review.
3. HR helpdesk with confidential participants, assignment, status, internal notes and attachments.
4. Role-specific employee rating rubrics, evidence, employee responses and review/dispute handling.
5. Activation lifecycle and explicit legacy-event mapping, followed by EOS machine authentication, external IDs, idempotency, outbox/change feed and contract tests when EOS interfaces are available.

The migration adds six workforce tables; it does not auto-convert historical event assignments or infer employee consent. R2/Resend live configuration, hosting and GitHub publication remain separate setup work. WhatsApp stays deferred.
