# Workforce operations and recurring rosters

Updated 16 September 2026. Deployed in release `c2727e7`; the production migration journal is verified. Migrations 0019–0020 add recurring rosters, preserved shift revisions, availability, verified qualifications and replacement staffing.

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

### Recurring rosters and shift changes

In **Workforce → Team workspace → Recurring shifts**, choose the role, station, headcount, break, first/last dates, weekdays and site-local hours. Choose **Following day** for overnight work. **Preview shifts** shows every occurrence before **Create shifts** saves the batch. Offer each occurrence to team members afterward. Existing company and employee policy settings remain in HR Rules.

- A batch contains 1–60 occurrences across at most 90 calendar days. Every occurrence must be future-dated and fully covered by the lead's current scheduling access. A rejected date or permission rolls back the entire batch.
- Each local date is converted independently in the site's time zone, preserving recurring wall-clock hours across daylight-saving changes. Skipped/repeated clock times are rejected for explicit correction. Shifts still have a maximum elapsed duration of 24 hours.
- The client retains one request key while retrying an unchanged batch. The server serializes batch creation and returns the existing batch for an identical retry; reusing the key with different details is rejected.
- **Revise shift** changes one occurrence. It preserves the old shift's terms and response snapshot, marks that shift replaced, and creates a linked replacement. Current offered/accepted assignments are cancelled with the revision reason and fresh offers are issued. Employees must review and respond again; previous acceptance never carries forward. Declined/cancelled assignments are preserved without being reoffered.
- Every reissued offer must still pass membership, employment, leave and scheduling conflict checks. If any employee becomes ineligible, the entire revision is rejected. Resolve staffing or cancel that employee's assignment before revising. Offers remain subject to capacity checks on acceptance.
- **Cancel shift** cancels one occurrence and all its current offered/accepted assignments, preserving terminal responses. The reason is visible to employees. Cancelled/replaced occurrences remain on the roster as history and are excluded from workforce/team-overview staffing totals.
- Revisions and cancellations require the displayed version and a reason of at least five characters. Stale requests return HTTP 409. Started shifts and shifts with any reported time cannot be changed. Historical time and payroll records keep their original shift terms.
- These controls apply to individual occurrences. Editing or cancelling an entire shift series remains a later enhancement. Weekly unavailable patterns are described below.

### Availability, qualifications and replacements

Open **Workforce → Availability & qualifications**. Employees see their own linked record; HR administrators can search for another active employee. Team grants do not grant access to private availability notes or verification references.

**Availability:** record a future unavailable period using an explicit time zone, with an optional private note. The period can span up to 366 days. A period overlapping an accepted workforce assignment is rejected until a lead releases or replaces that assignment. Overlapping unavailable periods are rejected; cancel an incorrect period with a reason and enter a replacement. Cancellation retains the original record. Past periods remain history. Availability is a scheduling constraint, not a leave request or payroll adjustment; no recorded restriction does not guarantee that an employee will accept a shift. The current view shows up to 200 records per employee.

**Qualifications:** HR creates named qualification types and records employee verification, valid-from date, optional inclusive expiry date and a verification reference. These entries record HR's verification; the app does not independently validate certificates with external issuers. Employees can read their own verification records. Overlapping active verification periods for the same employee/type are rejected; revoke incorrect records with a reason before replacing them. Revocation preserves history and flags affected offered/accepted upcoming or live assignments for lead review. It does not silently cancel accepted work.

Select required qualifications when creating a single shift, recurring roster or shift revision. The shift saves an ID/name snapshot. Each required qualification must have continuous non-revoked verified coverage for the full shift's site-local calendar dates, including overnight work. Adjacent or overlapping verification periods can provide that coverage; any gap remains ineligible. Offers, acceptance and reissued offers all enforce this check. Omitting qualification IDs on the revision API preserves the previous requirements; explicitly sending an empty list removes them through the normal revision/renewed-consent workflow.

