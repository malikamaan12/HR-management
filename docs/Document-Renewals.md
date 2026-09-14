# Document renewal and replacement

Open Document Management, view a document, and choose **Renew or replace**. This action is shown only when the current user has update access to that employee's compliance documents. Existing self, department and organization scopes remain unchanged; this feature does not grant new role permissions.

## Workflow

- Enter the renewed or corrected document number, issue/expiry dates, issuing authority, notes and a reason of at least five characters. Attach a new PDF, PNG or JPEG of up to 10 MB. File content is validated on the server.
- The employee and document type cannot change through replacement. A different document type should be uploaded separately.
- Saving updates the current document and adds a version containing its complete metadata, private object reference, recorder, recording time and reason. Earlier objects are retained, rather than overwritten or deleted.
- The Versions tab displays the original and subsequent versions. Each historical download checks current read permissions and generates an expiring storage link. Legacy external file references remain unavailable through the private download service; renewal preserves their metadata without importing external files.
- If another save wins first, the stale request returns HTTP 409. Cancel the replacement, refresh/reopen the document, and review the new current version before retrying. A failed history write rolls back the current document update. New objects from failed/conflicting attempts are cleaned up; earlier and winning files are retained.
- For documents without pre-existing history, the first replacement preserves the legacy record as version 1 and writes the replacement as version 2. The recorded-by account is the account preserving the legacy record, not a claimed original uploader.

These are direct updates under existing permissions, not a new approval/request workflow. Email expiry notifications, renewal-request assignment/approval, retention/purge policies and recovery from failed object cleanup remain follow-up work. Every retained file consumes storage under the existing Free-plan quota. No paid storage is added.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/documents/:id` | Returns current metadata, `currentVersion` and `canReplace` after scoped read authorization |
| `POST /api/documents/:id/replace` | Multipart `document` file plus `documentNumber`, `issueDate`, `expiryDate`, optional `issueAuthority`/`notes`, `reason` and required `expectedVersion` |
| `GET /api/documents/:id/versions` | Existing scoped version list; new snapshots include `changeReason` |
| `GET /api/documents/:id/versions/:version/download` | Scoped historical file download, with `Cache-Control: no-store` |

Use the exact current version loaded by GET, including zero for a legacy document without snapshots. The current document row is locked while the version check, update and history insert execute atomically. Authorization and version are checked again after object upload. No migration beyond the already deployed journal through 0013 is needed.

## Validation

Automated tests cover current and old object selection, permission denial, protected fields, invalid/missing input, oversized uploads, stale requests before upload, conflicts after upload, losing-object cleanup, history rollback and legacy snapshot preservation. Existing storage-service tests cover private signed links and content validation.

An isolated browser test used synthetic employee records and in-memory object storage to upload an original PDF fixture, renew its number/expiry, and verify both entries and download links in the Versions tab. The walkthrough did not upload production HR documents or re-test the external storage provider. TypeScript and frontend/server production builds pass; the existing frontend-bundle warning remains.
