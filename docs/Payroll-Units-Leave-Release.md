# Daily pay, assigned-event-shift pay and unpaid leave

19 September 2026. Implemented locally after deployed application revision `b199199`. This batch is not pushed or deployed. It uses the existing stack, introduces no dependency or paid service, and needs no database migration: dated rules and payroll evidence use the existing JSON snapshots.

## Compensation and pay rules

An administrator can publish monthly, hourly, daily or per-event cash base pay from the onboarding compensation package. The owner confirmed that one per-event payment covers one assigned event shift. A shift earns its base amount once when it has positive approved payable time, including a shift crossing midnight; its local start date chooses the period and rate.

Daily pay uses the local work date across approved assignment timesheets. Administrators choose a full day for any positive approved time, or proration by regular approved minutes capped at one day. Multiple timesheets cannot duplicate the daily base. Prorated cents use cumulative daily rounding, so splitting time does not create extra rounding cents. Overtime has a separate enablement control, hourly rate, daily threshold and multiplier. Salary and hourly defaults preserve previous calculation behavior.

All work pay still requires independently approved attendance and timesheets, payroll reservations and independent payroll approval. Monthly cash allowances remain monthly; annual tickets, provided benefits, reimbursement ceilings and one-time amounts are not converted into wages. Package publication retains existing recurring deductions and unpaid-leave settings unless the administrator explicitly changes them.

## Unpaid-leave deductions

New optional settings in **HR Rules → Payroll** and compensation mapping control enablement, basic-only or basic-plus-recurring-allowances deductions, and a divisor of calendar days, scheduled working days, or a fixed day count. Automatic deductions default to disabled and apply only to salaried days. Hourly, daily and assigned-shift bases already depend on worked time and receive no second absence deduction; their monthly allowances are also outside this automatic rule.

Only final-approved requests contribute, using their saved daily paid/unpaid and counted flags. Full days and halves are clipped to employment dates and the pay period. Later leave-policy edits do not change the original request. Missing or malformed historical day snapshots require explicit reconciliation. A working-day divisor requires a configured calendar for the full cycle, rather than an inferred shift pattern.

The engine uses exact rational currency arithmetic and deterministic cent allocation, with separate caps for earned basic salary and eligible salary allowances. Approved work/overtime is excluded from those caps. Payroll details show leave references, dates, units, the monthly base, divisor, deduction and any cap. Existing manual recurring deductions remain separate; administrators must remove any duplicate manual absence charge before enabling the automatic rule.

Each new payroll stores the relevant leave source states. Submission, approval and payment recording detect new, approved, cancelled or revised overlapping leave and require return/cancellation, regeneration and fresh approval. They never silently rewrite the saved amount. Later pay-rule changes do not alter a saved run. Older payroll without the new evidence retains its existing review behavior; historical payments are not recalculated. Leave changed after payment requires an independently reviewed correction in a later run.

## Validation and release status

- TypeScript checking passed.
- Production client and server builds passed; the pre-existing large client-bundle warning remains.
- One combined focused pass passed **49 tests across four files**: approved-time calculations (12), unpaid-leave calculations and source fingerprints (21), authenticated payroll/compensation integration (8), and existing calculation-rule regressions (8).
- Integration used an isolated synthetic PGlite database with the existing migration journal. It covered daily deduplication, supervisor attendance gating, assigned-shift payment and time locking, administrator-only package mapping, retained deductions, half days, stale leave, regeneration/history, independent approval and legacy defaults.
- The pass corrected a duplicate variable in the new payment guard and updated test fixtures for mandatory attendance review notes and strict rejection of caller-supplied leave totals. No production records or rules were modified.
- Full application regression and browser role acceptance remain part of the separate combined validation phase. Push and deployment remain pending for the next release.
