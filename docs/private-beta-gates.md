# RegPilot production readiness gates

## Current
- Modern workspace builds in Vercel preview.
- Action registers and document panels are demonstration workflows.
- Evidence API deliberately returns HTTP 503 until a secure backend is connected.

## Must pass before private beta
1. Authenticate users with a supported identity provider.
2. Authorise each API request against organisation membership and role.
3. Use a managed PostgreSQL database and tested Prisma migrations.
4. Store documents in a private bucket; verify short-lived signed downloads.
5. Scan uploads for malware and verify content type and size server-side.
6. Enforce organisation ownership on evidence and action relations.
7. Audit every evidence access, upload, approval and rejection.
8. Run negative access tests using two separate organisations.
9. Add rate limits, backups, retention and incident handling.
10. Validate legal rule sources, applicability and versioning before customer use.

## Test workflow
- Create two synthetic organisations.
- Confirm one cannot list or download the other's records.
- Upload a harmless synthetic PDF to the test bucket.
- Link it to two actions in one organisation.
- Request independent approval, then verify the audit record.
- Simulate expiry and confirm one renewal task is created.
- Confirm the production build, then review preview UI on mobile.

No real regulated or personal data should be used during this stage.
