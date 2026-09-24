# Security hardening and employee contracts

Status: implemented locally; not published or deployed. This change follows the UI release `7e51ce3`.

## Application hardening

- Common API write protection checks Origin and Fetch Metadata. Cookie-authenticated writes from other origins, including sibling subdomains, are rejected. Native bearer clients remain supported.
- Production security headers include Content Security Policy, HTTPS enforcement, frame protection, MIME sniffing protection, restricted browser capabilities and no-referrer. Approved private storage origins are included for document viewing.
- API responses are private/no-store. Unhandled server failures and legacy JSON 5xx responses return a generic message and request ID rather than database or stack details.
- Shared login throttling covers web and mobile login. Credential endpoints are throttled. API request limits, body size limits, request timeouts and authenticated multipart concurrency limits bound resource consumption.
- New and refreshed sessions store token hashes. Existing sessions retain compatibility and are converted on rotation; this change does not bulk revoke sessions or rewrite historical session rows. Refreshing no longer extends the original seven-day session lifetime.
- Unknown-login password comparison reduces account-discovery timing differences. Login failure text is generic. Expired login lockouts can recover normally.
- New passwords use a minimum of 12 characters and a bcrypt-safe maximum of 72 UTF-8 bytes. Existing passwords are not forcibly changed. Validation errors do not echo passwords or reset tokens.
- Legacy employee-resource scope checks normalize encoded paths, reject malformed IDs and cover event-staff profiles as well as employee documents, leave and shifts.

These changes are application safeguards, not a certification of cybersecurity. Dependency vulnerability assessment and automated security regressions are pending permission because the user previously asked not to run tests or audits. The attempted dependency audit was blocked by automatic approval review and was not run. MFA, infrastructure firewall/WAF settings, database network restrictions, secrets rotation, recovery verification and independent penetration testing were not completed in this task. Rate-limit counters are process-local; multiple instances require a shared counter store or edge enforcement.

## Contract workflow

- `/contracts` is available to signed-in users. HR and administrator roles manage drafts within their employee scope. Other employees can only access their own non-draft contracts. Signing is restricted to the exact recipient account and requires password confirmation.
- HR selects the employee and enters appointment dates, work location, working arrangements, compensation and individual allowances. These are contract content; sending does not change payroll or employment records.
- Clause library: create, edit, categorize and archive reusable clauses. Accessible from Contracts and HR Rules & Settings → Records → Contract clause library. Initial sample clauses are editable starting points, not a legal compliance template.
- Contract-specific terms can be edited, added, reordered or removed. Employee, role, department and location placeholders can be expanded from the selected profile. Saved contracts do not change when the library changes.
- Sending locks the exact document, records its SHA-256 fingerprint, and puts an in-app reminder in the employee inbox. HR cannot send their own contract for self-signing.
- Employee agreement records typed name, optional drawn signature, explicit consent, account identity, document fingerprint and server timestamp. Drawing inputs are bounded. Signing is throttled by IP and account. Passwords are never stored in contract evidence.
- Employees may request changes/decline. HR may withdraw an unsigned copy or create a separate revised draft. Original sent content and completed records are protected by database triggers. A revised draft does not automatically withdraw its predecessor.
- In-app notifications report sent, signed, declined and withdrawn copies. No external email/SMS is dispatched by this feature.
- Both parties can download an escaped HTML copy or open the print layout and use browser Print → Save as PDF. The copy includes recorded signature evidence. It is not a certificate-signed PDF.

Migration `0049_employee_contracts.sql` adds the clause and contract tables, indexes, constraints, sample clauses and immutable-record trigger. No production records have been created or signed for this feature.

## Validation

- TypeScript compilation: passed (`tsc --noEmit --incremental false`).
- Production client build: passed; existing large-entry-chunk warning remains.
- Production server bundle: passed.
- Local preview started successfully with fresh, isolated PGlite data and the new migration.
- Manual preview: HR selected a synthetic employee, added a library clause and a custom term, saved a clearly labelled DEMO draft, and opened its printable copy. Desktop and phone-width layouts were viewed. No contract was sent or signed.
- Automated tests and dependency audits: not run; awaiting the user's response about focused security checks.
- Live deployment and production migration: not run.

## Rollout

Before deployment, retain a recoverable database backup and apply the normal migration startup command. Keep APP_URL set to the exact public HTTPS origin, or use Render's supplied external URL. A custom domain must match this configured origin for browser writes. Read-only operations on an alternative origin may load, but writes will be denied.

Review the contract terms before issuing real agreements. Employees must sign their own copies from active linked accounts after completing password setup. Confirm notification, signing, immutability and access boundaries in the permitted validation environment before using this workflow for real contracts.

Reference guidance used during manual hardening: [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP HTTP headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html).
