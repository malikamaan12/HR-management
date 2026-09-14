# Assignment timesheets and team review

14 September 2026. Implemented and verified locally. A staging database migration and deployment are still required.

## Employee workflow

Open **Timesheets → Report time**. Choose a completed, accepted workforce assignment from the selected date range. Enter actual start, finish, total break minutes and optional work notes in the site's time zone. Scheduled times are displayed for reference; they are never automatically treated as actual attendance. Save a draft or confirm actual hours and submit for review.

Each assignment has one timesheet, whether its employee is permanent, temporary or contract and whether the team supports an event, FEC or mall activation. The account must be explicitly linked to that employee. Previous employment ending does not erase the ability to report earlier accepted work through an active account.

Times must be complete minutes, last no more than 24 hours, overlap the scheduled assignment and finish in the past; the scheduled shift must also have ended. Breaks must be shorter than the elapsed duration. Worked minutes equal elapsed minutes minus breaks. Overlapping actual intervals across submitted, approved or payroll-linked timesheets are rejected, even when scheduled assignments themselves do not overlap. Adjacent intervals are allowed. Because this first version stores total break duration rather than timed break segments, overlapping outer intervals require correction instead of attempting to infer whether breaks eliminate the overlap.

## Team review and corrections

HR administrators grant **Review timesheets** in **Workforce → Lead access**. This permission is separate from scheduling and view permissions. A reviewer must hold a currently effective, unrevoked grant covering the entire scheduled shift. For past shifts, the grant's start must cover the work date and its end must still cover the review date. Grant both scheduling and review permissions if the lead needs both responsibilities.

The reviewer selects **Team review**, opens a submitted record and either approves or returns it with an employee-visible reason. Approval requires payable minutes and a policy/agreement reference. Payable minutes are stored separately from worked minutes, allowing an explicit paid-break decision without changing employee-reported actuals. Payable minutes cannot exceed the reported elapsed duration. Zero payable minutes require the same recorded reason and policy reference as other approvals. No overtime multipliers, statutory rules or pay amounts are inferred.

Returned records can be corrected and resubmitted by the employee. A different HR administrator can return an approved, unlocked record for correction; this clears its current payable approval while preserving the earlier approved values in history. Employees and reviewers cannot edit submitted or approved actuals directly. No one can review their own record, including administrators.

Statuses: **Draft → Awaiting review → Approved**, or **Awaiting review → Needs correction → Awaiting review**. Approved records can be returned by HR or linked to payroll. Every creation, edit, submission, review, correction request and payroll link writes a versioned snapshot in the same database transaction. Competing/stale writes return HTTP 409. Revision update/delete endpoints do not exist; database administrators retain their normal database powers.

## Payroll inclusion

Users with organization-wide payroll read permission can view approved and payroll-linked time. Organization-wide payroll approval permission is required to link it. Finance-only readers see the approved current record without earlier draft history. Team review permission does not expose salary or banking fields.

The payroll approver selects an existing **processed payroll record for the same employee** and explicitly confirms that it already includes the approved payable time. Linking records the payroll ID, actor and timestamp, then locks the timesheet. It does not calculate pay, change payroll amounts, mark a pending payroll paid, or send money. The payroll approver cannot link their own timesheet.

The selected payroll period is an explicit manual attestation; this version does not allocate cross-month work automatically or prove inclusion from a payroll line-item calculation. Payroll-linked records cannot be reopened through this API. Request corrections through **HR Helpdesk** and handle any adjustment separately until a dedicated adjustment workflow is implemented.

## Access summary

| Actor | Access |
|---|---|
| Linked employee | Own assignments/timesheets, draft edits, corrections, submission and full revision history |
| Lead with `review_time` | Non-draft records for shifts fully covered by current dated team grants; approve/return submitted records except their own |
| Workforce HR administrators (`super_admin`, `admin`, `hr_director`, legacy `hr`) | Non-draft records across teams, review and return approved records for correction, except their own |
| Organization-wide payroll reader | Approved and payroll-linked current records |
| Organization-wide payroll approver | Payroll reader access plus confirmation/linking, except their own |

Drafts remain private to their employee until submission. Once submitted, authorized team/HR reviewers can inspect the earlier revisions. Current session, role and grant checks apply on each API request; revocation removes subsequent access. This does not grant EOS or HR-helpdesk participants access to time records.

## Internal API

All endpoints use `/api/timesheets`, require a current session and return `Cache-Control: no-store`.

| Method/path | Purpose |
|---|---|
| `GET /config` | Current review/payroll capabilities |
| `GET /assignments` | Own accepted, completed assignments without a timesheet; 25 per page |
| `GET /` | Scoped list/count: `view=mine`, `review` or `payroll`; optional status, page, from/to |
| `POST /` | Own draft with assignmentId, actualStartAt, actualEndAt, breakMinutes, employeeNote |
| `GET /:id` | Current record, action capabilities and authorized revision history |
| `PATCH /:id` | Own draft/returned actual fields plus version |
| `POST /:id/submit` | Submit with version; overlap check serialized by employee |
| `POST /:id/review` | Version, decision, reason; approval also requires payableMinutes and policyReference |
| `POST /:id/reopen` | HR correction request with version and reason |
| `GET /:id/payroll-options` | Up to 100 recent processed payroll choices for this employee; payroll approvers only |
| `POST /:id/payroll-lock` | Version, payrollId and confirmed=true |

List windows use scheduled shift start in UTC, half-open `[from,to)`, with a maximum of 90 days. The page defaults to the latest 31 calendar days and labels its date filters UTC; actual entries and displayed shift times use the site time zone. Date filters can be moved backwards for historical work. List pages contain 25 records. IDs and data are scoped before list/count results are returned.

These are internal session-authenticated HR endpoints, not the proposed external EOS API. The EOS adapter, service credentials, webhook/outbox delivery and rate-limited external contract remain separate work.

## Verification and deployment

68 automated tests pass, including 13 timesheet integration tests against a disposable PGlite database with all migrations. Tests cover employee identity, private drafts, accepted/completed work, minute/duration validation, duplicate creation, dated/revoked permissions, self-approval, correction history, competing decisions, actual-time overlaps, payroll read/approval separation, payroll ownership/status, locked records and transaction rollback on revision failure. Strict TypeScript and frontend/server production builds pass. The existing frontend bundle-size warning remains.

Browser verification with synthetic accounts covered completed-assignment selection, actual-time entry, confirmation/submission, reload persistence, scoped team review, approval with a policy reference, finance payroll selection and locking, and reload of the locked record. No browser console errors occurred in that preview. No real employee records, cloud services, emails or payments were used.

Apply migration `0006_workforce_timesheets.sql` after the existing migrations using the repository's staging migration procedure. It adds the explicit review permission, timesheet/revision tables, constraints and indexes. It does not create grants, convert schedules to worked time or modify existing payroll amounts. Verify against managed PostgreSQL and complete role-based acceptance testing before production.

Next enhancements: assignment-based employee ratings with evidence and employee responses; shift revisions and recurrence; timed attendance observations linked to assignments; payroll line items, adjustments and approved-time exports; company pay-policy configuration; and the versioned EOS integration.
