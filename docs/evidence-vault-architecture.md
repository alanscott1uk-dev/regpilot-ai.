# RegPilot evidence vault — implementation contract

An action may reference multiple documents, and one document may support multiple actions. The current Evidence model is a starting point, not a secure upload implementation.

## User workflow

1. Open an action and select Documents.
2. Choose an existing approved document or upload a new one.
3. Record category, expiry date, owner and review notes.
4. Mark evidence Pending Review; only an authorised reviewer may approve or reject it.
5. Keep an audit event for upload, linking, approval, rejection, replacement and deletion.
6. Flag expiring documents and create a renewal task without automatically declaring legal non-compliance.

## Required server controls

- Authenticate every request and verify organisation membership and role on the server.
- Enforce same-organisation ownership for action-document links in database constraints.
- Use private object storage and short-lived authorised download URLs.
- Validate file type, size, malware scan result and checksum before making evidence available.
- Keep version history; do not overwrite an approved file in place.
- Require reviewer identity and timestamp for approval.
- Never place actual document contents in browser localStorage.
- Add rate limits, retention rules, backups and access audit logs.

## Rollout gate

Do not expose real document upload to customers until authentication, storage, malware scanning, tenant isolation, and approval controls have been integration-tested. The workspace UI remains a demo until those checks pass.
