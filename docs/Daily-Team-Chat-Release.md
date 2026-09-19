# Daily team chat upgrade — 19 September 2026

Status: implemented, locally verified, not yet deployed. This release builds on the existing Communication Hub and uses the existing application, database and private storage. No new dependency or external messaging provider is introduced.

## What changes

The Hub opens on Team chat. Conversation previews and unread/mention/favorite filters help staff find the right team quickly. Desktop uses a conversation list beside the message pane; mobile shows one pane at a time. Focus chat reduces the overview to leave space for messages and the composer. Both light and dark themes are supported.

Messages have reply context, a paginated message-and-replies view, five emoji reactions, personal saved items and shared manager pins. Channel-level Pinned and Files views sit next to Messages. Search, Saved and Files discovery span only conversations the user can currently access. Direct chats show the colleague's name.

Draft text, mentions, reply selection and a selected local attachment survive conversation and Hub-tab switches within the page. They remain in memory and are discarded on reload/logout. Ctrl/Command + Enter sends; normal Enter adds a line. A pending send locks the composer, preserves its retry key, and clears the draft only after success.

Summary cards open unread chats, mentions, announcements and the action inbox. The header badge links to the Hub. Read cursors advance only in a visible, unfiltered latest conversation at the bottom. Formal announcement acknowledgements remain explicit.

## Access and migration

- Additive migration: `0047_team_chat_coordination.sql`, registered after 0046 in the migration journal. Adds one favorite flag, reaction/save/pin tables, and indexes. No memberships, messages, accounts or policies are changed by migration.
- New endpoints are mounted after the existing authenticated account, module and current-employment guards. Search, files, replies, saved items and interactions enforce current channel scope and visible-history dates.
- Nonmember administrators do not gain private group or direct-chat access. Saved messages are personal. Reactions require posting access; shared pins require current channel management and posting access.
- Withdrawn text and private attachment keys are omitted from discovery and reply metadata. Manager pin changes are audited atomically. Interactions are idempotent and rate-limited.
- Deploy the matching server/client and run the standard startup migration before serving this build. No new environment variables or paid infrastructure are required.

## Verification

- Full Vitest run: **40 files passed, 494 tests passed, one existing test skipped**. Includes 26 communication tests and 8 migration tests. Duration 268.74 seconds.
- TypeScript check and production client/server builds passed. The existing client bundle-size advisory remains.
- Added checks cover favorites and mute preservation, scoped previews/summary, reaction ownership/idempotency, read-only rejection, personal saves, expired membership, escaped search text, manager-only pins, withdrawn content, file discovery privacy, visible-history limits, direct replies, 25-item pagination and pin-audit rollback.
- Disposable local browser preview used only synthetic people and conversations, with production database/storage/email settings removed. Verified unread and mention counts; automatic read updates; direct-chat colleague names; draft retention; sending a reply; reactions; favorites; personal saved results; opening a saved message; cross-conversation search; mention selection and delivery; pinned instructions; employee controls and private-channel exclusion.
- Responsive checks at desktop and 390 × 844 pixels confirmed light/dark layouts, mobile back navigation, no horizontal overflow, and the focused composer/send control fitting the mobile viewport.

## Operating boundaries

Open messages and replies poll every 5 seconds while the browser tab is active. Channel access/lists and search/saved/files lists refresh every 10 seconds; summaries refresh every 30 seconds. This is not a WebSocket or guaranteed always-on service; existing Render sleep and usage limits apply.

Replies show a message and its direct replies, with navigation through quoted parents. Browser push, offline delivery, voice/video calls, external email/WhatsApp/Slack delivery and recursive thread trees are outside this release. Private storage remains the existing configured provider. Actual production uploads and production messages were not used during this verification.
