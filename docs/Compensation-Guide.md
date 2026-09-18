# Employee salary and benefit packages

The Salary and benefits panel is available in an employee profile and in the onboarding workflow. HR records the package before completing onboarding; a package must apply on the workflow start date. Creating an employee or accepting an offer does not invent salary or benefit amounts.

## Record the breakdown

Every package explicitly records base salary, housing, transportation, food, business travel/transport, flight tickets, vehicle, benefits and other items. Additional named allowances or benefits can be added. Mark an item not applicable when there is no entitlement. Base pay may also be not applicable with a written explanation.

Each item has a provision type, payment frequency, amount or estimated value and entitlement terms:

- Cash is compensation paid to the employee.
- Provided records a noncash benefit and its estimated value; terms describe the benefit.
- Reimbursement records a ceiling and the conditions for claiming. It does not create a paid expense.
- Not applicable records zero and excludes the item from totals.

Available frequencies are monthly, annual, one-time, hourly, daily, per event and on request. Base cash supports monthly, hourly, daily and per-event pay. On-request amounts use reimbursement. Frequency totals keep annual flight allowances and one-time payments separate from monthly cash; provided values and reimbursement ceilings are not added to salary.

Use ticket terms for routes, dependent coverage, frequency and eligibility. Vehicle terms can identify supplied vehicle, fuel and maintenance coverage. No company entitlement is assumed or seeded automatically.

## Revisions and access

Saving creates an immutable dated revision with a reason. The effective package is the latest effective date on or before the requested date, then the latest revision for that date. Prior records remain available. Concurrent edits require reloading the latest package version.

Admin, Super Admin, HR Director and HR roles can edit within employee access. Detailed reads are limited to the employee and authorized HR/payroll/finance users with payroll scope. Team-lead and executive overview permissions alone do not expose detailed packages. Onboarding owners without detailed compensation access can see that the requirement exists without receiving salary amounts.

## Publish to payroll

Saving a package does not change payroll rules. An Admin or Super Admin can select Review payroll mapping, inspect the dated replacement and publish it explicitly. Monthly base cash or hourly base cash can be mapped to the existing payroll engine. Only monthly cash allowances are copied. Existing deductions are retained and shown for review. The administrator selects an independent approver, cycle/payment days, regular daily minutes, overtime multiplier and (for monthly salaries) overtime hourly rate.

Daily and per-event base rates remain in the package and are not automatically mapped to the salary/hourly engine. Annual cash, one-time cash, reimbursements and provided benefits are not silently prorated into monthly payroll. Published package links are recorded. A later change requires a new package revision. Existing saved payroll records keep their amounts; eligible drafts must be regenerated explicitly to use revised rules.

## Deployment

Apply migration `0040_employee_compensation.sql` through the normal deployment migration process. The implementation uses existing application/database dependencies and provisions no paid service. No production data has been inserted by implementation. Functional payroll and onboarding tests remain part of the combined release verification.
