# Assignment reviews and team overview

14 September 2026. Implemented and verified locally. Staging migration and deployment are still required.

## Review completed work

Open **Team overview** to see assignments missing a review, or **Assignment reviews → New review**. A review can be published only for an accepted workforce assignment whose shift has ended and whose timesheet is approved or linked to processed payroll. It supports permanent, temporary and contract employees working in event, FEC and mall-activation teams.

Each assignment has one published review. The reviewer records role expectations, a summary, four criterion ratings and supporting examples. Version 1 of the rubric covers punctuality, service, teamwork and role-specific skills. Its anchors are 1 — Needs substantial support, 2 — Needs improvement, 3 — Meets expectations, 4 — Exceeds expectations and 5 — Exceptional. Unobserved criteria can be N/A, with an explanation. At least one criterion must be rated; every criterion needs an example or an explanation for N/A. Scores of 1 or 2 also require improvement actions.

The reviewer explicitly confirms observed work and the supporting examples before publishing to the employee. The rubric definition and version are saved with the review. There are no preselected numeric scores, automatic ratings, employee rankings, pay adjustments or employment decisions. Improvement actions are recorded as text, including any agreed follow-up dates; a task-completion workflow is not yet included. Unsaved form content is not a persisted draft.

## Employee responses and HR decisions

Employees find their own feedback in **Assignment reviews → My reviews**. They can acknowledge receipt, add their perspective, or dispute the review with an explanation. Acknowledging receipt does not require agreement. After acknowledgement or a comment, the employee can still raise a dispute. Each current HR decision permits one initial response and a later dispute; competing or stale responses return HTTP 409.

Disputed reviews enter an HR queue and are excluded from performance trends. An independent HR administrator may uphold the existing ratings, amend the ratings/evidence/actions, or withdraw the review. The original author and the employee being reviewed cannot make that HR decision, even if they hold an administrator role. A second eligible HR administrator is therefore needed for a dispute involving an HR-authored review.

HR can also amend or withdraw a published/resolved review to correct an error before a dispute. Upholding requires an active dispute. Every HR decision requires an employee-visible reason. Amendment/upholding permits another employee response; earlier responses and scores remain in revision history. Withdrawal is terminal in this first implementation, keeps the record/history, and does not allow another review to replace it silently.

The original author cannot directly edit a published review. Creation, employee responses and HR decisions write a complete snapshot in the same transaction. Revision update/delete APIs do not exist. Database administrators retain their normal database powers. Review information is not copied into organization-wide activity-log details.

## Permissions

In **Workforce → Lead access**, HR grants **Review performance** (`review_performance`) for a named account, team and date interval. This is separate from **Review timesheets**, scheduling and roster-view permissions. A lead's current, unrevoked grant must cover the entire scheduled assignment. For historical work the start must cover the work date, and the end must still be in the future when reviewing. Grant both permissions when a lead should approve time and rate assignments.

| Actor | Access |
|---|---|
| Linked employee | Own published reviews and history; acknowledgement, comment and dispute |
| Lead with current `review_performance` grant | Reviews and eligible assignments inside that dated team scope; publish for other employees |
| Workforce HR administrators (`super_admin`, `admin`, `hr_director`, legacy `hr`) | Organization-wide review access and publication except self-review; independent HR decisions except on their own employee review or a review they authored |
| Lead with scheduling, roster view or `review_time` only | No performance review access through those permissions |
| Finance/payroll role | No performance access through payroll permission; own employee reviews remain available |

Revocation, expiry and account deactivation affect subsequent API requests. Previously loaded information cannot be recalled from a user's browser. Review responses and decisions are visible to the employee, authorized team reviewers and HR. Confidential employee-relations concerns belong in **HR Helpdesk**, with its separate privacy rules. Helpdesk participants do not receive review access merely by participating in a case.

## Team overview

The new **Team overview** page combines four operational views for a selected accessible team:

