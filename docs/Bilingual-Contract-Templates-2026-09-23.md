# English–Arabic contracts and reusable templates

Implemented locally on top of the contract builder and security hardening. Not deployed.

## What changes

- New employee contracts use paired English and Arabic titles, appointment details, working arrangements, compensation and clauses. Arabic employee/company names and company address are editable; canonical English company and employee details remain captured from the existing records.
- Arabic editor inputs and reading/print sections use `lang="ar"`, right-to-left direction and right alignment. Wide layouts pair the languages; narrow layouts stack each English section with its Arabic counterpart. The printable layout keeps both languages in the same document.
- Drafts can be saved while incomplete. Sending requires both languages for required content, paired optional department/location values, a start date, complete clauses and no unresolved placeholders. The same checks run on the server. HR approves both versions before sending.
- Both language texts are included in the stored document fingerprint. New bilingual signature evidence includes English and Arabic consent wording. Existing sent/signed records retain their original document, consent and fingerprint; the migration does not rewrite them.
- Contract templates can be created, edited, duplicated and archived by HR/administrators. Each template contains the full editable content, bilingual clauses and optional common company/appointment text. No salary, hours, dates or employee identity is imposed by the starter templates.
- Three editable starter templates: Head office employment, FEC / mall operations, Event assignment. Templates and clauses are database content, not fixed runtime rules.
- Templates appear in Contracts → Templates and Settings → Records → Contract templates. The separate bilingual clause library remains available in Contracts and Settings.
- Using a template copies its content into the employee draft. The source template ID/version is recorded. Template edits never change saved contracts. A stale or archived template is rejected when creating a new contract.
- Supported reusable fields: `{{employee_name}}`, `{{position}}`, `{{department}}`, `{{location}}` and their `_ar` equivalents. Missing values remain visible as placeholders. They are resolved from the current draft/profile in the preview and when saving. Unknown placeholders block sending.
- HTML downloads and Print / Save PDF include the paired content. No machine translation or external translation API is used, and no certificate-based digital signature is claimed.

## Data changes

Migration `0050_bilingual_contract_templates.sql` adds Arabic fields to clause records, a versioned template table, source-template metadata on employee contracts and a database trigger protecting that metadata after sending. It translates only unchanged seeded library clauses, leaving custom clauses for HR to translate. Template updates are recorded in the existing workflow history.

## Validation and limits

TypeScript and production client/server compilation passed. The local preview initialized a fresh isolated database with all migrations including 0050. Automated tests and audits remain unrun under the user's earlier instruction. No production migration, contract issuance or employee signing was performed.

Manual local preview: duplicated and saved a clearly labelled DEMO template, used it for a synthetic employee, completed Arabic identity/appointment fields, viewed resolved placeholders, saved the bilingual draft and opened its printable copy. Both English and Arabic content were present in the saved copy. Dates in Arabic sections are isolated left-to-right to preserve their order.

The templates are editable starting points; the user/HR supplies and approves the actual employee-specific wording in both languages. Completing fields is not a semantic translation-equivalence check.
