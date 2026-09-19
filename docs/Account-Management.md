# Employee account management

Administrators can review unlinked employees in User Management, then create and link their accounts in one transaction. Work email is the username. Permanent employees receive permanent_employee, contract employees receive employee, and temporary staff receive temporary_staff. Titles do not grant privileged roles.

Every provisioned account requires an individual one-time password setup link. The server stores only its hash; it expires after one hour. No email is sent automatically. Links appear only in the current page session and can be downloaded for private distribution. Generate a fresh link from Manage if a link expires or is lost. Never commit exported links or copy them into shared logs.

Manage provides username, email, role and department editing; freeze, hold, revoke and restore access; password reset/setup links; sign-out of all sessions; failed-login unlock; approval; and permanent account-access deletion. Deletion preserves the linked HR record and history and cannot be reversed. Suspensions can be restored but old sessions and reset links remain invalid.

Writes check current administrator authority, protect self and super-admin accounts, reject stale editor versions, revoke sessions and record an audit event atomically. The older approval and role routes enforce the same protections. Employee termination marks linked account access revoked. Operational readiness excludes accounts whose password setup remains pending.

Deployment applies additive migration 0045_account_management: three users columns and a status constraint. Previously approved inactive accounts become on-hold; existing active logins remain active. Roll forward with these columns retained if reverting application code; do not remove HR records or accounts to roll back the feature.

Validation: TypeScript and production UI/server builds pass. Twelve new integration tests cover 21-person provisioning, one-use password setup, duplicate/retry protection, stale changes, authorization, all suspension states, retained HR records, audit rollback, and concurrent administrator protection. Existing auth and employee-record suites pass; the readiness suite passes after updating its message to distinguish sign-in setup. Local browser verification confirms the freeze action, account history, and editor layout.
