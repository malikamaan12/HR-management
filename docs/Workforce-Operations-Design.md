# E3 HR workforce operations and EOS integration

Implementation design v0.1 · 13 September 2026 · Roadmap with a first implementation

The site/team/membership/grant and shift-offer foundation and the initial HR helpdesk are now implemented. See [Workforce-Enhancement-Guide.md](Workforce-Enhancement-Guide.md) and [HR-Helpdesk-Guide.md](HR-Helpdesk-Guide.md) for exact scope. The broader activation lifecycle, advanced assignment terms, timesheets, advanced helpdesk routing, ratings and EOS adapter below remain proposed.

EOS is the confirmed name of the Event Operating System. Its repository and API contract are not available for review yet. This document defines the proposed HR boundary, not an assertion of compatibility with a deployed EOS API. FEC is provisionally treated as Family Entertainment Centre; the model also supports other recurring venue operations.

## Product model

Maintain one employee identity. Separate employment type (permanent, temporary or contract) from the work assignment (event, FEC site or mall activation). A permanent employee may supervise an event; temporary staff may work recurring mall shifts. Do not create separate employee databases for these cases.

| Entity | Purpose and required relationships |
|---|---|
| Site | Venue/mall/FEC identity, timezone and operational location; optional stations and opening hours |
| Activation | An event or continuing operation at a site; kind: event, FEC or mall activation; dates, EOS mapping and lifecycle |
| Operational team | Team linked to an activation/site with dated memberships; independent of the employee's home department |
| Supervisor grant | Named supervisor, team/site/activation scope, valid period and explicit permissions; revocable and audited |
| Shift | A concrete scheduled interval, role/station, staffing requirement and breaks; recurring templates generate versioned shift instances |
| Assignment | Employee, shift, offer/acceptance status, applicable terms and replacement links; one identity can hold many non-overlapping assignments |
| Attendance event | Original clock/break observations with actor, source and assignment context; corrections are recorded separately |
| Timesheet | Reviewed hours linked to an assignment; approval history and policy version; locked after payroll inclusion |
| Operational checklist | Opening, closing, equipment or handover template and per-shift responses with ownership |
| HR case | Requester, category, restricted participants, assigned HR owner, target times, messages and attachment permissions |
| Assignment review | Reviewer, assignment, rubric version, criterion scores, evidence, employee response and dispute state |
| Integration mapping | Organization + integration + resource type + external ID maps uniquely to an HR public ID |

Public integration IDs should be opaque UUIDs, while existing internal integer keys can remain during migration. All dated membership and supervisor checks use the assignment interval; a revoked supervisor cannot read historical team information unless explicitly permitted.

## Assignment and shift rules

Assignment flow: proposed → offered → accepted → active → completed. Offered assignments can be declined or expire. Unstarted assignments can be cancelled; cancellations preserve reasons and history. No-show is an attendance exception requiring review, not an automatic employee penalty.

Acceptance must atomically recheck employee activity, applicable qualification dates, leave conflicts, overlapping assignments and remaining shift capacity. Rescheduling an accepted shift creates a revision and requires renewed acceptance when material terms change. Recurring shifts are generated for a bounded horizon, so editing a template never rewrites completed work.

Timesheet flow: draft → submitted → approved or returned → payroll-locked. Approvers cannot approve their own hours. Corrections after approval create a revision; corrections after payroll lock create an adjustment request rather than replacing paid history. Attendance, payable minutes and client-billable minutes are separate quantities.

Store UTC instants and an IANA site timezone. Define intervals as start-inclusive/end-exclusive; support shifts crossing midnight. Reject nonexistent local times when creating a shift; resolve ambiguous times explicitly. Rest limits, overtime, paid breaks and rounding come from versioned business policies, not hardcoded assumptions.

## Team-lead dashboard

Top controls: authorized site/activation, team and operational date. Date boundaries follow the selected site's timezone.

