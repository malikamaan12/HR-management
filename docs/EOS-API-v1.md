# EOS API v1 — implemented local subset

Base path: `/api/eos/v1`. This implementation is local and not deployed. `EOS-HR-API-Draft.json` remains the broader, unimplemented proposal. EOS itself is still an external dependency.

Administrators create a credential under Service operations → EOS service credentials. Each key is bound to exactly one existing workforce team and expires within 365 days. A secret is displayed once; only its SHA-256 hash is stored. Send `Authorization: Bearer <secret>` over HTTPS. Revocation, expiry, or removal of the creator's active administrator access disables it. Keys cannot access normal HR session APIs. The API limits traffic to 120 requests per minute per source IP.

| Method and path | Request | Response |
| --- | --- | --- |
| GET `/assignments?after=0` | Non-negative assignment ID cursor | `items` (up to 100) with assignmentId, employeeId, shiftId, status, startAt, endAt, role; `nextCursor` is null at the last page |
| GET `/changes?after=0` | Non-negative event cursor | `items` (up to 100) with id, createdAt and payload; `nextCursor` remains unchanged when empty |
| POST `/activations` | JSON `{ "externalId": "EOS-A001", "label": "Mall activation" }`; `Idempotency-Key` header of 16–128 characters | HTTP 201 with id, teamId, externalId, label |

The credential determines the team. There is no caller-supplied team override, employee search, personal identity data, salary, attendance notes or unrestricted resource lookup. Returned employee IDs are HR identifiers; EOS must preserve their mapping instead of inventing identity records.

Assignment snapshots are current reads, not a transactionally frozen export. Bootstrap from the change feed at cursor 0, applying each event by assignmentId; initial migration events capture preexisting assignments. Poll again with the last returned event cursor, persisting it only after applying the whole response. Treat repeated events idempotently. Event inserts commit with assignment changes, and assignment event writers serialize until commit to prevent advancing a cursor past an uncommitted earlier event. The payload contains assignmentId, shiftId, employeeId and status. It does not currently report standalone edits to shift metadata; periodically refresh assignment snapshots if EOS needs current times and role names.

Activation registration creates an external reference for the credential's team. It does not create a shift, employee, event budget or new permission. An identical request with the same key and Idempotency-Key replays the saved response; different content returns 409. External IDs are unique per team; reuse with different labels also returns 409. Idempotency records are retained without automatic expiry. Do not include personal information in activation labels.

Errors: 400 invalid input, 401 invalid/expired/revoked credential, 409 idempotency or mapping conflict, 429 rate limit, 500 transient server failure. Retry transient failures with the same idempotency key; never automatically retry a changed payload under the old key.

Not implemented: EOS-owned activation creation semantics, inbound shift/employee writes, event time mapping, signed outbound webhooks, delivery retries, callback destinations, payroll export, deletion/retention jobs or EOS acceptance testing. There is no webhook destination configured and no external EOS data transfer occurred during development.
