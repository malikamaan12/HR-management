# Organization charts and operational teams

The dashboard opens **Manage teams & org charts**. HR and administrators can create an event, FEC, mall activation or head-office team, select its work site, edit its name/type, and build an independent employee reporting hierarchy. Sites and dated memberships remain in Workforce.

The company chart reads current active employees and their existing reporting-manager links. Company reporting lines are edited in Employee Database. Team roles and managers do not overwrite those company relationships.

Each team chart has an effective start and optional end date. A blank end means ongoing. Saves append a revision, and the newest revision covering the selected date applies. Empty revisions are supported. Prior rows remain retained. Concurrent stale edits, self-reporting, duplicate employees, missing parents and reporting cycles are rejected. Charts support up to 500 employees and 20 reporting levels.

HR/administrators can manage charts. Other users need current team access also covering the requested chart date, and see only people with dated membership on that date. Assigning a chart role grants no account, roster or approval permissions. Leave approvers remain explicit HR Rules assignments.

Changing a team's site is blocked after it has shift history, preserving the existing time zone and attendance interpretation. Create another team for a different site in that case.

## Requested initial teams

User-requested names (live preparation verified 19 September 2026):

- Kids Driving School — FEC
- Urban Arena — FEC
- Inflata Park — FEC
- Kids Mini Driving School — FEC
- Crayon & Bricks — Vendome Mall — FEC
- Head Office — Head office

Use Asia/Qatar for these Qatar work sites. Team heads, staff assignments and effective dates remain to be supplied. Do not invent reporting assignments or import synthetic preview staff into production.

Five FEC team records have been created live, using existing KDS, Urban Arena and Inflata Park sites and new Kids Mini Driving School and Crayon & Bricks sites. The Head Office site is also created. Its team awaits deployment of the new head-office work type. Existing site time zones `Etc/GMT-3` were preserved; new sites use `Asia/Qatar`. No memberships or permission grants were created.

Validation: 462 tests passed and 1 skipped across 37 suites; TypeScript and client/server production builds passed. Synthetic browser verification covered dashboard navigation, company reporting lines, creating a Head Office team, saving a manager/staff hierarchy with no end date, and editing team details.

## Associated training correction

Published course requirements now choose whether the deadline starts at enrollment/future joining date (the backward-compatible default) or the employee's joining date. Selecting joining date with 30 days preserves the deadline when assignment is late, including showing an already-overdue date. Saved enrollments retain their due dates; explicit HR due-date overrides remain available.

Migration `0046_team_org_charts.sql` adds the head-office team type and chart revision table. It does not populate teams or change existing employee reporting, permissions, leave rules, training assignments or pay.
