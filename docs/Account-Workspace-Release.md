# My Account workspace

The account page now contains a profile editor, password controls and signed-in session management. It replaces the employee-facing password link to administrator-only Settings.

- Profile: clear identity header, editable first/last name, disabled no-change saves, reset and inline success/error states. Username, email, role and department remain administrator-managed.
- Password: available directly to every signed-in role; visible requirements match the server's accepted characters, confirmation matching, visibility control and a distinct-password check. Successful changes use the existing password workflow, end prior sessions and sign the user out. The form also replaces the duplicate Settings form.
- Sessions: current-browser label, browser/platform, last-used time, expiry, IP and explicit confirmation before ending another session. Expired sessions are excluded by the server. Responses do not expose session tokens; authentication responses use no-store caching.
- Support: role-aware links to the employee record and HR Helpdesk, plus a sign-out action.

No database migration or dependency was added for this account change. The combined release also contains the pending daily-chat migration `0047_team_chat_coordination.sql`, announcements upgrade and expanded dashboard.

Tests and audits were not run, following the user's instruction. Production client/server builds are part of release preparation. No real password, profile or session is changed during deployment verification.
