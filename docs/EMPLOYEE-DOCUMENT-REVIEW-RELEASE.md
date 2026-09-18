# Employee and document review release — 18 September 2026

Built on live main 1f67153, following deployed application revision d64f3c2. This release reconciles selected earlier enhancement workflows without replacing the live migration history.

## Delivered

- Reviewed employee CSV imports: owner-private drafts, field guide/template, record correction or exclusion, paginated results, validation-only CSV downloads, versioned history and cancellation. Upload creates no employee or login account. Final import revalidates under the employee hierarchy lock and commits all included valid records together. Duplicate uploads/commit retries are idempotent; manager links can reference existing active employees or valid included records. Permanent, temporary and contract types, event eligibility and office/shift schedules are supported. Technical limits remain 500 rows / 2 MB UTF-8 CSV.
- Employee correction requests: linked employees request changes to mobile, personal email, address or emergency details. Independent authorized HR approves or rejects; requesters may withdraw. Private previous/proposed values, reasons and decisions remain available to the subject and authorized HR. Newer employee versions block stale approvals. HR has a pending queue in Employee Database; employees have a dashboard link to their own record.
- Document register: scoped server pagination/search/type/status counts, Qatar-date expiry evaluation and the existing administrator warning window. Employee-profile document statuses now use the same current calculation.
- Administrator document replacement rules: optional approval, required employee self-service approval, or approval for all replacements; configurable types, named-reviewer requirement and calendar-day review target. Defaults preserve existing behavior. Policy versions and reasons are retained. New requests pin their policy and deadline; changing the current policy does not rewrite pending requests.
- Renewal ownership: scoped eligible reviewer search, assignment/reassignment, version conflicts, pending/assigned/overdue queues, independent decisions and safe request history. Assignment grants decision ownership without expanding access. Approved replacements keep earlier versions and file permissions. Initial uploads continue under existing upload permissions.
- New renewal submission timestamps match their audit times even with a non-UTC database session.

## Compatibility and data

Additive migration 0027_employee_document_review adds the review tables and fields. Existing import totals and document requests/files are retained. Legacy imports can be read, but cannot execute as reviewed drafts. A legacy upload client must now supply a submissionKey and use the review/commit API; the old automatic write route is removed. Old renewal clients can decide an unchanged version-1 request; reassignment or later versions require the explicit current version.

Earlier enhancement branch migrations are not merged. Onboarding review/versioned templates, equipment/handbook, broader transfers/incidents and employment continuity still need separate reconciliation. Retention/deletion policy, real storage delivery acceptance, Resend sender setup and EOS integration remain outstanding; WhatsApp stays deferred. No production HR records or policy values are changed during acceptance testing.

## Verification

The combined suite passed **253 tests across 19 files**, including previous-live upgrades through migrations 0025 and 0026, empty migration and safe rerun, legacy record retention, import races/rollback, employee correction independence/stale writes, document policy enforcement, assignment scope and audit rollback. TypeScript and client/server production builds passed. Browser acceptance then found a renewal timestamp discrepancy; the final fix passed all **11 document-governance tests**, including a new non-UTC timestamp case, and the server was rebuilt. This represents 254 distinct tests covered; the entire suite was not repeated after that focused fix.

The isolated browser used synthetic data and in-memory files. It verified: invalid CSV staging without employee creation, inline correction and atomic two-person import; employee correction submission followed by independent HR approval and refreshed profile; administrator policy publication, enforced renewal submission, eligible reviewer assignment and approval. Actual production file transport was not exercised by that preview. Main client bundle: 626.93 KB minified / 179.58 KB gzip; the existing size warning remains.

## Deployment

Live on the existing Render Free service srv-dajuem0jo6nc73fb36r0 and Supabase Free. No hosting, paid resource or environment changes were made.

- Application revision: `1d0013344a636aecc31ce32b640b79d4399405aa`, pushed to `malikamaan12/HR-management` main.
- Manual Render deployment [dep-dammk3ou01pc73ardpp0](https://dashboard.render.com/web/srv-dajuem0jo6nc73fb36r0/deploys/dep-dammk3ou01pc73ardpp0) succeeded on 18 September 2026 at 19:44 Qatar time. Startup confirmed `Database migrations completed` before serving.
- `/healthz`, `/readyz` and `/` returned HTTP 200. The public page serves the expected client entry `/assets/index-CaiyRRKf.js`.
- Authenticated production checks confirmed the reviewed CSV draft screen/private jobs list, document register, persisted approval policy, renewal review queue and employee correction inbox. The existing optional-approval policy remained at version 0. No production HR records, files or policy values were created or changed during these read-only checks.
- End-to-end writes were verified in the isolated synthetic preview described above; real production file delivery remains an acceptance task.
