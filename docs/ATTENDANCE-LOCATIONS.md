# Attendance locations and supervisor approval

Implemented inside **Attendance → Location management**, using the existing database and browser GPS. No map API, paid licence, extra hosting provider or dependency is required.

## Setup and ongoing location changes

HR can create and revise office, individual employee, event, FEC and mall activation boundaries. Locations contain actual latitude/longitude, radius in metres, optional active dates and an archive switch. Office locations can apply to everyone or selected employees. Site locations follow the selected workforce site; create new sites in Workforce as venues change. Multiple active boundaries per office/site are supported.

Authorized scheduling leads can create and change site boundaries only for sites they manage. If several teams share a site, the lead must hold scheduling authority over all of them. HR can manage organization-wide or individual assignments. Every edit uses an expected version and retains its previous definition and reason in history. Archiving does not erase GPS evidence from attendance records.

An administrator or super administrator controls the shared enforcement policy. Installation starts with GPS enforcement disabled because actual workplace coordinates are not supplied. The UI shows setup readiness. Enabling enforcement requires coverage for every active employee's office clock and every currently staffed workforce site. Later new hires/sites, expired locations or archived boundaries without replacements fail closed while enforcement is enabled. Configure their locations before they work. Temporary sites can have dated boundaries and be archived after an event.

The same location rule applies to permanent, temporary and contract employees. Administrators can set the maximum reported GPS uncertainty and reading age. At clock-in/out and workforce arrival/departure the server checks coordinate ranges, age, accuracy and distance against active assigned boundaries, and stores the matched boundary version. GPS is requested only for those actions, not continuous tracking. Browser GPS is evidence; it cannot guarantee resistance to device/location spoofing. No external location lookup is performed.

## Supervisor approvals and exceptions

Temporary and contract daily attendance, and daily attendance for active workforce members including permanent FEC employees, enters a supervisor queue. Administrators may also require approval for permanent office attendance. A scoped independent supervisor records approval or rejection with a reason; self-approval is rejected. Existing attendance corrections remain independently reviewed exceptions and preserve the reason and location-exception evidence.

Event, FEC and mall assignment attendance uses the existing Workforce visit record, with explicit pending/approved/rejected status. Scheduling leads may close open visits with a reason; current `review_time` supervisors approve or reject completed visits. A supervisor can record a missing-visit exception from the Timesheet review panel with actual times and a reason. An existing visit must follow its existing review path. These controls apply to all employees on those assignments, regardless of employment type.

Assignment timesheet approval, payroll selection and payroll locking require approved attendance. Pending or rejected visits do not become payable time. Daily office attendance cannot substitute for assignment approval. Approval of attendance does not itself calculate or pay salary: worked hours still pass through the existing Timesheet and payroll approvals. Historical completed work before migration installation is preserved.

## API

Authenticated endpoints, under existing role and employee/team scopes:

| Endpoint | Purpose |
|---|---|
| `GET /api/attendance/location/context` | Policy, employee's boundaries, management capabilities and admin readiness |
| `GET /api/attendance/location/locations` | Locations within HR or team lead scope |
| `GET /api/attendance/location/employees` | HR assignment directory |
| `POST /api/attendance/location/locations` | Create `{version:0,config,reason}` |
| `PUT /api/attendance/location/locations/:id` | Revise or archive `{version,config,reason}` |
| `GET /api/attendance/location/locations/:id/history` | Previous boundary definitions and reasons |
| `POST /api/attendance/location/policy` | Admin-only `{version,config,reason}` |
| `GET /api/attendance/location/approvals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Scoped daily approval queue, up to 93 days / 500 records |
| `POST /api/attendance/location/approvals/:id/review` | `{version,decision:'approved'|'rejected',reason}` |
| `POST /api/attendance/clock-in` / `clock-out` | `{position:{latitude,longitude,accuracy,capturedAt}}` when enforcement enabled |
| `POST /api/workforce/assignments/:id/arrival` / `departure` | Same GPS position contract |
| `GET /api/workforce/assignments/:id/attendance-review` | Independent supervisor view `{presence}` |
| `POST /api/workforce/assignments/:id/attendance-exception` | Independent missing-visit exception `{startAt,endAt,reason}` |
| `POST /api/workforce/presence/:id/review` | `{version,action:'approve'|'reject'|'close',reason}` |

Apply migration `0039_attendance_geofencing.sql` before deploying the server code. Old legacy `/api/geofences` writes are retired; they were not connected to GPS enforcement. Actual workplace location entry and enforcement activation remain administrator setup tasks.

Implementation only: no database migration, live GPS validation or end-to-end test was run by this implementation subtask. The parent task performs the combined compile/build and authorized push.
