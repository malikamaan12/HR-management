# Document renewal and replacement

Open Document Management, view a document, and choose **Renew or replace**. This action is shown only when the current user has update access to that employee's compliance documents. Existing self, department and organization scopes remain unchanged; this feature does not grant new role permissions.

## Workflow

- Enter the renewed or corrected document number, issue/expiry dates, issuing authority, notes and a reason of at least five characters. Attach a new PDF, PNG or JPEG of up to 10 MB. File content is validated on the server.
- The employee and document type cannot change through replacement. A different document type should be uploaded separately.
- Saving updates the current document and adds a version containing its complete metadata, private object reference, recorder, recording time and reason. Earlier objects are retained, rather than overwritten or deleted.
- The Versions tab displays the original and subsequent versions. Each historical download checks current read permissions and generates an expiring storage link. Legacy external file references remain unavailable through the private download service; renewal preserves their metadata without importing external files.
- If another save wins first, the stale request returns HTTP 409. Cancel the replacement, refresh/reopen the document, and review the new current version before retrying. A failed history write rolls back the current document update. New objects from failed/conflicting attempts are cleaned up; earlier and winning files are retained.
- For documents without pre-existing history, the first replacement preserves the legacy record as version 1 and writes the replacement as version 2. The recorded-by account is the account preserving the legacy record, not a claimed original uploader.

Direct updates remain available under existing permissions. An optional request/review workflow is now implemented below; approval is not mandatory for all document changes. Email expiry notifications, named reviewer assignment, retention/purge policies and recovery from failed object cleanup remain follow-up work. Every retained file consumes storage under the existing Free-plan quota. No paid storage is added.

## API

| Route | Behavior |
| --- | --- |
| `GET /api/documents/:id` | Returns current metadata, `currentVersion` and `canReplace` after scoped read authorization |
| `POST /api/documents/:id/replace` | Multipart `document` file plus `documentNumber`, `issueDate`, `expiryDate`, optional `issueAuthority`/`notes`, `reason` and required `expectedVersion` |
| `GET /api/documents/:id/versions` | Existing scoped version list; new snapshots include `changeReason` |
| `GET /api/documents/:id/versions/:version/download` | Scoped historical file download, with `Cache-Control: no-store` |

Use the exact current version loaded by GET, including zero for a legacy document without snapshots. The current document row is locked while the version check, update and history insert execute atomically. Authorization and version are checked again after object upload. Direct replacement uses the existing version table. The request workflow requires migration 0014_document_renewal_requests.

## Validation

Automated tests cover current and old object selection, permission denial, protected fields, invalid/missing input, oversized uploads, stale requests before upload, conflicts after upload, losing-object cleanup, history rollback and legacy snapshot preservation. Existing storage-service tests cover private signed links and content validation.

An isolated browser test used synthetic employee records and in-memory object storage to upload an original PDF fixture, renew its number/expiry, and verify both entries and download links in the Versions tab. The walkthrough did not upload production HR documents or re-test the external storage provider. TypeScript and frontend/server production builds pass; the existing frontend-bundle warning remains.

## Renewal requests and review

From document details, choose **Request renewal approval**, enter the proposed metadata, reason and file, and submit. The current document and expiry stay unchanged. The Documents page lists requests visible to the requester and scoped document editors. It paginates in batches of 50.

A reviewer with existing document update access outside self-only scope can approve or reject with a reason. Neither the requester nor the linked document owner can decide their own request, including administrators. Department restrictions still apply. The requester can withdraw a pending request with a reason. Final decisions cannot be edited or repeated; submit a fresh request after rejection or withdrawal.

Only one pending request per document is allowed. Approval locks the document and request, checks the submitted document version, updates the current document and appends its snapshot in the same transaction as the decision. A direct replacement after submission makes approval stale: reject or withdraw and submit again. A failed approval preserves the pending proposal for retry. Rejected and withdrawn files remain private and retained; there is no purge job.

| Route | Behavior |
| --- | --- |
| `GET /api/documents/renewal-requests?offset=0` | Scoped request history with `items`, `hasMore`, `canReview` and `canWithdraw` |
| `POST /api/documents/:id/renewal-requests` | Same multipart fields as replacement; uploads a proposal without updating the current document |
| `GET /api/documents/renewal-requests/:requestId/download` | Private proposed-file download for the requester or scoped reviewers |
| `POST /api/documents/renewal-requests/:requestId/decision` | JSON `decision` (`approved`, `rejected`, `withdrawn`) and required `reason` |

The request records its submitter/time, immutable proposed metadata, decision author/time and reason. Approved version snapshots link back to the request. Automated tests cover unchanged current records before approval, independent reviewers, department boundaries, private downloads, duplicates/cleanup, withdrawal, stale approval, rejection and transactional rollback. The complete suite has 135 passing tests; migration 0014 applies and safely reruns through the journal. The isolated browser walkthrough verified review, approval, current metadata refresh and the decision reason. No production employee or document data was changed for verification.