**Staffing:** use **Find available staff** or **Find replacement**. Candidate searches return up to 50 matching members, with a prompt to refine the search when more exist. Candidates must cover the full shift membership dates, have active employment, meet qualification requirements, and have no recorded unavailability, approved leave or conflicting accepted/legacy schedule. Existing assignments and terminal responses are excluded. Candidate results expose only names, IDs and operational eligibility explanations; private notes and certificate references stay in the employee/HR view.

A replacement offer links to its original assignment and includes a reason. Only one offer can be pending for an original assignment. If the original employee has accepted, that acceptance remains until the new employee accepts. The final acceptance checks current eligibility and capacity, cancels the original active assignment, saves the new acceptance and audits the previous state in one transaction. Repeated acceptance is safe. Declining/cancelling a replacement preserves the original assignment. If a lead separately cancels the original, the replacement can fill the vacancy only if capacity still exists. Started shifts or assignments with reported time cannot be replaced. Finish or cancel pending replacement offers before revising an entire shift occurrence; whole-shift cancellation cancels both offers and original assignments.

Scheduling qualification requirements are configured per shift; company leave/payroll/calendar policies and employee overrides remain in HR Rules. Availability preferences do not alter employment terms. Weekly unavailability and in-app renewal due reminders are implemented below. External reminder delivery, certificate validation and evidence-file upload remain later extensions.

### Weekly availability and qualification renewals

**Weekly unavailable patterns:** open **Availability & qualifications → Add weekly pattern** for your linked record, or use HR's employee selector. Choose an explicit time zone, first/last start dates (at most 366 calendar days), weekdays, start/end time and same-day/next-day end. Each period lasts up to 24 local hours; a full day across a daylight-saving change can have a different elapsed duration. Skipped or repeated clock times are rejected. Notes remain private to the employee and HR.

**Preview weekly dates** displays every occurrence and any overlap with an existing unavailable period or accepted workforce assignment. All occurrences must start in the future. Saving rechecks under the employee lock and creates the pattern and all dated periods atomically. A UUID makes an unchanged submission safe to retry. These saved periods participate in the existing offer, acceptance, candidate, replacement, revision and arrival eligibility checks. A pending offer does not prevent recording unavailability; accepting that offer later rechecks it.

Use **Dates & exceptions** to skip a future date with a reason. **Stop future occurrences** cancels only periods whose start is still in the future; started/past periods and previous cancellation reasons remain intact. To change the weekly pattern, stop its future dates and create a new pattern. The regular unavailable-period list shows one-off entries, while the pattern list shows 20 patterns per page and each detail lists all its dates. No background expansion job is needed: the finite pattern is materialized when saved. These preferences do not request leave or change payroll.

**Renewal reminders:** **Workforce → Qualification renewals** shows expiring/expired verified qualifications for the linked employee; HR sees active employees across the company. Reminder policies are configurable by qualification with optional employee overrides, an effective time, a time zone and a 0–365-day reminder window. The initial setting is 30 days in UTC. A blank effective time means now; past revisions are not accepted. The latest effective revision per scope wins, and an employee override takes precedence until replaced. Replacing a mistaken future revision uses the same future effective time with corrected values. HR can read the latest 500 revisions.

The due list is calculated when opened/refreshed and refreshes every minute while active. Expiry is inclusive in the configured time zone. Later verified coverage suppresses an older expiry only when the coverage is contiguous or the later period has already started. A future renewal with a gap continues to show the older expiry and the new start date. Pending requests never clear an expiry or qualify an employee for work. This is an in-app due list; the workflow does not send scheduled email, SMS or push reminders. Due items and request lists are paginated in groups of 25.

**Submit and verify:** employees or HR can submit a renewal from the due list or a non-revoked, expiring verified qualification. Provide a certificate/evidence reference and an optional note. References are plain text describing evidence already supplied to HR, not an upload or automatic certificate check. Only one submitted/returned request is allowed per original verification. Duplicate retries reuse the original request, even after resubmission, and a changed payload under the same request key is rejected.

An HR administrator other than the submitting user/current employee account can verify the evidence or return it with a reason. Returned requests can be updated/resubmitted. Employees/HR can cancel a current pending request with a reason; verified requests cannot be cancelled. Review/resubmission/cancellation requires the displayed version, and every action appends an actor/time/reason snapshot. References and notes remain in the employee/HR workflow and are excluded from shared activity logs. Team scheduling grants alone do not authorize renewal review or disclosure.

