# Attendance, leave, payroll and employee lifecycle

Implemented locally on 15 September 2026. This release adds migrations 0015–0018. It has not been deployed to the hosted application.

## Administrator rules

Open **HR Rules** in the sidebar or through Settings. Administrators can create company defaults and individual employee overrides for:

- Attendance: timezone, working days, office start/end times, break duration, late-arrival grace and named holidays.
- Each leave type: paid/unpaid designation, whether a balance is required, annual grants or monthly accrual, carryover cap, minimum service, consecutive-day limit and designated approver.
- Payroll: currency, monthly cycle start, payday, salary/hourly basis, basic salary, hourly rate, daily regular-time limit, overtime multiplier, recurring allowances/deductions and pay approver.

Every save creates a revision with an effective date and reason. For a given date, the newest applicable employee override takes precedence over the newest company rule. **Revise** copies an existing revision into the form. An override continues until another employee revision supersedes it; to return to company terms, save an employee revision containing those terms from the desired date.

Leave requests, payroll and checklists keep snapshots. Changing a rule or template does not rewrite existing requests, accrued credits, pay runs or assigned tasks. Use an explained balance adjustment for entitlement reconciliation and cancel/regenerate a payroll draft when its underlying policy needs changing. Rule values are business decisions made by administrators; the application does not certify legal compliance.

## Attendance

Employees clock in, take multiple breaks and clock out. The server finds open attendance across midnight, subtracts actual breaks and rejects duplicate clocks or open entries older than 24 hours. The effective work calendar supplies the employee timezone and grace allowance. Shift workers use accepted roster start times for lateness. Unassigned employees have no assumed planned office hours until a calendar is configured.

The daily view shows planned roster/calendar minutes, actual minutes and variance. Reports provide scoped attendance records and CSV export. A correction records the proposed completed interval, break minutes, reason and original record version. A different approver reviews it; stale corrections and approved-leave conflicts are rejected. The original record and decision remain in the correction history. Direct legacy attendance overwrites are disabled.

Attendance captures observed time. Payroll uses **approved assignment timesheets** for hourly and overtime pay; clock entries do not automatically become payable time. QR and biometric hardware adapters are separate integration work.

## Leave

1. Configure the relevant leave types and calendar in HR Rules.
2. Reconcile opening balances through Leave → Employee balances → Opening balance or adjustment. Another administrator must adjust an administrator's own employee balance.
3. Choose the employee, leave type and dates. The server previews counted working days, excluding holidays. Shift-based employees need accepted assignments to identify scheduled days.
4. Submit a request. Pending requests reserve the required balance and overlapping requests are rejected.
5. An independent approver approves or rejects it. A configured approver is enforced, and employment dates/status are checked again at approval. Approval posts ledger usage once. An approved cancellation requires an independent approver and refunds usage once.

Annual grants post on the first eligible day in each calendar year. Monthly accrual posts after a full month during which the employee and rule were eligible. Carryover uses the rule effective on 1 January, caps the positive prior-year balance and waits for prior-year pending leave decisions. Entries are created lazily when balances or requests are evaluated and have unique source keys, so repeated reads do not duplicate credits. Entitlements can use hundredths of a day; requests currently use **full scheduled days**. Half-day/hourly requests and multi-stage approval chains are not enabled.

The dashboard's available balance uses the same ledger and subtracts pending reservations. Leave without a required balance is shown separately. The calendar shows approved absence ranges. Paid/unpaid designation is saved with the request; any resulting payroll deduction is an explicit reviewed adjustment in this release.

### Existing leave data

Legacy `leave_balances` records are retained and are not automatically imported into the new ledger. Reconcile their net opening values, including existing approved usage, before entering adjustment credits. Legacy pending requests without policy snapshots must be cancelled and resubmitted before approval. Existing approved records remain historical evidence; reconcile any legacy cancellation manually in the new ledger. Closed-year corrections use an explained current-year adjustment.

## Payroll

1. Configure a pay policy with an active independent approver. The generator, pay approver and employee being paid must satisfy the separation checks.
2. Approve assignment timesheets. Select the **payment month** and employee, then generate after the pay period ends.
3. Review the pay items and approved-time lines. Add explained allowance/deduction adjustments as needed.
4. Submit the draft. The designated independent approver approves it or returns it to draft. The pay approver cannot edit the amounts they review.
5. Complete payment through the organization's external payment process. Record its reference and confirmation. This marks payroll processed and locks its included timesheets in the same transaction.

