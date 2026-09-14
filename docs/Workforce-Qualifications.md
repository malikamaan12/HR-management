# Workforce skills and qualifications

15 September 2026. This enhancement connects skill requirements to the Workforce screens for event, FEC and mall-activation teams. Employment types remain independent of team types.

## HR workflow

1. Open Workforce and select a team. Choose **Skills catalogue** to add a named skill and optional category. Names are checked for duplicates without regard to case or surrounding spaces. Existing catalogue entries are preserved.
2. In **Team members in this view**, choose **Qualifications** beside an employee. Select a catalogue skill and record proficiency (1–5), plus an expiry time or an explicit no-expiry choice. Times use the selected site's time zone.
3. Edit an existing qualification to renew or correct it. Updates require the version originally loaded; a stale save returns a conflict rather than overwriting another HR user's change. Reload qualifications and select the record again before retrying.
4. A saved qualification is an HR assertion of a skill. It is not automatic certificate verification, training completion or a minimum-proficiency policy. Document evidence and approval workflows remain future work.

Only existing workforce administrators (`super_admin`, `admin`, `hr_director`, legacy `hr`) can manage the catalogue or employee qualifications. Scheduling leads cannot read the employee qualification editor or modify its records. Employee qualification changes and catalogue additions are audited in the same transaction as the write. Legacy duplicate qualifications require reconciliation; this feature does not silently remove or merge them.

## Scheduling and employee workflow

- In **Create shift**, search and select up to 30 required skills. Requirements are optional. Adding a new catalogue skill does not automatically select it or assign it to an employee.
- Administrators and leads with a current scheduling grant can select skills. Creating the shift checks that every selected skill still exists, alongside existing full-shift access checks.
- Roster cards and **My shifts & offers** show the required skill names. Employee views expose requirements only for their own assignments.
- Offering and accepting a shift both verify that all required skills are recorded and remain valid through the shift's end. An expiry exactly at the end is valid; an earlier expiry is not. An explicit no-expiry qualification remains valid for this check.
- Proficiency is recorded for HR; a shift currently requires possession of the skill, without a minimum level or certified flag. Eligibility also checks employment, membership, leave, overlap and capacity as before.
- Updating a qualification after acceptance does not cancel an accepted assignment. HR must review affected operations separately. Recurrence, replacements, qualification-change alerts, evidence attachments and full qualification revision history remain pending.

## Internal API

All routes require the application's existing authenticated session and use the `/api/workforce` prefix. No new machine credentials or EOS integration are introduced.

| Route | Access and behavior |
| --- | --- |
| `GET /skills?teamId=...` | Administrators, or a current scheduling lead for the named team; returns ID, name and category |
| `POST /skills` | Administrator only; `{name, category?}` |
| `GET /employees/:employeeId/qualifications` | Administrator only; minimal qualification fields, excluding certificate notes and other employee data |
| `POST /employees/:employeeId/qualifications` | Administrator only; `{skillId, proficiencyLevel, certificationExpiry, expectedUpdatedAt}`; use null version for a new qualification, or the exact loaded version to update |
| `POST /teams/:teamId/shifts` | Existing scheduling permissions; `requiredSkills` is a unique array of existing skill IDs, maximum 30 |
| `GET /teams/:teamId/dashboard` | Includes catalogue labels only for the visible shifts' requirements |
| `GET /my-assignments` | Includes named requirements for the caller's own assignments |

`certificationExpiry` is an offset timestamp or null. A qualification update locks the employee row used by offer/acceptance checks. The feature uses existing tables and requires no migration beyond the already deployed journal through 0013.

## Verification

All 124 automated tests across 13 files pass. New tests cover catalogue access, revoked/view-only grants, duplicate names, invalid skill IDs, scoped requirement names, employee/lead write denial, stale qualification edits, full-shift expiry, rechecking acceptance and transaction rollback when audit storage fails. Strict TypeScript and client/server builds pass.

An isolated browser walkthrough with synthetic records verified catalogue creation, qualification creation/editing with Qatar expiry preservation, shift requirement selection, rejection of an unqualified offer, a qualified offer, employee-visible requirement names and acceptance. Production HR records were not used for these tests. The existing large frontend-bundle warning remains.