Verification records the actual renewed validity dates and HR's reference, creates a linked qualification and marks the request verified in one transaction. Its start must be after the original start, and its expiry must extend the original expiry; HR may explicitly record no expiry. Overlap with the directly renewed record is permitted; overlap with another active verification is rejected for correction. The old verification remains unchanged. Gaps do not become valid automatically. Adjacent/overlapping non-revoked records collectively cover an overnight shift, while revocation or a validity gap still blocks eligibility. A previously renewed record cannot be renewed a second time; use the latest record or HR's correction workflow.

### Membership changes, arrival and operational incidents

**Membership dates:** HR uses **Team members → Dates & history** to shorten or extend a non-ended membership. The new end must be future-dated, after the original start, and must not overlap another period. The start is preserved. Release or replace affected offers/accepted assignments before shortening coverage; historical membership cannot be reopened. Each revision requires the displayed version and a reason, records both old and new end dates, and synchronizes with offer/acceptance eligibility on the employee row. Add a separate dated membership for a subsequent period or another team.

**Arrival rules:** HR uses **Team workspace → Configure arrival rules** for team defaults and employee overrides. Rules control whether mobile arrival is enabled, how many minutes before shift start it opens, how many minutes after start it closes (capped at shift end), and the departure grace used for review flags. Each numeric option accepts 0–1,440 minutes. Initial settings are enabled, 60 minutes early, 240 minutes after start and 120 minutes departure grace. Configure actual operating rules before release.

Revisions take effect now or at a future site-local time; they never rewrite an existing visit. For each scope, the latest effective revision wins; ties use the newest revision. An applicable employee override takes priority over the team default until replaced. To replace a mistaken future rule, save corrected rules with that same future effective time. History shows the latest 500 revisions. The employee picker uses memberships in the selected dashboard window. These are operational arrival rules; leave and payroll rules remain in **HR Rules**.

**Mobile arrival/departure:** accepted employees use **My shifts & offers → Record arrival / Record departure**. The server supplies the timestamp; clients cannot submit a backdated arrival. Arrival rechecks current employment, membership, qualifications, leave and scheduling eligibility, saves the effective rule snapshot, and permits one open visit per employee. Repeated actions retain the same visit. Once arrival is recorded, even before scheduled start, shift revision, cancellation and replacement cannot discard that assignment.

Departure remains available after arrival even if rules subsequently disable arrival or the visit is overdue. Early departure, arrival after scheduled start, overdue departure and lead closure are flagged. A scheduling lead with current access covering the full shift, or an HR administrator, can close a forgotten open visit **at the current server time** with a reason and review a completed visit with a note. The arriving user/current employee account cannot review or close its own visit as a lead. Stale versions are rejected. Closure and review fields retain actors, timestamps and reasons; original arrival/departure timestamps have no edit endpoint.

Visit duration includes breaks and does not prove worked time or physical location. Recording/reviewing a visit does not alter daily attendance, approve a timesheet or calculate payroll. Submit actual work and breaks through the existing Timesheets workflow; use reviewed Attendance corrections for daily clock corrections. Outside the arrival window, contact the lead and record an operational exception. There is no GPS, biometric or offline capture, no automatic break deduction and no automatic backdated visit correction. Choose an earlier dashboard date to retrieve older assignments and open visits.

**Operations log:** each shift exposes recorded visits and incidents to authorized scheduling leads/HR. Accepted employees can open their shift log to see their own visits and reports. View, time-review and performance-review grants alone do not expose operational incident details. Current lead access must cover the entire shift, including for historical logs. Sensitive incident text and visit review notes are excluded from shared activity logs.

Reports require a title, details, low/medium/high priority and an occurrence time within the shift, no later than the server's current time. The original report is retained. A request UUID makes retries safe and rejects changed details under the same key. Leads can take ownership/add progress, resolve, return work to the unassigned queue or reopen a resolved incident. Every status update requires a reason and version and appends an actor/date history entry. The latest 200 reports per shift are displayed. Operational incidents are for site work; confidential HR matters use Helpdesk. No external alerts or messages are sent by this workflow.

