# Performance cycles and helpdesk operations

Implemented locally on 16 September 2026. Apply migration `0023_performance_helpdesk.sql` through the migration journal before serving this release. This work does not deploy the hosted application or modify production employee data.

## Performance and development

Open **Performance** to create and run a review cycle. HR administrators (system owner, administrator, HR director and the legacy HR role) manage cycles.

1. Create a draft with a review period, deadline, weighted criteria and five administrator-defined rating labels. Weights must total 100%.
2. Assign active employees with approved linked accounts. Choose a reviewer with current performance management permission for that employee. The reviewer cannot be the employee. Each assignment has its own deadline and self-assessment requirement; these settings can be revised before opening.
3. Open the cycle. Its criteria, labels and employee settings are now fixed. The employee completes a self-assessment if required, followed by the assigned manager's assessment. Repeated saves use record versions to reject stale edits.
4. A different HR administrator reviews the manager submission. They can return it with a reason, or record calibrated scores and publish it. The final rating is the weighted mean of the calibrated scores, on a 1–5 scale. The manager's original scores remain available.
5. The employee reads the published review and records an acknowledgement, with an optional response. Acknowledgement means receipt, not agreement. Close the cycle after all employees acknowledge.

Employees, assigned reviewers and HR can create objectives and development actions with success measures and deadlines. Progress updates require evidence or a reason and retain history. Completion requires 100% progress. These plans can continue after a cycle closes. Cancelled cycles cannot receive new review or objective updates.

HR can change a reviewer before publication, with a reason. This clears the current manager draft and returns a submitted manager review for a fresh assessment; the earlier assessment remains in the stored audit history. Draft/open cycles can be cancelled before any review is published. Published ratings cannot be overwritten through these actions.

### Visibility and reporting

- Employees see their own reviews. Unsubmitted self-assessments are private to the employee; manager assessments are hidden from the employee until publication.
- Assigned reviewers need current management permission for the employee. Losing that scope removes their assignment-based access.
- HR administrators can manage cycles; an HR employee still cannot calibrate their own review or acknowledge it for another employee.
- Cycle reports include the number of published reviews, the mean published rating and its sample count within the reader's scope. No employee ranking or automatic payroll/employment action is produced.
- Existing reviews, goals and feedback remain available to HR under **Earlier reviews, goals & feedback**. They remain separate from the new review-cycle workflow.

## Helpdesk rules

Open **HR helpdesk → Routing & response rules**. Create a dated company rule for a category, or an employee override. A rule defines:

- Whether routing/targets are enabled.
- First public HR response and resolution targets, in elapsed hours.
- The default handler and optional escalation handler.
- The effective date and reason for the revision.

For a new case, the latest effective employee override wins over the latest effective company rule. Equal effective dates use the newest saved revision. A disabled employee override suppresses the company rule. Rule changes affect new cases; existing cases retain their saved target durations and escalation handler. Cases created before this release have no retroactive targets.

Targets use continuous elapsed hours, including weekends, holidays and time waiting for the employee. Internal notes do not satisfy the first-response target. The first public reply from an authorized HR handler does. Resolving a case records its resolution time. Reopening clears resolution/escalation and starts a new resolution deadline using the original policy duration; the first-response record remains unchanged.

The **Show overdue requests only** filter includes unresolved cases with a missed first-response or resolution deadline, within the reader's existing case scope. Authorized handlers can escalate a case with a reason to its configured escalation handler. This is an explicit dashboard action; there is no background escalation or email/SMS delivery in this release. If that handler is no longer eligible, a triager must assign an eligible person.

### Confidential cases

Only HR directors/system owners can configure confidential rules. Automatic confidential routing and escalation target active HR directors/system owners. Employee-relations cases and rules are always confidential. Existing explicit case assignment still allows a triager to grant an individual HR responder access. Policies never grant team leads general access to HR cases. Private messages, files and case search retain the existing access checks.

## Knowledge articles

Open **HR helpdesk → Knowledge articles**. HR administrators can create, revise, publish and archive articles. Choose a category and either all employees or HR responders as the audience.

Readers can search published titles/content and filter by category. Draft and archived articles are visible only to article administrators. HR-only articles are excluded from employee search, totals and direct access. Editing a published article as a draft immediately hides it until republished. Every saved revision retains its content and reason in the administrator's version history. Concurrent edits require the latest version.

## Remaining release work

Configure actual review criteria, review participants and helpdesk policies in the dashboard. Validate these workflows against the managed PostgreSQL deployment and intended roles before release. Future enhancements include review participant removal/withdrawal, reusable cycle templates, bulk assignments, automated reminders/escalation, business-hour target calendars and richer knowledge authoring. These are not represented as implemented.
