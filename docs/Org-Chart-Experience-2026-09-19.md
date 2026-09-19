# Organization chart experience

The organization chart page now presents company and operational hierarchies as connected person cards. Team navigation includes name/site search and team-type filtering. The selected chart shows its site, effective date, revision, and counts calculated from the records visible to the current user.

## Chart navigation

- Connected hierarchy with initials, role, department, direct-report counts and branch collapse controls.
- Zoom, fit-to-width, reset, expand-all and collapse-all controls inside a scrollable canvas.
- Person/role/department search retains the reporting paths leading to matching people, including paths through collapsed branches.
- List view provides a compact alternative showing each person's role, manager and direct-report count.
- A person panel lets the user navigate to their manager or direct reports and focus the chart on their subtree.
- Circular legacy reporting components remain visible in List view and are flagged in the chart.

## Practical editing

- Add an employee with their intended manager already selected.
- Edit roles and reporting lines in a table, alongside an optional live chart preview.
- Manager choices exclude the employee and their descendants; the existing server hierarchy validation remains in force.
- Removing a manager reconnects direct reports to that manager's parent, with an explanation in the editor.
- Inactive employees are identified before a revision can be saved.
- Revisions start on the selected chart date. After saving, the page shows that effective start date.
- Team creation and details use a dedicated dialog. A work site must be selected explicitly.

The existing team-access rules and administrative permissions are retained. Hierarchy edits do not grant accounts access, create roster memberships, or change leave approvers. No backend changes or database migration are required for this org-chart update.

## Release status

Production frontend compilation succeeded. The existing warning for the large shared application bundle remains. No tests, type-check suite, browser audit, or production data changes were performed, in accordance with the user's instruction to skip tests and audits. This change has not been deployed. The earlier Helpdesk commit and its migration are also pending deployment.
