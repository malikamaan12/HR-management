# UI and role-access corrections — 19 September 2026

This release aligns the authenticated page shell with existing backend permissions. It does not grant new roles, assign managers, or change company policy.

## Changes

- One navigation manifest covers all 33 module entries and their nested routes. The sidebar and direct-route guard use the same checks; denied pages do not mount or fetch module data.
- Grouped, searchable navigation puts Dashboard first, labels personal records, highlights nested pages, and provides a mobile backdrop, Escape close, keyboard focus handling and skip-to-content link.
- Settings and Bulk Import remain administrator-only. Communication Hub supports existing create-only communication roles. Recruitment management requires all/department scope. Reports uses the same report eligibility function as the server.
- Company charts remain HR/workforce-administrator only. Other accounts need current dated team access to reach operational charts and Team Overview. Self-service workforce, timesheets, reviews, helpdesk, letters, checklists and employment services remain available; their APIs enforce record/action scope.
- Dashboard summaries now use the authoritative employee scope. Department heads see themselves and direct reports rather than unrelated department peers. Department HR without a department receives zero records. Event totals are withheld from accounts without event-management access.
- Dashboard cards and account-menu links respect page/module access. Duplicate communication icons were removed. Unauthenticated permission helpers no longer default to employee access, and missing identifiers cannot establish self ownership.

## Verification

- TypeScript passed; client and server production bundles passed. Vite retains its existing bundle-size advisory.
- Full suite: 38 files passed, 472 tests passed and 1 skipped. Includes account revocation, scoped HR workflows, approvals, private documents, workforce grants, reports, recruitment, payroll and leave regressions.
- Added navigation boundary tests across all existing roles and HTTP tests for team/department dashboard scopes and event totals.
- Disposable local database browser checks: employee denied User Management; HR denied Bulk Import; administrator sees administration entries; team lead sees only assigned operational chart and scoped dashboard count. Search, mobile menu, Escape close, initial focus and 390px chart layout checked.
- No production data was used for browser testing. No database migration is needed.

The work verifies the shared navigation and the identified authorization inconsistencies. It is not a claim that every form and every role/module combination received a manual visual review. Existing backend action checks remain authoritative.
