# Announcements, action inbox and administration

Status: implemented and verified locally on 19 September 2026; not deployed.

## User-facing changes

- Announcements use clear cards and personal For you, Unread, Needs acknowledgement and Pinned filters. The Publishing board separates drafts, scheduled, live, expired and archived notices.
- A three-step editor guides publishers through the message, permitted audience/timing and final review. Scoped audience selectors show department/channel names and an eligible account estimate. Saving creates a draft; publication requires a separate review and reason.
- Notice detail separates reading from publishing controls. Employees explicitly mark a notice read before acknowledging it, with the recorded timestamps shown afterward. Management previews outside the publisher's own audience cannot create a personal read or acknowledgement receipt.
- Recipient tracking shows current eligible accounts, read/acknowledgement progress, searchable pending lists and receipt history in a table.
- The action inbox adds readable cards, module shortcuts based on role, unread/all/read filters, search, bulk read and individual mark-unread controls. Reading a reminder does not complete its underlying task.
- Administration presents policy switches and limits as cards, with unsaved-change state, reset, version checks, a required change reason and policy-history table.

## Access and data behavior

Existing Hub authentication, active-employment checks and publication authority apply to all new endpoints. Audience choices, aggregate counts and recipient pages are scoped before pagination. Nonmembers cannot use administrator status to inspect a private channel's notices or recipients. Bulk inbox updates verify ownership of every supplied notification and reject the complete batch if any entry is unavailable to the caller.

Audience estimates and recipient progress describe the **current eligible audience**, not a publication-time delivery list. Eligibility requires an active account, completed password setup, current employment, Hub permission and the applicable audience/team relationship. Counts can change after publication. The separate receipt-history view preserves receipts from earlier recipients. Published wording remains immutable, and existing version guards and audit records remain in effect.

No new dependency or database migration is added by this upgrade. The earlier daily-chat upgrade is also pending deployment and requires `0047_team_chat_coordination.sql`; deploy both using the existing startup migration process. No live announcements, workflow reminders or business settings were created or modified during QA.

## Verification

- Full regression suite: **40 files passed; 501 tests passed and one existing test skipped**.
- Communications integration suite: **33 passed**, including audience eligibility and scope, private-channel isolation, recipient pagination and history, atomic owned-inbox updates, and management previews outside the viewer's audience.
- TypeScript check, Vite client build and esbuild server build passed. The existing Vite bundle-size advisory remains.
- Disposable local browser workflow: created a channel-targeted draft, published it after review, signed in as an employee, marked it read and acknowledged it, then verified the manager tracker changed from 0/3 to 1/3 for both read and acknowledgement.
- Employee screens hid draft/scheduled notices and publishing/administration controls. Local bulk inbox read, mark unread, policy version saving and history all worked.
- Mobile reading and recipient tracking were checked at 390 px in dark mode with no page-level horizontal overflow; desktop publishing and administration were checked as well. The mobile draft wizard retained the selected team name after audience search changed and displayed the correct final preview. TypeScript and the client build passed again after that label fix.

The disposable preview server was stopped and its temporary browser tab closed after acceptance.

These changes improve in-app communication. They do not add email/WhatsApp delivery, push notifications or an always-on real-time service. Existing hosting and polling behavior remain as documented in [Internal-Communication-Hub-Guide.md](Internal-Communication-Hub-Guide.md).
