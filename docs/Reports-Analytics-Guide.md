# Reports & Analytics workspace

This batch expands `/reports` within the existing application. It adds no paid service, external BI platform, licensing fee or email dependency. It is a local release batch; deploying requires migration `0044_reports_analytics_workspace` and the normal application build.

## Reports available

The catalogue shows only report types permitted by both Reports & Analytics and the underlying source module. Results are aggregates, not a directory of employee personal details.

| Report | Period / basis | Main measures |
| --- | --- | --- |
| Employee register | Current records | Department, employment type, status, employee count |
| Employee turnover | Joining / termination date endpoints | Opening, closing, exits, turnover percentage |
| Approved leave bookings | Booking start date | Approved bookings and saved charged days |
| Document expiry | Current documents, excluding archived | Valid, expired, expiring, future validity, no expiry |
| Event and FEC delivery | Shift start date in each site's timezone | Shifts, capacity, assignment outcomes, approved payable minutes |
| Attendance and supervisor approval | Attendance date | Approval/status groups, open sessions, saved work/overtime minutes, eligible work minutes |
| Payroll and payment status | Reviewed period start; legacy calendar month fallback | Basic, allowances, deductions, net amounts by currency/status; legacy row count |
| Recruitment pipeline | Application date cohort | Current stages, offers, accepted offers, days to accept and sample count |
| Onboarding and offboarding | Case start date | Case status, completed tasks, overdue pending tasks |
| Learning completion and quiz results | Enrollment creation in Qatar | Completion, overdue, expired certificates, submitted/passed quizzes, average submitted score |
| HR helpdesk service levels | Case creation in Qatar | Saved SLA targets, breaches, elapsed resolution hours |
| Published performance outcomes | Review cycle period end | Assessments, published sample count, thresholded average rating, acknowledgement, overdue review count |
| Expense approvals and reimbursement | Request date | Requests, recorded amounts and fulfilment by program/unit/status |
| Benefit requests and fulfilment | Request date | Requests, recorded amounts and fulfilment by program/unit/status |
| Equipment custody and returns | Current assignment records | Custody state, overdue returns and acknowledgements |
| Handbook acknowledgements | Current assignments by edition | Read/acknowledgement counts and overdue assignments |
| Announcement read receipts | Scheduled publication date in Qatar | Published/archived notices and saved read/acknowledgement counts |
| Qualification validity | Current credentials | Valid, expired, future validity and revoked credentials |
| Employment changes | Effective date | Changes by kind/status, approved changes awaiting application |
| Employee data readiness | Current records | Missing links/managers/departments/locations and status/date conflicts |

## Builder and exports

Choose a report, then the applicable department, employment type, location, site/team and date filters. Dates are inclusive. Current-record reports deliberately do not accept dates. Date presets include current month, quarter, year and the last 30 days. Comparisons use the immediately preceding equal number of calendar days, not necessarily the previous calendar month.

Generating creates a private immutable snapshot in one repeatable-read transaction. Cards, charts, tables, CSV and PDF use that saved result. The saved definition, scope, filters, generation time, Qatar as-of date and policy version make its meaning explicit. Source changes do not recalculate a saved result. Generate again for updated figures.

Search and sort saved rows, select visible columns, and browse 25 rows per page. Charts show up to 20 matching nonblank groups in table order; different currencies/units and performance cycles have separate selectors. CSV always exports all saved rows and columns. Print / PDF exports all saved rows with the selected columns; neither is limited by the on-screen search or page. Comparisons are included in both exports. CSV protects string cells against spreadsheet formula injection.

## Private views and schedules

Save a named view to reuse filters, comparison choice and column selection. Loading a view prepares the builder; generating creates fresh figures. Manage views to rename, replace with current builder settings, or archive. Version checks prevent overwriting another edit; a reason and history are recorded.

Create a schedule from the builder. It saves reports inside HR without sending messages. Schedules can be edited or paused, with private run history, last successful report, last check and failure details. Configuration changes create a new version; the same period may be generated again under that new version. The account limit is 30 schedules; edit existing schedules when the limit is reached.

- Daily: yesterday's completed Qatar calendar date.
- Weekly: last completed Sunday–Saturday.
- Monthly: last completed calendar month.
- Current-record report kinds use the same frequency but capture current data at execution.

The existing server checks after startup and every 15 minutes. Work runs in batches of 10, with a 30-minute retry/scan interval and a database advisory lock. The selected Qatar hour is an earliest execution time. Free hosting sleep can delay jobs. Waking processes the latest completed period and does not reconstruct missed historical snapshots. `Run my due schedules` performs the same due check for the signed-in owner. There is no guarantee of exact-hour delivery.

The scheduler reloads the owner's current approved account and role. Missing report/source permissions or inactive employment pauses the schedule. Other failures retain a safe error and retry later. A failed job rolls back its report and audit together; successful period keys prevent duplicate successful runs.

## Administration and access

Admin and Super Admin can revise the turnover denominator, maximum report rows (100–5,000), minimum published performance sample (1–50) and global scheduling switch. Every change requires a reason and version check. Rules are pinned into future reports; older snapshots retain their original policy. Document warning days remain in Company Settings. Attendance, payroll and leave reports use saved source calculations rather than silently recomputing them.

Department and manager reports intersect source access with reporting access before aggregation. Manager scope uses direct reports. Event scope requires current assigned workforce grants; event members/accepted upcoming assignments determine accessible employees. Detailed and aggregate salary/benefit/expense amounts are unavailable to team/event-only roles. Helpdesk confidential-case access and announcement audience management are checked separately. Private chat messages, case contents, candidate contact details, GPS, bank data and draft performance ratings are excluded.

Saved runs, views and schedules belong to their owner. Opening/exporting a run rechecks permissions and its saved scope evidence. Losing scoped team members, changing department, or losing event grants or restricted-service authority can require generating a new report. Scope expansion alone preserves older reports. An older organization-wide snapshot without scope evidence is denied to newly scoped roles. The database prevents edits/deletion of saved report runs.

## Release verification

The completed batch has 54 distinct passing reporting/migration checks: 35 analytics scenarios, 11 report/candidate regression scenarios, and 8 migration scenarios. Focused rechecks covered scope expansion/revocation and policy pinning after refinements. TypeScript and production client/server builds passed; the existing main-bundle size warning remains. Local browser checks used synthetic administrator and supervisor accounts for the catalogue, scoped totals, comparisons, saved views, scheduled generation and reporting rules. CSV contents and access were verified through integration tests; the in-app browser did not emit a download event during its CSV-button check. Native PDF save/print acceptance remains a browser-level check.

## Interpretation limits

These are operational snapshots of recorded data. They do not recreate past statuses, deleted records or prior employment spells. Counts of documents, qualifications, quiz attempts, bookings and assignments are not unique employee counts. Unrecorded attendance is not automatically absence. Internal awareness training is not an external professional certification. Recorded payment/fulfilment status is not bank settlement. Published-review sample suppression is a display rule, not a formal anonymization guarantee.

The old unrestricted report CRUD/query exports and speculative employee-risk endpoints return HTTP 410. Their database records are preserved; new reporting uses `/api/reporting/snapshots`. Existing legacy saved views/schedules are not silently migrated because their queries and access rules differ.
