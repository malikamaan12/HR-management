# Admin calculation rules

The **Settings → Rules & calculations** panel is available to Admin and Super Admin accounts. It is the single place to review and publish the calculation methods used by attendance, leave, payroll totals and event/FEC timesheets.

Rules are separated into three policy groups:

- **Default / unassigned** for employees without a selected schedule.
- **Management office** for employees assigned to the Sunday–Thursday office calendar.
- **Assigned shifts (event / FEC)** for rostered temporary and event work.

Each group supports a versioned policy. An administrator previews a proposed change, supplies an effective date and reason, then publishes it. Published versions are immutable and every new attendance record, leave request, payroll draft and timesheet stores the version used. Existing records keep their original calculations. If two versions have the same effective date, the later publication is used for new records.

Configurable methods currently include:

- Attendance and timesheet break treatment, rounding interval and rounding direction.
- Management late-arrival grace, which may be disabled and does not deduct pay.
- Leave working-day versus calendar-day counting, maximum request span and an optional holiday list.
- Payroll final-total rounding unit and direction, with the adjustment stored on the payroll record.
- Event/FEC payable-time mode: reviewer-entered minutes with a policy reference or server-calculated minutes.

The preview compares the saved policy with the draft using sample time, leave dates and amounts. It does not create a record. Unknown formulas, arbitrary code and invalid ranges are rejected by the server schema. All publication and settings changes are audited without storing sensitive sample values.

Rules that require a business decision remain deliberately disabled: overtime multipliers, salary proration, automatic deductions, leave accrual/carryover and payroll cycle. Add them as validated fields and effective-dated versions when the policy is confirmed.

## Safe operations

1. Select the policy group.
2. Edit the method controls and optional holidays.
3. Run **Preview calculations** and compare the proposed column.
4. Set the Qatar effective date and record the approved change reason.
5. Publish. Reload before a second administrator publishes if the editor warning appears.

Do not edit or delete rows in `calculation_rule_versions`; the database trigger rejects mutation. To restore an older policy, copy its version into a draft and publish it with the new effective date.
