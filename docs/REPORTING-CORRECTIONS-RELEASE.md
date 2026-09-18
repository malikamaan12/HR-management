# Reporting and candidate correction release — 18 September 2026

Built from live-main commit f0904f7c90012d4bd4c8a8df37224925db510ccb, preserving the existing attendance, payroll, lifecycle, helpdesk, workforce, learning, benefits, expenses and team-task implementation.

## Delivered

- Five owner-private report snapshots: current employee register, date-based turnover, saved approved leave bookings, derived document expiry, and event/FEC delivery in each site's timezone. CSV exports use the exact saved snapshot, with spreadsheet formula protection. Read access is checked against both reporting and the source module on every request.
- Administrator reporting policy with versions and reasons. Existing runs retain their policy. Existing attendance reports and saved views remain available in the Reports disclosure.
- Candidate corrections within Recruitment's application list, with optimistic versions, private previous/new history and atomic audit. Names and QID freeze once an offer exists; contact corrections never overwrite an employee. The database serializes offer creation against identity edits.
- Event Staff opens the existing Workforce workspace. Earlier event records have a reference screen; no assignments are copied or deleted. Legacy APIs remain compatible.
- Page code loads on demand with loading and recovery screens. The final main bundle is 626.22 KB minified / 179.37 KB gzip; the build still reports a size warning.
- Fixed the existing team-task owner lookup import and added an integration check.

## Verification

The combined live-baseline regression run passed 221 of 222 tests. Its one new fixture used fractional leave days, unsupported by the existing live integer field. After adapting the synthetic fixture to that unchanged schema and adding the team-task check, all 11 affected tests passed. Together these cover **223 tests across 17 files**. TypeScript and production client/server builds passed. Migration checks cover an empty database, repeat execution, and upgrading the prior live journal while retaining existing candidate and policy data.

Final isolated browser acceptance verified report generation and the candidate correction workflow through the actual live-baseline screens. The original implementation preview additionally verified saved report reopening, export action, candidate history, Workforce/archive navigation and a 390 px report layout. All preview data was synthetic and stayed in memory.

## Deployment boundaries

Released to the existing Render Free service on 18 September 2026 at approximately 19:19 Asia/Qatar. Render deployment `dep-damm7usri2ms73drt3ig` succeeded for commit `d64f3c21fef5c2bd838b7a9f31b6911f8597b4e8`; its startup logs confirm database migrations completed. Public `/healthz` and `/readyz` both returned HTTP 200, and the homepage serves the expected `index-DevnPKcg.js` release asset. The authenticated live Reports page loaded its saved-run list and reporting policy successfully. Production smoke checks were read-only; no demonstration data or policy changes were submitted.

Use only the existing Render Free service srv-dajuem0jo6nc73fb36r0 and Supabase. The new additive migration is 0026_report_snapshots_candidate_corrections. Preserve the prior migration journal; do not replace it with the older enhancement branch's different 0015–0038 history. No paid resources, credentials, production policy values or operational employee records are changed by this release.

Earlier local batches are preserved in GitHub enhancement commit b0b3e2a (enhance/admin-calculation-rules). That branch has 295 passing tests on its own schema, but is **not safe to deploy directly over live main**. Employee import review, extended document/onboarding governance, equipment/handbook, probation/transfers/incidents, employment continuity, EOS-side contracts and other unpublished local workflows need explicit code/data reconciliation against the live architecture. This release does not claim those branches have all been merged.

HR/finance acceptance of calculation policies, retention periods, Resend sender configuration and the actual EOS integration remain outstanding. WhatsApp stays deferred.
