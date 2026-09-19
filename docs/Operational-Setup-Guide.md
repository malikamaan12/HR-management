# Operational setup

19 September 2026. Deployed in consolidated application revision `e99c47e` on the existing Render Free service at 08:59:19 GMT+3. It uses existing application tables, permissions and storage; no migration, additional dependency or paid service is required. The combined release passed 350 tests, and this workspace was verified in the authenticated live app. See [validation and deployment evidence](Combined-Validation-Release.md).

## Administrator workspace

**Operational setup** in the sidebar opens `/operations-setup` for administrators and super administrators. The overview reports active employee/account counts, workforce teams/sites and actionable configuration gaps. Tabs bring together the existing location and leave-rule editors, supervisor management links, and a focused published induction requirements editor.

Readiness checks are read-only. The date selects location validity, dated membership/reviewer coverage and effective leave rules for currently active employees. Accounts, roles and published courses use current state; this is not a historical personnel snapshot or a guarantee that future records will remain unchanged. Queries project operational fields without personal documents, contacts or pay details. Bounded queries and visible issue limits report incomplete checks instead of claiming readiness.

- **Employee accounts:** active approved linked logins and assigned work schedules.
- **Locations:** enabled boundaries valid on the selected date, office-clock coverage for active employees, staffed workforce site coverage and GPS enforcement. Office and workforce clocks have distinct coverage requirements.
- **Supervisors:** independent primary attendance reviewers where required, dated workforce membership/review access and one independent reviewer grant covering each full accepted shift, including overnight portions. Global HR fallback access is distinguished from a designated supervisor.
- **Leave:** latest effective employee override or company rule per configured type, independent active approvers with actual role/record scope, and sequential stages. An unassigned first stage means any independent eligible approver, excluding later named reviewers.
- **Induction:** published mandatory course audiences, reviewer eligibility where required, and missing required enrollments in open onboarding cases. Draft changes are not active requirements.

An empty employee directory stays **Not started**. The live directory was empty when this batch was prepared; no employee, supervisor, location coordinate, leave entitlement or training mandate was invented or written to production.

## Configure actual operations

1. Import or create real employees, select office/shift schedules and employment types, link approved accounts, and maintain primary reporting relationships.
2. Create each event, mall or FEC site/team in Workforce. Add dated employee memberships and independent supervisor review-time grants covering the complete shifts.
3. Save actual location coordinates, radius, applicable employees/site and operating dates. Review coverage before explicitly enabling GPS enforcement. Locations remain editable as venues change.
4. Publish company leave types or employee overrides with actual entitlements, effective dates and approval stages. Existing requests retain their saved policy and routing snapshots.
5. Choose published courses required for onboarding, their eligible employee types/departments and due-day offsets. Course lessons and quizzes remain in Learning & Training.

## Induction requirement publishing

The course list is searchable and paginated in batches of 25. It exposes only titles, versions, four requirement settings and publication availability; lesson text, quiz questions and answers are not returned.

Publishing can change only `mandatoryForOnboarding`, `employeeTypes`, `departments` and `defaultDueDays`. Empty departments means all departments. The deadline is relative to the later of enrollment and joining date. A reason and the selected course, draft and release versions are required.

The server uses the existing authoring locks and rejects stale versions, unpublished author changes, draft/archived courses, invalid assets/approvers or incompatible capacity. A real change creates an immutable release and audit/history entry. Existing lesson/question content, enrollments, quiz attempts, scores and certificates are retained. An unchanged settings submission does not create an extra release.

New matching onboarding cases use the published requirements. Existing open cases require the explicit induction-assignment refresh in Onboarding; publishing requirements never bulk-enrolls employees. That refresh reuses valid completions/open enrollments and marks them required where needed. Closed cases and prior completion records are not rewritten.

## Verification and remaining work

- TypeScript checking and production client/server builds passed; the existing large client chunk warning remains.
- One combined focused pass passed **25 tests across three files**: six authenticated readiness integration cases, seven supervisor/leave/date/limit evaluator cases and twelve training publication integration cases.
- Integration used isolated synthetic PGlite databases and the existing migrations. Checks covered RBAC, response privacy, empty-company status, dated geofence coverage, independent full-shift reviewers, leave stages, published audiences, version conflicts, unpublished draft protection and immutable completion/quiz history.
- Real employee imports, venue coordinates, supervisor choices, leave policies and mandatory-course choices still need operational input. GPS has not been enabled in production.
- The combined application regression, browser role checks and deployment completed on 19 September 2026; see [Combined-Validation-Release.md](Combined-Validation-Release.md). The later Services & recovery addition described below remains local pending a future release.

## Local Services & recovery addition

The next batch adds an administrator-only Services & recovery tab, also available in Settings. It reports database connectivity and application/email configuration, and supports an explicit Supabase private-storage probe with saved stages, configuration-change detection and temporary-file cleanup retry. It does not send email or change operating policies. Encrypted application database backup, archive verification and empty-local-database restore tools are documented in [Backup-Recovery-Guide.md](Backup-Recovery-Guide.md). No new migration, dependency or paid service is required. This addition is not deployed.
