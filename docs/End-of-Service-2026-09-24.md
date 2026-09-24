# End of Service — 24 September 2026

Adds `/end-of-service` under People and `/settings/separation` under HR Rules & Settings → Time & pay. HR can also open Rules & templates inside End of Service.

## Workflow

- HR/admin prepares a termination, resignation, contract-expiry or mutual-agreement case.
- Drafts calculate on the server from the selected employee, compensation effective on the leaving date and reviewed service history. Saving or submitting a draft does not change employment or access.
- Submission freezes the calculation inputs and policy version for independent review. The employee, creator and current preparer cannot approve. A configurable director-only reviewer rule is supported.
- Changed employment, service or compensation sources require a return to draft and recalculation before approval.
- Approval freezes the content; employees can view their own approved records. Cancelling retains the record and does not reverse employment termination. A corrected approved case requires a new case.
- Completion is explicit and unavailable before the leaving date. It checks equipment clearance and existing offboarding checklists, closes service history, records the lifecycle event, revokes the account and sessions, and respects existing scheduled-work and last-administrator safeguards. A checklist that already terminated the employee on the same date can be followed by settlement completion if the calculation still agrees.
- No email, signature, payment, payroll entry or leave-ledger posting is performed. HR must reconcile outstanding amounts against payroll and leave records and arrange actual payment separately. Account revocation means HR should download employee copies before completing the separation.

## Calculation methods

Configurable gratuity days per year, minimum service years, monthly wage divisor and year fraction method (`anniversary` or actual days / 365). The last employment day counts as service. The latest continuous qualifying service group comes from Employment history; its existing continuity gap and bridged-day policy is displayed by version, not silently replaced by this feature. Gaps excluded by that policy proportionally reduce service years. Pending service corrections and inconsistent service/leaving dates block calculation.

Default gratuity: last monthly basic wage / 30 × 21 days × qualifying years, with a one-year minimum. Non-monthly basic pay requires an explained equivalent monthly wage. A reviewed manual gratuity and itemized additions/deductions support case-specific arrangements. No separation type automatically forfeits gratuity.

Default ordinary notice: one calendar month before 24 service months; two calendar months at/after that threshold. Calendar-month addition clamps month-end dates; it does not substitute 30/60 days. Notice is measured from the written notice date to the last employment date. Employee-record notice days take priority; custom days and non-applicable notice require an explanation. The notice compensation conversion uses the saved monthly divisor. HR explicitly chooses employer payment, employee recovery or a documented waiver.

The itemized settlement contains gratuity, reconciled unpaid salary, unused leave (half days supported), unserved-notice compensation and named adjustments. Money lines round to the nearest cent; deductions exceeding earnings remain visible as a net recovery rather than being hidden at zero.

These are configurable application assumptions, not a compliance certification. Probation, exceptional dismissal, retirement arrangements, continuity after rehire and special legal circumstances require an applicable reviewed rule/exception. The application does not decide these circumstances for HR.

Official references consulted:

- Qatar Labour Law Article 54: at least one completed service year, minimum three weeks per year, proportional fractions and last basic wage. [Al Meezan, Article 54](https://www.almeezan.qa/LawArticles.aspx?LawArticleID=51848&LawId=3961&language=en).
- Notice follows the amended Arabic Article 49, not the outdated English 2004 wording: [Al Meezan, 2020 amendment](https://www.almeezan.qa/LawArticles.aspx?LawArticleID=80827&LawId=8427&language=ar).
- Service certificates and returned documents are covered by Article 53. [Al Meezan, individual employment relationship](https://almeezan.qa/LawArticles.aspx?LawTreeSectionID=12642&language=ar&lawId=3961).

## Documents

Editable reusable English/Arabic templates for separation/notice letters, service certificates and end-of-service statements. Each case stores a separate copy. Required Arabic identity/reason fields and supported placeholders are checked before review. Service certificates include the recorded cash remuneration and pay frequencies. Financial inputs and reconciliation notes remain part of the settlement snapshot.

Downloads are escaped, private HTML with A4 print styling and browser Print / Save PDF support, not direct signed PDF files. Draft/cancelled copies are visibly unissued. Future-dated completed-service certificates are unavailable until the leaving date. Approval identity/time and a document-content fingerprint are included. No employee signature or payment receipt is implied.

## Storage and access

Migration `0051_end_of_service` adds versioned separation policies and employee separation cases, with one open case per employee and database guards for immutable identity, approved content, closed records and transitions. Updates use row locks and optimistic versions; submissions use idempotency keys. Read scope is applied before pagination and counts. HR writers use employee-database update scope; other accounts only see their own reviewed cases. History remains available to HR. No live records were changed in this task.

## Validation and release state

TypeScript compilation and client/server production builds completed. The isolated local preview loaded the migration, displayed the new workspace, calculated and saved a clearly labelled DEMO draft, and rendered its bilingual printable settlement. No real separation was approved, no employee access was revoked and no payment was made. Automated tests and audits were skipped under the user's standing instruction; approval/completion transitions have not been exercised end to end.

Saved locally, not published or deployed. Deployment must apply migrations 0049–0051 along with the preceding local security and bilingual-contract changes.