### Endpoints

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
| `POST /teams/:teamId/series/preview` | Validate recurrence and return all site-local occurrences without saving |
| `POST /teams/:teamId/series` | Save `{requestKey, recurrence}` atomically; safe retry with the same UUID and definition |
| `POST /shifts/:id/revise` | `{version, reason, shift}`; create replacement and fresh offers atomically |
| `POST /shifts/:id/cancel` | `{version, reason}`; cancel future occurrence and its active assignments |
| `POST /shifts/:id/offers` | Offer to a member covering the full shift |
| `GET /my-assignments?from=...&to=...` | Only the current account's explicitly linked employee assignments |
| `POST /assignments/:id/respond` | Employee-only `{ "decision": "accepted" }` or `"declined"` |
| `POST /assignments/:id/cancel` | Scheduling lead/admin; `{ "reason": "..." }`, minimum 5 characters |
| `GET /staffing/catalog`, `POST /staffing/catalog` | Authenticated name/ID list; HR-only qualification type creation |
| `GET /staffing/profile?employeeId=...` | Own linked record by default; HR may select another employee |
| `POST /staffing/employees/:id/unavailable` | Employee owner or HR records future unavailability |
| `POST /staffing/unavailable/:id/cancel` | Owner or HR cancels a non-ended period with a reason |
| `POST /staffing/employees/:id/qualifications` | HR records dated verification and its reference |
| `POST /staffing/qualifications/:id/revoke` | HR revokes verification with a reason |
| `GET /shifts/:id/candidates?q=...` | Scheduling lead/admin reads checked candidates for the scoped shift |
| `POST /assignments/:id/replacement` | `{employeeId, shiftVersion, reason}` creates a replacement offer |
| `POST /members/:id/end-date`, `GET /members/:id/history` | HR-only `{version, endAt, reason}` revision and date history |
| `GET /teams/:teamId/arrival-rules`, `POST /teams/:teamId/arrival-rules` | HR reads history or saves `{employeeId, effectiveAt, rules, reason}`; null employee/time means team scope/now |
| `GET /assignments/:id/presence` | Linked employee reads their visit and applicable arrival window |
| `POST /assignments/:id/arrival`, `POST /assignments/:id/departure` | Employee-only server timestamp; strict empty body |
| `POST /presence/:id/review` | Scheduling lead/HR `{version, action: "close" or "review", reason}`; another person must act |
| `GET /shifts/:id/operations` | Scheduling lead/HR sees shift log; accepted employees see only their own reports/visits |
| `POST /shifts/:id/incidents` | Scoped lead/HR or accepted employee submits `{requestKey, occurredAt, title, details, severity}` |
| `POST /incidents/:id/status` | Scheduling lead/HR `{version, status, note}`; history appended atomically |
| `POST /staffing/employees/:id/availability-series/preview` | Employee owner/HR previews a weekly pattern and occurrence conflicts |
| `GET /staffing/employees/:id/availability-series?page=1`, `POST /staffing/employees/:id/availability-series` | Owner/HR lists patterns or saves `{requestKey, pattern}` atomically |
| `GET /staffing/availability-series/:id`, `POST /staffing/availability-series/:id/stop` | Owner/HR reads dated history or stops future occurrences with `{reason}` |
| `GET /renewal-policies`, `POST /renewal-policies` | HR-only history and `{qualificationId, employeeId, effectiveAt, config, reason}` revision |
| `GET /renewals/due?page=1` | Own due items; HR can see active employees across the company |
| `GET /renewals?status=submitted&page=1`, `GET /renewals/:id/history` | Owner/HR request list and immutable action history |
| `POST /staffing/qualifications/:id/renew` | Owner/HR submits `{requestKey, reference, note}` for the original verification |
| `POST /renewals/:id/resubmit`, `POST /renewals/:id/cancel` | Owner/HR versioned resubmission or cancellation with a reason |
| `POST /renewals/:id/review` | Independent HR `{version, decision, reason}`; verification also requires validity dates and HR reference |