For payment month September and cycle start day 1, the period is 1–31 August. For cycle start day 20, it is 20 August–19 September. Payday must be on or after the period end within the payment month. Cycle days and payday support 1–28. Currency, cycle and approver must remain consistent throughout a period; an overlapping cycle is rejected.

Monthly salary and recurring amounts are prorated across calendar days in the period, respecting joining, contract end and termination dates. Effective rate changes are applied per day. Hourly pay uses approved payable minutes. The daily regular-time cap is shared across all included timesheets; additional minutes use the configured overtime multiplier. A salary-based employee receives salary plus approved overtime. Each assignment is attributed to the **site-local start date**, including overnight assignments. Rates, versions, calculations and source timesheets are saved in the pay run. Calculations round to cents.

Included time is reserved against other pay runs and cannot be changed. Return an approved/submitted run to draft, then cancel it to release its time. **Regenerate draft** recalculates a cancelled run while keeping prior figures and review history. Legacy pending payroll without review metadata can also be regenerated, after checking any existing linked time. Processed payroll is immutable; subsequent reconciliation requires a separately reviewed adjustment in another period.

The page offers a printable payslip and reconciliation CSV with currency separated in totals; cancelled runs are excluded from totals and retained in exports/history. The printable view is the employee pay detail. These are operational formats, not a country-specific bank/WPS file. No transfer, bank submission, statutory tax calculation or automatic end-of-service settlement is performed.

## Recruitment

Create a draft requisition, submit for approval, obtain another approver's approval and open it. Recruitment access is scoped to the caller's permitted departments. Create candidate applications on open jobs and record screening/shortlisting/rejection reasons.

Schedule interviews for shortlisted candidates, select an active interviewer with department access, and record meeting details, format and round. After the scheduled time, record rating, feedback and hire/reject/hold recommendation. Cancellation and no-show are recorded explicitly. Stale or repeated decisions are rejected. Scheduling is an internal record; it does not send invitations or contact candidates.

Issue an offer with salary, currency, joining date and acceptance deadline. Offered salaries currently use whole currency units. Record the candidate's actual response and evidence note; the application does not contact the candidate or sign an agreement. Declined/expired offers return the application to shortlist so a revised offer can be issued. Accepted offers can be converted by an HR administrator using the complete employee form and an onboarding template. Department, employment type, joining date and vacancy capacity are checked. Employee creation, offer handoff and checklist creation commit together; retrying the handoff does not create another employee. The employee pay policy is configured separately in HR Rules; an offer does not silently create payroll rules or an account.

## Onboarding and offboarding

HR administrators create reusable checklist templates. Each task has a type (general, document collection or asset return), required flag and due-date offset. Start a workflow for an employee, then assign owners and dates. Employees can view their own checklist; assigned owners can complete only their assigned tasks. Managers control reassignment. Completed tasks require evidence. Document tasks require a private uploaded document belonging to the employee, and asset-return tasks require an asset identifier.

Completion requires every mandatory task. An independent HR administrator completes offboarding on or after the last employment date. Future accepted/offered work must first be reassigned or cancelled. Completion marks the employee inactive, saves the termination date, disables the linked account and revokes its sessions atomically. Another administrator must remain active. Cancelling an in-progress workflow retains its tasks/history and does not deactivate the employee. Completed/cancelled workflows cannot be edited.

## Release and verification

- Apply the migration journal against a reconciled, backed-up database. New migrations add effective rules/leave accounting/corrections (0015), payroll reviews/time lines (0016), lifecycle templates/cases/tasks/handoffs (0017), and hiring versions/currency (0018).
- Test with separate administrator, reviewer and employee accounts linked to employee profiles. Confirm employee/department scopes and private document access with the actual intended roles.
- The automated suite covers rule overrides, ledger reservations/carryover/refunds, correction conflicts, midnight clocks, rate changes, daily overtime, regeneration, transactional rollback, interview access and transitions, handoff idempotency, checklist ownership and offboarding session revocation.
- `node scripts/preview-operations.mjs` serves a disposable synthetic preview at `http://127.0.0.1:5190` after the frontend build. It strips database/storage/messaging credentials, generates temporary account passwords, and uses in-memory PGlite. Restarting discards its records.
- Managed PostgreSQL concurrency acceptance, live email delivery, browser file upload and backup restoration remain deployment checks. Automated storage/email tests use mocks. Existing document APIs provide the actual private upload/download workflow.
