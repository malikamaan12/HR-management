# Company policy configuration

User instructions recorded 19 September 2026. These are configuration requirements, not hardcoded salary values or a record of live activation.

| Area | Confirmed configuration |
| --- | --- |
| Head office | Events & Entertainment Enterprises, supplied map pin 25.3182439, 51.5269865; street address not independently verified |
| Management office schedule | Asia/Qatar, Sunday–Thursday, 09:00–17:00; Friday and Saturday off |
| Management leave | Named HR approver |
| Team leave | Selected reporting manager or team lead per employee |
| Mall/FEC leave | Selected operations manager, with dated supervisor/acting-manager cover |
| Event leave | Selected event supervisor |
| Permanent annual leave | 30 days after completing the first service year, zero carryover |
| Half days | Enabled in applicable leave policies; existing half-day implementation applies to one office workday |
| Payroll | Monthly payment on the 1st, completed 28th–27th cycle; for example, 1 October pays 28 August–27 September |
| Compensation | Employee-specific basic pay, allowances, deductions and pay basis, maintained in dated configuration |
| Training | Mandatory onboarding courses due within 30 days; course selection and approver still required |
| Email sender | hr@eeeqa.com; email provider key and verified sender configuration still required |
| Accounts | Administrator creates accounts; public registration closed; users change their password and administrators can override another permitted account's password |

## Inputs still needed before activation

- Leave renewal: joining anniversary or calendar year; entitlement counts calendar days or working days.
- Names/accounts for HR, team approvers, FEC operations manager and cover, and event supervisors. Existing reporting relationships are not a substitute for granting approval access.
- Policy effective date, head-office attendance radius, and whether GPS enforcement should be enabled.
- Each employee's actual compensation and applicable allowance/deduction amounts.
- Required course list and training reviewer.
- Email provider configuration entered securely in the hosting environment; do not commit API keys.

## Release behavior

Leave rules support employee-type eligibility, completed service years and dated acting cover. Acting cover applies when a new request is submitted; previously submitted requests retain their saved approval chain. Existing annual accrual renews by calendar year; anniversary renewal must not be represented as configured until implemented if selected.

Administrator password override invalidates existing sessions and reset links, records the administrator and reason, and preserves any freeze, hold, or revoked-access state. It never logs the password. Existing self-protection and administrator hierarchy remain in force.

These changes need no database migration. Company settings, staff assignments and salary amounts must be saved separately after the missing inputs are resolved.