| Panel | Visible information | Permitted actions |
|---|---|---|
| Staffing coverage | Required, accepted, present, on break, overdue and unfilled positions | Request replacement, invite eligible reserve staff within delegated authority |
| Live roster | Assigned people, station, shift, current clock state and qualification-ready indicator | Allocate stations/breaks, report absence, propose attendance correction |
| Approval inbox | Assigned team's submitted timesheets and operational requests | Approve/return with reason, excluding own timesheet; leave approval only with separate authority |
| Shift operations | Opening checks, equipment checks, handover notes and open incidents | Assign tasks, confirm completion, escalate safety issues |
| Team feedback | Reviews due for completed supervised assignments | Draft evidence-based reviews and respond to HR clarification |
| Exceptions | Unfilled role, expired qualification, missing clock or overdue handover | Assign an owner and track resolution |

Lead views exclude salary, bank information, identity document images and confidential HR cases. Display a qualification-ready result rather than the underlying document where sufficient. Presence requires a recorded clock event; the system must not imply continuous GPS tracking. Break coverage and staffing counts use the same scoped data as the roster.

## HR helpdesk

Initial categories: payroll query, attendance correction, document/letter request, shift support, transport/accommodation request, equipment/uniform issue, and confidential employee relations. Categories route to configured queues and owners; operations requests can be assigned to a team lead, while confidential cases stay with authorized HR participants.

Case flow: open → triaged → in progress → waiting for employee or internal action → resolved → closed, with a controlled reopen action. Targets and paused-clock rules are configurable, using working calendars; do not promise specific response times before staffing the queues. Escalation must preserve case confidentiality.

Messages distinguish employee-visible replies from internal notes. Attachments inherit case permissions, not general document permissions. Every reassignment and visibility change is audited. Rating disputes use this restricted case mechanism. An HR case about immediate danger must clearly direct the user to the site's emergency process rather than promise live monitoring.

## Employee ratings

Use role-specific, versioned rubrics: punctuality against the agreed shift, task completion, service quality, teamwork and demonstrated skills. Replace vague attitude scoring with observable behavior. Allow not-applicable criteria; do not turn missing reviews into zero scores.

Only someone who supervised the assignment may review it; prohibit self-review. Require examples for low/high scores, record reviewer identity and publication date, and allow employee comments and disputes. HR can moderate through explicit revisions without erasing the original review. Approved leave, protected characteristics and confidential case history must not be scoring inputs.

Show criterion breakdown, sample size and period. Compare only compatible roles/rubrics; a numerical average alone is insufficient. Do not automatically dismiss, deny work or change pay based on a score. EOS receives no individual rating data in the first integration version.

## Permission and ownership boundary

| Actor | Operational scope | Financial or confidential access |
|---|---|---|
| Employee | Own offers, shifts, timesheets, published reviews and cases | Own authorized payslips/documents; no other employees' information |
| Team lead | Explicit dated supervisor grants | No pay rates or confidential cases by default |
| Site/activation manager | Assigned site or activation and delegated actions | Aggregated costs only when separately granted |
| HR | Authorized HR records and case queues | Sensitive fields according to job responsibilities |
| Payroll reviewer | Approved payroll inputs and corrections | Financial permissions separated from roster management |
| EOS service account | Integration-bound activations and operational projections | No credentials, QID images, bank details, case messages or individual ratings |

EOS owns its event/activation definitions, venue references, client requirements and staffing demand. HR owns employee identity, employment terms, eligibility decisions, assignment acceptance, attendance, approved timesheets and payable costs. EOS owns client bill rates, revenue and client billing approval. EOS must not overwrite approved HR time or salary. A site mapping imported from EOS is not a grant of access to all employees at that site.

## API contract

