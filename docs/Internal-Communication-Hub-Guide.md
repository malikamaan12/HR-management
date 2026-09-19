# Internal Communication Hub

Implementation and deployment date: 19 September 2026. Application commit `d106f7b8e894b9404c54d3c44e4ee22c0b90e47e` is live on the existing Render Free service as of 11:55:26 GMT+3. Build, startup migrations, health/readiness and authenticated Hub screens passed. See [Communication-Hub-Deployment.md](Communication-Hub-Deployment.md).

The `/communications` workspace replaces the old placeholder announcement/notification screens and Slack integration. It runs in the existing Express/React application, PostgreSQL database and configured private Supabase/R2 storage. No paid messaging service or new dependency is added; the Slack SDK is removed. Existing email workflows elsewhere in HR are unaffected.

## Working features

| Area | Behavior |
| --- | --- |
| Announcements and briefings | Draft, edit, review, publish, schedule, expire, pin and archive. Whole-company, department, role and managed-channel audiences. Published wording is immutable; corrections require a new notice. |
| Acknowledgements | Explicit read followed by explicit acknowledgement of the exact publication. Managers can view paginated receipts. Reading does not approve an HR transaction. |
| Conversations | Participant-only direct messages, invited private groups and workforce channels. Search conversation names or messages within one conversation, view older messages, reply by message reference, mention current members and track unread/mention counts. |
| Private files | One PDF, PNG or JPEG per message, checked by file signature and administrator size limit. Downloads require current channel access and use a 60-second private URL. No public attachment URLs or keys in message responses. |
| Message history | Sent text is immutable. Authors and channel managers may withdraw a message with a reason; the visible message becomes a marker and its attachment becomes unavailable through the app. Stored records remain. Retried sends use an idempotency key. |
| Action inbox | Existing HR workflow reminders, unread filter, explicit read state and safe links to the originating module. Notification delivery status is preserved separately. |
| Administration | Versioned direct-message/group-creation switches, message length, file size and visible-history limits; change reason and policy history. |

## Access rules

- Every Hub request and retained compatibility endpoint checks the current authenticated account, module permission and active employment dates/status. An administrator's role alone does not grant access to another person's direct message or private group.
- HR publishers (`admin`, `super_admin`, `hr_director`, `hr`) may publish company/role/department announcements. An HR manager can publish to their own department. Other supported managers publish to channels they currently manage.
- Private groups have explicit memberships with start/end dates. Temporary staff require an end date. A manager can invite only employees within their permitted department, reporting line or currently supervised team; HR publishers have organization-wide invitation scope.
- Workforce channels attach to an existing Workforce team and require an end date. Access follows current team membership, current supervisor grants or an accepted scheduled shift starting within the next 24 hours and not yet ended. Cancelled assignments and expired/revoked grants remove that access. HR owners retain management access to their archived workforce channels.
- Direct contacts expose only basic directory information. Temporary contacts require shared current work or HR access. If that relationship ends or the other account becomes unavailable, new messages stop; participants retain the existing conversation history while their own account and employment remain eligible.
- Group creation requires a supported manager role. Workforce management follows current scheduling grants. Users may mute their own unread badge; mention badges remain visible.
- Company-wide activity logs record message metadata, not message bodies or attachment names. Announcement versions and governance changes remain in workflow history.

## Administrator defaults

Open **Communication Hub → Administration**. Only admin/super_admin can save these rules.

| Rule | Default | Permitted range |
| --- | --- | --- |
| Direct messages | Enabled | Enabled/disabled |
| New private groups | Enabled for authorized managers | Enabled/disabled |
| Message length | 4,000 characters | 200–12,000 |
| Attachment size | 5 MB | 1–10 MB |
| Visible message history | 365 days | 30–3,650 |

History days limits message queries, search and attachment access. It **does not delete stored records or files**, so it does not cap database/storage growth. Access dates and membership removal are separate controls. The send endpoint also limits each user to 30 attempts per minute per application process.

For an event or FEC, first configure its Workforce team, dated employees and supervisor grants. Then create a workforce conversation, select that team, set its end date and choose whether everyone or only managers may post. Create a channel-targeted briefing for instructions that require acknowledgement. Confidential employee cases should use the scoped HR Helpdesk.

## Release and migration

Migration `0043_internal_communications.sql` is additive and registered in the deployment journal. It creates the communication records and copies legacy announcements without dropping the originals or inventing receipts. Existing custom-audience notices whose recipients cannot be mapped are retained as archived records; publish a newly targeted notice if needed.

Slack sending, integration routes and UI are retired. `/api/slack` and the former Hub AI route return HTTP 410. Old announcement readers use the new publication/audience rules; old write endpoints return 410. Notification compatibility reads remain scoped, and the old mark-delivered action records a read receipt instead of changing delivery status. Historical Slack records and enums remain in the database to preserve history. Existing Slack credentials are not needed by this implementation; no provider settings were changed during development.

Release used the existing application deployment and startup migration process; production migration completed on deployment. No sample messages or business settings were created during live acceptance. Private attachment behavior was verified using mocked storage; an actual production upload/download acceptance check remains separate.

## Validation and operating boundaries

The combined run passed **52 tests across six files**: communications, migrations, private storage, module workflows/reminders, deployment configuration and the API client. A final **17-test communications rerun passed**, covering the shared legacy-endpoint access check. TypeScript and production builds pass. The isolated browser preview confirmed draft/publication/read/acknowledgement receipts, direct message persistence/reply controls, administrator policy saving, employee-only controls, the recipient unread badge and the action inbox. Preview data was disposable and its server/tab were closed.

The open conversation screen polls every 20 seconds; announcements and the inbox poll every 30 seconds. Background-tab polling is disabled. Existing free-host sleep and usage limits still apply. This release does not promise always-on real-time delivery, offline notifications, browser push, voice/video, message reactions, nested thread views or cross-channel global search. No email/WhatsApp/Slack delivery, paid AI feature or new EOS integration is part of this batch. EOS connections can later use explicit scoped service APIs once its interface is available.
