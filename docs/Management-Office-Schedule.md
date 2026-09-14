# Management office schedule

Confirmed by the owner on 14 September 2026:

- Sunday, Monday, Tuesday, Wednesday and Thursday.
- 09:00 to 17:00, Asia/Qatar timezone.
- Friday and Saturday are weekly non-working days for this calendar.

Administrators can review and save this policy under **Settings → Management office schedule**. Select **Management office** under an employee's **Employment → Work schedule** to assign it. New and existing employees remain **Not assigned** until HR chooses a schedule; job title, employee type and account role do not silently assign it. No production employees existed when this feature was prepared.

Assigned management employees see the schedule in their profile and attendance page. Their leave requests and on-screen leave-day preview use the management working week; the API calculates the authoritative day count from the employee's saved assignment. Supplying a different schedule or day count in a leave request cannot override it. Existing leave requests retain their recorded duration.

The default leave calendar for other employees is preserved. **Assigned shifts** records the employee's roster-based working arrangement; existing event/FEC/temporary shift records are unchanged. A full roster-aware leave calendar remains separate completion work.

09:00–17:00 is an eight-hour daily span, or forty scheduled hours over five days. Break payment/duration, late-arrival grace, overtime eligibility, leave accrual and payroll cycle have not been inferred from these hours. Clocking continues to record actual time and breaks without automatic pay changes.

Migration 0009 adds the constrained employee schedule selector. Existing company settings load the confirmed management defaults; settings saves persist the policy with an audit entry. Older settings clients that omit this new field preserve the saved management policy.

Validation: 105 automated tests pass, including management-vs-shift leave dates, spoofed schedule input, invalid calendars/times, administrator permissions and persistence across legacy updates. TypeScript and production builds pass. Live verification is recorded in the deployment handover.