- **Staffing now and over the next 14 days:** live/upcoming shifts, accepted/required places, per-shift unfilled places and offers still awaiting reply. Accepted assignments count as coverage; offers do not reserve places and offers on started shifts are excluded from the pending count. Up to ten staffing gaps are listed, with a link to the team's workforce page.
- **Time awaiting approval:** submitted timesheets covered by `review_time`, excluding the viewer's own time; totals and up to ten direct links. Payroll details are not included.
- **Assignments missing a review:** completed assignments with approved time and no review, covered by `review_performance`, excluding self-review; totals and up to ten direct links to the review form.
- **Performance trends:** current criterion averages and sample counts grouped by assignment work month in UTC, plus counts for included reviews, missing responses, disputes, withdrawals and changed time approvals.

Time/review views use the selected work-date interval, with a 31-calendar-day default and a 90-day maximum. Staffing always uses now through the next 14 days independently of that historical filter. Actual displayed shift dates use the site time zone. Counts and lists are scoped before returning data. A section without its required permission returns unavailable rather than pretending its total is zero.

Trends include published/resolved reviews with currently approved or payroll-linked time. Disputed and withdrawn reviews are excluded. If HR returns the underlying timesheet for correction, the review remains visible but is excluded until time is approved again. N/A values do not contribute to criterion averages. Punctuality, service and teamwork are summarized under rubric version 1; role-specific skills remain on individual reviews because role expectations differ. These are current-state descriptive summaries grouped by work month, not immutable historical reports of what was known at each month end. Viewers' own employee reviews are excluded from their team overview and remain in My reviews.

## Internal APIs

All endpoints require a current application session and return `Cache-Control: no-store`.

| Method/path under `/api/assignment-reviews` | Purpose |
|---|---|
| `GET /config` | Current permissions and the rubric |
| `GET /assignments` | Scoped eligible assignments; optional teamId, from/to and page; 25 per page |
| `GET /assignments/:id` | A specific eligible assignment for the dashboard's review link |
| `GET /` | Scoped review list/count: view=mine/team/disputes, optional teamId/status/from/to/page; 25 per page |
| `POST /` | Publish with assignmentId, confirmed=true and ratings |
| `GET /:id` | Authorized review, capabilities and revision history |
| `POST /:id/respond` | Version, kind=acknowledge/comment/dispute and message |
| `POST /:id/resolve` | Version, outcome=uphold/amend/withdraw and reason; amendment also requires ratings |

`GET /api/team-overview?teamId=...&from=...&to=...` returns the separately scoped staffing, time and review summaries. Date windows use scheduled start in the half-open UTC interval `[from,to)`. The HR dispute queue is date-filtered like the other review lists; expand the work-date range to find older cases.

These endpoints use internal session authentication. They are not the proposed external EOS API and do not issue EOS credentials or send webhooks.

## Verification and deployment

83 automated tests pass across nine suites, including 15 new review/overview integration tests against a disposable PGlite database with all migrations. Coverage includes explicit permissions, current/full-date grants, private employee access, completed/approved-time eligibility, duplicate publication, score/evidence validation, self-review, independent HR decisions, employee response transitions, competing writes, immutable version history, scoped queues/counts, staffing gaps, trend exclusions and rollback when history writing fails. Strict TypeScript and frontend/server production builds pass. The existing large frontend-bundle warning remains.

Browser checks used synthetic accounts and covered the lead overview, direct missing-review link, review publication with examples, employee dispute, HR queue, amended rating/evidence, reload persistence, updated trends and employee acknowledgement of the HR decision. No browser console errors were observed. No real staff were rated and no emails, cloud writes, pay changes or external integrations were performed.

Apply `0007_assignment_reviews.sql` after the previous migrations using the repository's staging migration procedure. It creates the performance grant value and review/history tables, constraints and indexes. It does not grant access automatically or convert legacy event/annual reviews. The existing formal performance module remains separate from these assignment reviews.

Before production: confirm the rubric wording with HR, assign dated reviewer grants, ensure independent HR coverage, verify with managed PostgreSQL and complete employee/lead/HR acceptance testing. Configurable rubric administration, evidence attachments, email notifications, task tracking for improvement actions, review SLAs, external EOS APIs and exports remain future work.
