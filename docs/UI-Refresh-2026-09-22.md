# Application UI refresh — 22 September 2026

The authenticated application was visually reviewed across its 33 module entry screens. Changes concentrate on the shared layout and the pages with the most stacked instructions and forms. This is a visual review, not an end-to-end workflow or authorization audit.

## Changes

- Midnight navy navigation, violet and mint accents, dimensional cards, compact headers, and a narrower sidebar with collapsible, searchable groups.
- Framer Motion entrance effects, animated icons and chart details respect reduced-motion preferences. The phone layout adds permission-aware bottom navigation.
- Dashboard presents a personalized hero, real attendance trend and priority count, with clearer visual metric cards. Helpdesk uses a tabbed inbox, request cards, category shortcuts and a resolution ring. HR opens the team inbox; staff open their own requests.
- Sidebar branding uses the configured dark-mode logo. The employee directory opens in its card view and retains the table toggle.
- Horizontally scrolling tabs on narrow screens. Shared operational tables become labelled record cards on phones, with pagination for long attendance, payroll and HR-rule lists.
- Attendance separates reports, clock actions, corrections, approvals and locations. Location management still uses the server-provided permission.
- Payroll separates pay runs, the selected payslip and calculation guidance; the paid summary includes processed records. Its status chart and currency totals use returned records.
- Employee Import separates upload, history, review and its field guide. Existing staging, correction and confirmation safeguards remain.
- The employee directory offers table and card views; document status cards filter the register.
- Workforce separates roster, members and access rules. Operational Setup, HR Rules and Reminder Rules separate overviews, records and configuration.
- Explanations in Team Overview, Equipment and Retention are available on demand. Account Management highlights access/setup counts and folds away bulk provisioning.
- Shared status colors are retained in production CSS; session/access errors use readable messages instead of raw HTTP status strings.

## Visual coverage

Entry screens inspected: Dashboard, My Account, Communications, Helpdesk, Employees, Organization Charts, Recruitment, Onboarding, Employment, Team Overview, Workforce, Event Staff, Attendance, Timesheets, Leave, Payroll, Benefits, Expenses, Documents, HR Letters, Equipment, Handbook, Learning, Performance, Assignment Reviews, Reports, Retention, Bulk Import, User Management, HR Rules, Operational Setup, Reminder Rules and Settings.

The built UI was then inspected with isolated local synthetic records. Additional views included employee cards, attendance pagination, a selected payslip, workforce members, the HR rule editor, import history, and sidebar search. Phone checks at 390 × 844 covered Team Overview, Attendance, Employee Import, the directory and navigation. Attendance and directory content remained within the viewport; light/dark appearance and badge contrast were inspected.

Some live entry views returned HTTP 401 errors. Their corresponding local entry views loaded except for the unlinked preview administrator's personal induction list, which also returned 401. The UI now presents a recovery message, but this change does not resolve or claim to diagnose the underlying authorization/session response. Empty views are reported as empty rather than fabricated data.

The stronger visual revision was also inspected locally on Dashboard and Helpdesk, including filters and the category-to-request dialog. The user approved the revised design for deployment.

## Validation and release status

- TypeScript check: `tsc --noEmit --incremental false`.
- Production frontend and server builds passed (existing large-bundle advisory remains).
- `git diff --check` passes with the repository's configured line endings.
- No automated test suite or security audit was run, as requested.
- Publishing and deployment were explicitly approved on 22 September 2026. This release changes client presentation only and adds no database migration. Import scripts, preview seed data and unrelated QA notes are excluded from the release.

The local preview runs at `http://127.0.0.1:5191` using an in-memory database. It is a temporary visual preview; it does not connect to the live database or deliver messages. Local demo assets are placeholders, so document delivery is outside this visual review.
