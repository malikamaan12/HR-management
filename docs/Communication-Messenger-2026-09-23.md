# Communication Hub — messenger layout

Date: 2026-09-23. Local implementation; not deployed.

## Experience

- Replaced the large header, metrics and multiple toolbars with Chats, Updates and Inbox tabs. Live unread / acknowledgement counts remain visible on the tabs.
- Desktop uses a scrollable conversation list alongside the active conversation. Phones use a full-screen conversation with a back button; the main app header and bottom navigation return with the chat list.
- Chat rows show the latest message, time, unread count, favorites, mentions, mute state and unsent text drafts.
- Conversations have incoming / outgoing bubbles, date separators, a compact composer and accessible message menus. Search, pinned messages, files, favorites, mute and group administration remain available through the header.
- Added an emoji picker. Fine-pointer devices use Enter to send and Shift+Enter for a newline. Touch devices retain normal multiline entry; Ctrl/Cmd+Enter also sends. Existing message limits, attachment restrictions and replies are retained.
- Drafts and the selected conversation survive switching among hub tabs for the current page session. No localStorage persistence of private message drafts.
- Updates use compact count filters. Inbox shortcuts use small buttons. Communication rules link to the central settings page for authorized administrators.
- Existing server authorization, message polling, actions, audit history, membership, announcements and acknowledgements remain in use. No database changes, messaging provider integrations, fabricated presence or read receipts.

## Local validation

TypeScript compilation and the Vite production build passed. Manually viewed the synthetic local preview at desktop and 390px phone sizes, including a populated conversation, chat list, light and dark themes. No live messages were sent; no automated tests or audit suites were run.

## Release

Includes frontend-only changes. Preserve the separate pending settings, payroll exports and device settings work in this checkout when preparing a deployment.