The accompanying `EOS-HR-API-Draft.json` is a machine-readable OpenAPI 3.1.1 design document. See the [OpenAPI specification](https://spec.openapis.org/oas/v3.1.1.html). Every path is proposed and must be implemented; it does not describe existing live routes.

First scope: activation registration, staffing requests, request status, assigned staff projections, approved timesheets, optional aggregate cost summaries and a change feed. HR-only actions such as employee acceptance, timesheet approval, payroll approval and case handling remain outside the EOS service account API.

Service credentials are separate from user browser sessions. Bind credentials to an organization and integration server-side; never trust a caller-supplied organization ID. Grant only required permissions and explicit activation access, rotate/revoke credentials, enforce TLS, rate limits and redacted request logs. Tokens and their issuance mechanism must be agreed with EOS before implementation.

Creation requests require an idempotency key. Scope keys by integration and operation, retain results for at least seven days, and reject a reused key with a different canonical request body. Unique external IDs prevent duplicates after the replay window. Updates use resource versions/ETags and reject stale writes rather than applying last-writer-wins.

Use cursor pagination, a maximum page size of 100 and correlation IDs. Changes are ordered by server sequence rather than client clocks. Return minimal operational employee projections only for confirmed assignments. When access is revoked, further API reads and event delivery must stop immediately.

## Reliable synchronization

Use an outbox committed in the same transaction as the HR change. Suggested events: staffing.request.updated, assignment.accepted, assignment.cancelled, timesheet.approved, timesheet.corrected and cost.summary.updated. Payloads contain event ID, schema version, resource ID, resource version and occurrence time; the recipient retrieves permitted details through the API.

Deliver at least once with bounded exponential backoff and jitter. Consumers deduplicate event IDs, reject stale resource versions and reconcile missing changes through the change feed. Retain a delivery/failure log, expose manual replay to authorized administrators and require a full reconciliation if a cursor expires.

Webhook transport is provisional until EOS supplies its receiver contract. Agree signature algorithm, key rotation, timestamp/replay window and raw-body verification before enabling delivery. Callback endpoints must be administrator-configured HTTPS allowlisted destinations; no arbitrary URL from event payloads. An outbox record must not contain private HR documents or confidential cases.

## Migration from the current code

The current schema already has events, eventRoles, eventRosters, eventStaffAssignments, eventStaffPerformance, attendance, shiftSchedules and employee skills. Extend these deliberately rather than creating duplicate working sources.

1. Add sites/activations, concrete shifts, teams and supervisor grants with migrations. Map existing events to event-kind activations and preserve IDs through a mapping table.
2. Add assignment lifecycle, external public IDs, versions and explicit shift links. Inventory existing statuses and dates; route ambiguous records to HR review. Do not infer accepted offers or supervisor relationships from legacy data.
3. Introduce reviewed timesheets while preserving raw attendance and existing paid payroll records. Reconcile counts, hours and record links before enabling writes through new routes.
4. Add helpdesk and versioned review tables; retain legacy reviews as clearly labelled historical records. Do not silently convert existing average ratings into the new rubric.
5. Add service-account authorization, mappings, idempotency, outbox and change feed. Retire overlapping legacy write routes only after a documented cutover and rollback rehearsal.

## Implementation slices and acceptance criteria

| Slice | Deliverable | Required checks |
|---|---|---|
| A | Assignment model and scoped team access | Cross-team/site access denied; expired/revoked grants denied; migration reconciliation passes |
| B | Team-lead dashboard and staff self-service | Concurrent acceptance cannot overfill or double-book; overnight shifts display correctly; roster counts match records |
| C | Timesheets and helpdesk | No self-approval; locked pay history preserved; confidential case inaccessible to unrelated supervisors |
| D | Ratings and review disputes | Supervisor evidence required; employees see published feedback; disputes retain original review history |
| E | EOS adapter and contract tests | Duplicate creates, stale updates, retries, replay, revoked credentials and reconciliation tested against an EOS sandbox |

Start with slice A and the dashboard prototype. The EOS adapter remains dependent on EOS's repository/API, identity mapping, event lifecycle and test environment. The existing 30 tests are a baseline, not evidence that these new capabilities have been implemented or tested.