Mutations use transactions, row locks and a unique shift/employee assignment index. Repeated identical offers and responses are safe retries. Capacity is checked under a shift lock; conflicting assignments and legacy schedule writes synchronize on the employee row. Approved leave overlapping an accepted workforce assignment requires cancellation/replanning first. Database constraints also validate date ordering, shift duration, headcount and breaks.

## Verification and remaining work

All 164 automated tests across 13 suites pass, including 56 workforce tests. Coverage includes authorization/date boundaries, confidential-field exclusion, employee ownership, capacity races, overlapping shifts, leave, employment dates, recurrence/DST, batch retries, revision rollback, consent preservation, cancellation/history, staffing totals, availability races, qualification validity/revocation, candidate privacy and atomic replacement acceptance/rollback, membership history/stale dates, arrival ownership/windows/policy snapshots, open-visit uniqueness, early-arrival cancellation protection, independent visit review and scoped incident transitions, weekly availability/DST/exceptions, dated renewal reminders, submission and verification permissions, stale versions, contiguous qualification validity and verification rollback. Tests run on isolated PGlite; managed PostgreSQL concurrency and migration checks remain part of staging acceptance.

Strict TypeScript checking and production frontend/server builds pass. The existing large frontend-bundle warning remains. A browser walkthrough with synthetic accounts verified site/team/member/grant setup, lead shift creation and offering, employee acceptance, persistence after reload and updated lead coverage. Synthetic records and preview credentials are not shipped to the application or source repository.

The workforce roadmap still includes:

1. Whole-series shift changes, external reminder delivery, certificate evidence uploads/validation and broader staffing requirements. Weekly availability and the in-app renewal workflow are implemented.
2. Offline/device arrival, GPS or biometric verification, and automatic timesheet drafting from confirmed visits. The current mobile workflow records authenticated server-time arrival/departure. Employment or compliance changes after acceptance need explicit operational review. Assignment timesheets, independent review and payroll locking are implemented.
3. Helpdesk category routing, response targets, escalation and knowledge articles. Confidential cases, messages, attachments and status are implemented.
4. Performance cycles, objectives and development plans. Assignment rubrics, evidence, employee responses and dispute handling are implemented.
5. Activation lifecycle and explicit legacy-event mapping, followed by EOS machine authentication, external IDs, idempotency, outbox/change feed and contract tests when EOS interfaces are available.

Migration 0019 adds recurring-batch and shift-change history tables, shift version/status and replacement links. Existing shifts default to scheduled; historical assignments are preserved. The migration does not auto-convert historical event assignments or infer employee consent. R2/Resend live configuration, hosting and GitHub publication remain separate setup work. WhatsApp stays deferred.

Migration 0020 adds unavailable periods, qualification types and employee verification records, required-qualification snapshots on shifts, and replacement links on assignments. Existing shifts default to no qualification requirements. No employees are automatically certified and no company-specific qualifications or unavailable periods are seeded into production.

Migration 0021 adds membership versions/history, dated arrival rule revisions, unique assignment visits and an incident/update log. Existing membership dates remain unchanged, and no historical arrivals or incidents are inferred. Browser acceptance with disposable synthetic accounts verified date revision/history, employee-specific rules, arrival/departure, independent visit review, incident ownership/resolution and a 390-pixel employee viewport. The combined release is now live; the deployment guide records production migration and readiness verification.

Migration 0022 adds weekly availability patterns and period links, renewal policy revisions, renewal requests/history and links between old/new qualifications. It does not infer historical patterns, renew credentials or change existing validity dates. Synthetic browser acceptance verified pattern preview/save, single-date exceptions, stopping future dates, renewal submission/HR verification/history, clearing the due reminder and saving reminder rules. The renewal card and history were also checked at a 390-pixel viewport.

## Compatibility with the live skills catalogue

Existing required skills and employee qualifications remain available through Skills catalogue and Recorded skills. New qualification requirements and renewal workflows coexist with these records. Assignment eligibility checks both sets; a shift revision preserves existing required skills.
