# Expanded dashboard workspace

Status: implemented locally; not deployed. Tests, browser checks, audits and build/type checks were not run for this change, following the user's request to omit testing and auditing. Earlier release test results do not validate these dashboard changes.

## Experience

The dashboard now combines role-scoped information in a responsive card layout:

- Current active headcount, today's check-ins, approved leave date ranges, team counts, document deadlines, active learning, staffing gaps and processed payroll counts.
- Needs-attention links for pending leave, document deadlines, overdue learning, unfilled staffing places, recent pending attendance reviews and submitted payroll. Counts indicate records in the user's readable scope, not personal approval authority.
- Stacked daily attendance charts with accessible tabular figures, recorded hours, overtime and previous-period hours.
- Active employment-type distribution, departmental progress bars and recent joiners.
- FEC, mall, event and head-office team counts, staffing coverage, upcoming shift table and personal shift offers/assignments.
- Leave status distribution and upcoming approved leave, preserving recorded fractional days.
- Document expiry distribution and earliest deadlines, excluding archived records.
- Training enrollment counts, completion totals, due dates and course progress.
- Payroll totals by currency and a six-month processed-pay chart, with a currency selector and monthly figures.
- Scoped published announcements, unread chat/mention counts and acknowledgement reminders.
- Personal attendance, leave balance and latest recorded payment for employee roles, using the existing employee-summary endpoint.
- Role-aware module navigation, 7/30/90-day trend periods, manual refresh, automatic refresh controls and session-local section visibility.

## Data definitions

The new read-only `/api/dashboard/overview` endpoint applies existing employee-module scope predicates before aggregation. Workforce team summaries use administrator access or current supervisor grants; personal assignments are limited to the signed-in employee. Communication data comes from existing scoped Hub endpoints. It adds no migration, dependency, permission grant or business-policy default.

The selected period controls attendance, joiners, overlapping leave and training completions. Today's indicators remain current, staffing coverage covers shifts starting in the next seven days, personal shifts cover up to six assignments within thirty days, document expiry follows company settings, and payroll uses saved payroll months over six months. Each section states its window. Dates use the configured office timezone; shift times display each site's timezone.

Attendance charts count recorded statuses and do not infer absence from missing rows. Recorded work includes pending records and is not an approved payroll calculation. Leave date-range counts can include half-day requests. Document expiry does not certify full compliance. Currency totals are never mixed. Unknown historic payroll currency remains labelled Unspecified. No forecasts, synthetic growth rates or employee risk scores are introduced.

Overview sections fail independently and are listed as unavailable if their data cannot load; failed sections do not silently turn into zeroes. A failed overview request hides its cached snapshot and offers Retry. Polling is disabled in background tabs. Section preferences last for the current mounted page and do not persist employee data in browser storage.
