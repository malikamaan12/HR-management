# Payslip and WPS exports

Implemented locally on 23 September 2026. Not deployed.

## Where to use

- Payroll → Payslips & WPS (`/payroll?tab=exports`).
- HR Rules & Settings → Time & pay → WPS & bank export settings (`/settings/wps`).
- An individual payslip also has an Export this payslip shortcut.

## Selection and output

Choose a payment month, employee group (all, Head Office, FEC, mall activation, event, unassigned), team or site. Search by employee name, staff ID or department and narrow by payroll status. Select up to 500 saved payroll records per export.

Team membership is matched against each payroll record’s saved salary period in the site’s timezone. Head Office also matches the saved office calculation scope, with the current work schedule used for legacy records lacking that snapshot. A complete payslip is exported once per selected record; this does not allocate salary across cost centres.

- Print / Save PDF opens a printable payslip packet and the browser print dialog. Choose Save as PDF; each employee starts on a new page.
- Download payslips saves a standalone HTML packet suitable for printing later.
- Payroll CSV includes saved amounts, salary period, teams, currency, status and payment reference. Text is escaped against spreadsheet formula injection.
- Qatar WPS export produces a monthly SIF v1 CSV. The implementation follows QNB’s published Salary Information File specification: https://qnb.com/sites/qnb/qnbqatar/document/en/enWPSSIFNew . The specific receiving bank still needs to be identified and its upload requirements confirmed.

## Configuration

Administrators configure the employer establishment ID, payer establishment ID or QID, payer bank short code and Qatar IBAN. Existing employee bank names can be mapped to bank short codes. Optional allowance categories use configurable exact payroll labels; categories without mappings remain blank.

Authorized payroll preparers can maintain dedicated employee WPS identity/bank details and payroll-specific WPS salary details. These changes require a reason, use optimistic versions and are recorded in activity history. The employee’s general profile and the saved payroll amounts are not rewritten.

WPS basic salary is proposed from the contractual monthly salary snapshot when available. Proration differences are reconciled against extras/deductions while preserving saved net pay, and explicit review is required when the contract cannot be inferred consistently or differs from paid basic. Working days stay optional rather than assuming 30 days. A deduction reason is required when deductions exist.

## Access and safeguards

Existing payroll permissions and employee scopes apply to all API queries and downloads. Self/read-only access does not receive WPS bank/identity settings. Company payer settings remain administrator-only. WPS exports require approved, independently reviewed, unpaid QAR payroll with current source snapshots, valid identity/bank fields and balanced amounts. Cancelled payroll cannot be exported; unapproved printable payslips carry a draft notice.

Final selection is checked against server-generated fingerprints, current settings, duplicates and approved time/leave sources. Payroll locks and a WPS advisory lock serialize final preparation. Prior WPS exports are recorded; re-export requires explicit confirmation and a reason. Conflicting files using the same minute-based SIF filename are blocked. Export history stores metadata and a content hash, not the complete salary file.

Preparing a WPS file does not send it to a bank, initiate payment or mark payroll paid.

## Storage and build

Versioned WPS metadata uses the existing app_settings table; no database migration or dependency installation is required. Printable files are generated on demand and are not placed in public storage.

TypeScript compilation and production frontend/backend builds completed. Automated tests and audit suites were not run, following the user’s preference. Local visual preview uses only synthetic demo data. No live payroll or bank settings were changed.
