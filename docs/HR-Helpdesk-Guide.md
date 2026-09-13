# HR helpdesk — first implementation

13 September 2026. Implemented locally; deployment and the staging migration are still required.

## Workflow

Open **HR Helpdesk** in the sidebar. Employees submit a subject, category, description and optional private attachment, view their own requests, reply and track status. Categories cover payroll, attendance, documents/letters, shifts, transport/accommodation, equipment/uniforms, employee relations and other requests. Employee relations cases are always confidential; any requester can choose confidentiality for another category.

HR handlers use **HR queue** to find only the cases their permissions allow. Authorized triagers assign an active approved HR responder. Case handlers send employee-visible replies, add internal HR notes and change status with a reason. A reply to a case waiting for the employee returns it to active work. Resolved and closed cases require reopening before further replies; requesters can close a resolved case or reopen it with a reason.

Status flow: open → in progress / waiting for employee → resolved → closed. The server validates transitions. Changes carry a record version; stale or competing updates return a conflict so the author can review current details and retry. Messages and case history are preserved.

## Permissions

| Actor | Access |
|---|---|
| Requester | Own cases and public replies/files; never internal notes on their own case, even if they work in HR |
| `super_admin`, `hr_director` | Triage standard and confidential cases, except treating their own request as an HR-handler case |
| Legacy `admin`, `hr` | Triage standard cases; confidential cases require explicit assignment |
| `hr_manager` | Handle explicitly assigned cases; no organization-wide unassigned queue |
| Other employees / team leads | Own requests only; workforce grants do not grant case access |

An assignee must be an active approved user in `super_admin`, `admin`, `hr_director`, `hr` or `hr_manager`, and cannot be the requester. Assignment grants that HR responder access to the case and its internal notes. Unassignment, deactivation or loss of an eligible HR role removes assigned access. Standard triagers may still access a standard case through their triage role.

Requesters and authorized triagers can make a standard case confidential. This removes ordinary triage access while retaining the explicit handler, HR director/system-owner access and requester access. The API does not downgrade confidentiality. Internal notes, their attachment metadata and history events are filtered by the server.

## Files and audit

Each request/reply can attach one PDF, PNG or JPEG up to 10 MB. Files use private `helpdesk/<caseId>/...` R2 keys, separate from employee documents. Downloads recheck case and message visibility before issuing an attachment-only signed URL valid for 60 seconds. The employee-document download helper rejects helpdesk keys. Previously issued URLs can remain usable until that short expiry.

File signatures and bounds are checked before storage. Database failure after upload triggers cleanup. If R2 is unconfigured, the UI explains why attachments are unavailable and text-only cases still work. Real R2 delivery and malware scanning/quarantine remain staging/production work; tests mock the transport.

Messages, assignments, confidentiality changes and status transitions have case-scoped audit records. Case subjects and message contents are not copied into organization-wide activity-log details. Routine HTTP access logs retain route/method/status under existing application policy.

## Internal API

All endpoints use `/api/helpdesk`, require a current session and return `Cache-Control: no-store`.

| Endpoint | Purpose |
|---|---|
| `GET /config` | Queue capabilities and storage availability |
| `GET /cases` | Scoped list/search/count, `view=mine` or `queue`, optional status/category/q; page size up to 100 |
| `POST /cases` | Create case and public first message; JSON or multipart with optional file |
| `GET /cases/:id` | Authorized case, capabilities, visible messages/files and history |
| `GET /cases/:id/assignees?q=...` | Triage-only HR search; 2+ characters, up to 20 results |
| `POST /cases/:id/messages` | Versioned public reply or internal note; optional multipart file |
| `POST /cases/:id/actions` | Versioned assign, status or restrict action |
| `GET /attachments/:id/download` | Reauthorized private download |

This is separate from the proposed EOS API. EOS and operational team leads receive no case data by default.

## Verification and next work

55 automated tests pass: 42 previous tests, 12 helpdesk tests and one additional R2 namespace test. Coverage includes ownership, confidential queue/search/count exclusion, note/file privacy, assignment/revocation, role changes, transitions, concurrent updates, upload bounds, unavailable storage and rollback cleanup.

Strict TypeScript and frontend/server builds pass; the existing frontend-bundle warning remains. A synthetic browser walkthrough verified case creation, HR queue, assignment, internal/public replies, handler resolution, requester privacy, closure and persistence after reload. No real employees were messaged or cloud storage contacted.

Apply `0005_hr_helpdesk.sql` through the reconciled migration process before running against staging. Existing database baselines must be reviewed before replaying initial migrations.

Further work: category routing, configurable service targets/calendars and escalation, safe operations-case delegation, additional participant/exclusion rules, Resend notifications, knowledge-base articles, retention rules and rating-dispute linkage. The helpdesk does not promise an emergency response or a staffed response deadline.
