# Communication Hub deployment — 19 September 2026

Application commit `d106f7b8e894b9404c54d3c44e4ee22c0b90e47e` is live at [Communication Hub](https://e3-hr.onrender.com/communications). The commit was pushed to `malikamaan12/HR-management` on `main` and deployed manually to the existing Render Free service.

## Deployment evidence

- Service: `srv-dajuem0jo6nc73fb36r0`. The hosting plan, environment, build/start commands and automatic-deployment setting were not changed.
- [Deployment `dep-dan4r7n40ujc73alps3g`](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dan4r7n40ujc73alps3g) started at **11:53:50 GMT+3** on 19 September 2026, selecting the exact tested commit.
- Render checked out `d106f7b8e894b9404c54d3c44e4ee22c0b90e47e`. Frozen-lockfile installation passed; the log confirmed removal of the Slack SDK. Client/server builds succeeded at **11:54:23**. The existing bundle-size warning remains.
- Startup ran `pnpm db:migrate && pnpm start`. **Database migrations completed** appeared at **11:55:06**. Additive migration `0043_internal_communications.sql` is registered in this release; previous migration files are unchanged.
- The server started on port 10000 at **11:55:24**. Render reported **Deploy succeeded / Live** at **11:55:26**, duration **1m36s**.

## Live acceptance

- `/healthz`: HTTP 200, `ok`; `/readyz`: HTTP 200, `ready`.
- `/`: HTTP 200, serving expected client asset `/assets/index-DtqRzK4O.js`.
- Signed-out `/api/communications/context` and `/api/communications/channels`: HTTP 401.
- Signed-in administrator: **Announcements & briefings**, **Conversations**, **Action inbox** and **Administration** loaded without application errors. Empty notices/conversations/inbox returned normally. The policy screen showed default version 0, direct messaging and authorized group creation enabled, 4,000-character messages, 5 MB files and 365 visible-history days.
- No announcement, conversation, message, acknowledgement, employee record or policy was saved during live acceptance. Existing user tabs and provider settings were preserved.

The implementation and local validation are documented in [Internal-Communication-Hub-Guide.md](Internal-Communication-Hub-Guide.md): 52 combined tests passed, followed by a passing 17-test rerun for the final compatibility access fix, TypeScript/build checks and an isolated administrator/employee browser check. Live acceptance verifies deployment, startup, access barriers and screens; an actual production file upload/download was not performed. Free-host sleep/usage limits continue to apply. No paid service was added.
