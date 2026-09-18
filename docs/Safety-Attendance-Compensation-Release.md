# Safety courses, attendance locations and onboarding compensation

19 September 2026. This batch extends the internal induction academy and includes the previously implemented module batch. It is deployed at [e3-hr.onrender.com](https://e3-hr.onrender.com) on the existing Render Free service in application commit `b199199171094d1679d4b67cf1839989f60cf4f3`. Implementation, TypeScript checking, client/server production builds and startup migrations are complete. Full functional testing and audit remain deferred as requested. No new paid service, dependency, hosting plan or storage account was added. This deployment record supersedes earlier same-day migration and deployment deferral notes while preserving their historical context.

## Learning & Training

The existing `/learning` page remains the entry point. The starter safety library contains workplace HSE, fire safety, first-aid awareness, manual handling, event/FEC crowd safety and heat awareness: six courses, 19 lessons and 36 scored quiz questions. Courses include original lesson text and links to the primary sources used to prepare them. They are awareness training and do not confer external accreditation or replace required practical instruction.

The library installs each starter course once, using an eligible existing HR administrator. It does not assign employees or create completion records. Administrators can edit the courses through the existing editor, publish a new release, adjust scoring/deadlines or archive courses. Subsequent starts do not overwrite company edits. A library installation action is available if no eligible administrator existed at startup.

## Changing work locations

Office, event and FEC locations are operational data, not fixed code. HR and authorized team leads manage the locations available within their access. Coordinates, radius and assignments can be changed for new events, with retained history. Global geofence enforcement is administrator-controlled and requires configured location coverage. No real office or event coordinates are presumed.

Once geofencing is enabled, the server evaluates the supplied browser location against the assigned fence; a client-side success indicator is not sufficient. Browser location is an attendance signal, not proof against GPS spoofing. The application does not continuously track employees. New FEC/event time requires an independent supervisor decision before it can proceed into approved payable time. Historical paid records are preserved. See [attendance location setup and approvals](ATTENDANCE-LOCATIONS.md).

## Salary and benefits on onboarding

The onboarding checklist and employee profile expose a dated compensation package. It separately captures basic pay, housing, transportation, food, travel, flight tickets, vehicle, benefits and other items. Each item can identify its payment frequency and whether it is cash, provided, reimbursable or not applicable, with supporting terms.

Regular cash totals are separated from annual, occasional and provided benefits. Flight tickets and vehicles are not silently added to monthly wages. Completion of onboarding requires a package covering the joining date. Existing closed onboarding records are not rewritten.

An administrator can explicitly synchronize monthly or hourly base pay and monthly cash allowances into a dated payroll rule. Daily and per-event package rates remain recorded without an automatic payroll conversion. This does not modify previously approved or paid payroll. Existing payroll approval, effective-date and employee scope controls remain in force. See [the compensation guide](Compensation-Guide.md).

## Release record

- Application commit: `b199199171094d1679d4b67cf1839989f60cf4f3`, repository `malikamaan12/HR-management`, branch `main`.
- Render deployment: [`dep-dams41ijnfac7390out0`](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dams41ijnfac7390out0), existing Free service. Triggered 19 September 2026 at 01:58:14 GMT+3; build succeeded; service live at 01:59:46 GMT+3.
- Startup migrations completed at 01:59:21 GMT+3. This release includes migrations 0029–0041, ending with `0039_attendance_geofencing`, `0040_employee_compensation` and `0041_safety_course_library`; earlier migration history is preserved.
- Compile/build: `npm run check` passed; `npm run build` passed for the client and server. The existing main-bundle size warning remains. Combined compilation also corrected typing and syntax defects in the earlier deferred module batch.
- Public deployment checks: `/healthz` returned HTTP 200 with `ok`; `/readyz` returned HTTP 200 with `ready`; `/` returned HTTP 200 and the exact expected client asset `/assets/index-CQR9-Keo.js`.
- Authenticated read-only check: Learning → Safety course library visibly showed all six published safety courses. No employee enrollment or completion records were fabricated.
- Authenticated attendance page loaded Location management with Add location and an empty location/history table, Administrator enforcement rules with GPS enforcement off and a setup-required notice, and Supervisor attendance approvals. The visible guidance states that temporary, contract and workforce attendance requires independent approval and that Event/FEC timesheets remain blocked pending approval. No settings were saved or attendance created; this was a read-only screen check, not an end-to-end approval test.
- Full functional testing, automated regression tests and audit remain deferred. The deployment checks above establish service availability and the visible course library, not complete workflow acceptance.
- Actual workplace/site location setup and administrator geofence activation remain operational tasks after release.
