# HR Letter Centre — 19 September 2026

Status: deployed in application commit `eb3fb5c` on Render Free at 10:37:27 GMT+3 on 19 September 2026, together with service-readiness commit `73bd0be`. Build, migrations, health/readiness and authenticated administrator screens passed. See [the deployment record](HR-Letters-Deployment.md).

## What is included

The **HR Letter Centre** navigation item opens `/hr-letters`. Employees request letters for their linked record. HR prepares a letter from saved company, employment and, when needed, compensation records. Another authorized HR user reviews and issues it. Issued letters have a protected printable view; the browser can print or save that view as PDF. No paid service, new dependency, outbound email, external signature service or EOS call is used.

Administrators and super administrators maintain templates. The editor provides employment confirmation, compensation statement and general HR letter starting points. These are unsaved drafts for company review; installation does not publish templates or seed employee requests. Administrators choose the title, body, approval title and eligible permanent, temporary or contract employee types. Only supported `{{field_name}}` placeholders are accepted. Templates are plain text, with no executable expressions or raw HTML.

## Setup and workflow

1. Save actual company details in **Settings**, link employee accounts and complete the employee records. Salary letters also require an effective compensation package. Missing required values block preparation; the application does not substitute assumed salary or company information.
2. Open **HR Letter Centre → Templates → New template** as an administrator. Choose a starting point, edit the company wording, enter an action reason and save the draft. Reopen it to publish. Save edits before publishing.
3. The employee uses **My requests → Request letter**, selects a published template and enters the recipient and purpose. HR can submit for an employee within its existing employee-update scope. Employee and template pickers support search and pagination.
4. HR opens the request from **HR queue** and prepares it. The saved preview captures the template revision, company header, employment details, preparation date and any compensation figures. Read the exact preview before approving.
5. A different authorized HR user issues the letter with a reason and confirmation. The employee, requester and preparer cannot issue their own letter. Department HR remains limited to its existing department scope. At least two eligible HR users are needed when HR requests and prepares a letter for someone else.
6. An issued letter can be opened through **Print / save PDF**. The printed record identifies its reference and actual HR issuer. It does not create an electronic signature or external attestation, and it does not send the letter to the named recipient.

An independent reviewer can return a request for correction or reject it. The employee or original requester can correct a returned request, including selecting a replacement template, and resubmit it. They can also cancel an unissued request. Authorized HR can revoke an issued letter other than its own employee letter. Revocation disables further printing from the application; it cannot recall copies already downloaded or shared.

## Versions, access and compensation

- Published template wording is immutable. Create a new revision to change it. Archiving the latest revision retires the entire template family, including earlier revisions, so an older edition does not reappear in the catalogue. Existing issued copies retain their content; open requests using archived templates need a published replacement. A new revision of the latest archived template can be published later.
- Request actions require the current version and an action reason. Stale edits fail rather than overwrite someone else's work. State changes and history commit together. The detail screen shows up to the latest 50 history entries; the database retains the full history.
- Before issue, the server rechecks current employee, company, template and compensation source data against the prepared snapshot. Changed sources or a different preparation day require fresh preparation. Issued content is protected against later changes, including by database triggers.
- Letter records are available only to the linked employee or authorized HR within its employee scope. Team supervisors and finance do not gain access to other employees' letters from their roles alone. Draft template content is administrator-only. Responses and printable pages are uncached.
- Compensation comes from the effective dated package, with the existing compensation access checks. Base pay and allowances retain their recorded frequency. Annual tickets, one-time items and provided or reimbursed benefits are listed separately; they are not silently added to monthly cash. Per-event pay is labelled **per assigned event shift**. Monthly cash totals include monthly cash components only.

## Validation and release

- `npm run test -- tests/hr-letters.test.ts tests/migrations.test.ts`: **19 tests passed** (12 letter workflow tests and 7 migration tests). Coverage includes role/employee scope, publication, independent issue, request replay, stale data and versions, correction/cancellation, archival, revocation, compensation frequencies, HTML escaping, missing inputs, immutable records and atomic history. Migration checks cover fresh installation, repeat migration runs and upgrades retaining prior records.
- The template-placeholder case passed again after adding a generated-text size limit. This was a targeted rerun, not an additional full suite.
- TypeScript and the client/server production build passed. The existing approximately 633 kB main-client chunk warning remains.
- An isolated loopback preview using synthetic PGlite records verified navigation, draft creation, publication and the employee/published-template request selectors through the browser. The temporary tab and server were closed. Production data and configuration were not changed.
- Additive migration `0042_hr_letters.sql` is registered in the migration journal. It creates template/request tables, indexes and immutable-content protections. Render startup completed migrations in production at 10:37:01 GMT+3 on 19 September 2026; the deployed letter/template queries subsequently succeeded. Earlier migrations are unchanged.

Configure real company-approved templates and authorized HR reviewers before issuing letters. Actual employee import and the provider/backup acceptance work described in [Service-Readiness-Release.md](Service-Readiness-Release.md) remain separate setup tasks.
