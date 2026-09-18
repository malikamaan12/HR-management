# Safety courses, attendance locations and onboarding compensation

19 September 2026. This batch extends the internal induction academy and includes the previously implemented module batch. Implementation, TypeScript checking and client/server production builds are complete. The owner requested a combined GitHub push and deferred the full test/audit phase. No new paid service, dependency, hosting plan or storage account is required.

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

- Additive migrations: `0039_attendance_geofencing`, `0040_employee_compensation`, `0041_safety_course_library`, after the earlier local migrations 0029–0038.
- Compile/build: `npm run check` passed; `npm run build` passed for the client and server. The existing main-bundle size warning remains. Combined compilation also corrected typing and syntax defects in the earlier deferred module batch.
- Automated tests, migration execution and browser acceptance: not run for this batch; deferred as requested.
- Git target: `malikamaan12/HR-management`, branch `main`, as one combined source batch. Repository publication is separate from production deployment.
- Deployment: not performed by creating this release record. Actual location setup and geofence activation remain operational setup after release.
