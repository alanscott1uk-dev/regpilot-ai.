# Secure auditor workspace

Administrators prepare a deliberate external disclosure at `/team/audits`. Named reviewers use `/auditor`, with verified Supabase identity and the existing private-pilot allowlist. Acceptance does **not** create a `Membership` or grant workspace API access. Existing Next.js, Prisma, Supabase Auth and private storage architecture is retained.

## Complete workflow

1. Create a task, upload fictional evidence and obtain an independent owner/admin review. Only clean, independently approved files are eligible. Alternatively, define an audit period and prepare an empty draft, then use control-linked requests to collect evidence.
2. Choose up to 50 files, a room title, a clear purpose, an audit period and expiry within 90 days. Preparing a draft freezes file metadata and related task titles. Later uploads never join the share automatically.
3. Preview the exact disclosure. Publish requires the current room version, manifest fingerprint and explicit disclosure acknowledgement. Changed evidence prevents publication. The owner must check document contents, names and task titles for disclosure suitability.
4. Create up to ten email-bound guest invitations. A seven-day invitation acceptance deadline is capped by room expiry. Share the ordinary `/auditor` address manually; there are no bearer-token links or automatic invitation emails. The guest must already be an approved, verified pilot Auth account. Add `/auditor` and `/team/audits` to the approved Auth redirect list when activating staging.
5. Once accepted, the reviewer can see the fixed manifest and download selected current files until room expiry or revocation. They can ask general or file-specific questions. Administrators answer, the reviewer resolves, and the reviewer can reopen. Previous responses are retained and visible in that question's history; other guests cannot see these conversations.
6. Revoke one guest or close the whole room. Closed rooms cannot reopen. Removing/demoting the original administrator closes their rooms and revokes their guests atomically, so later re-promotion does not restore disclosure.

## Scope and security

- Disclosed: room title/purpose, selected file names and bytes, related task titles/IDs, file IDs, MIME types, byte counts, SHA-256 hashes, approval dates and review versions; the guest's own questions and company answers.
- Withheld: task notes, staff email addresses, uploader/reviewer IDs, reviewer notes, bucket/object keys, other files, other guests, organisation-wide activity and membership.
- A SHA-256 manifest fingerprint detects unexpected snapshot modification. It is an application integrity check, not a third-party notarisation or digital signature.
- Downloads use authenticated server responses, not signed object URLs. Current invitation, bound provider identity, current pilot eligibility, room status/expiry, issuer authority and evidence version/scan/review/hash are rechecked after asynchronous storage retrieval. Stored byte length and hash must match. Storage keys remain server-only.
- Access, downloads, disclosure changes and question transitions are audited. Owner view returns the latest 50 room events. Downloads already returned cannot be recalled or erased by revocation.
- Organisation advisory locking, serializable retries and expected versions protect competing acceptance, publication, responses and revocation. Composite foreign keys prevent cross-organisation grants and cross-room questions.
- Private API responses use `no-store`; file responses include attachment, no-sniff and sandbox headers. Input bodies and text fields are bounded. Limits: 40 rooms per organisation, 10 invitations per room, 100 questions per room, 20 questions per guest/day and 20 answers per question. Guest inbox shows the latest 100 eligible invitations. File selection shows the latest 200 approved files.
- Every new table uses the same default-deny Supabase Data API protection. No anonymous, authenticated or service-role grants are added; privileged server code still enforces application scope.

## Migration and verification

Apply `prisma/changes/auditor-workspace.sql` after `paid-services.sql` on a reviewed, backed-up database. It adds `AuditRoom`, `AuditGrant` and `AuditQuestion` and protects all 35 private tables in the same transaction. `fixtures/schema-63743ae.prisma` preserves the previous schema for diff review. No hosted migration is part of this development batch.

Tests cover explicit disclosure, unpublished/expired rooms, cross-tenant identifiers, verified-email collisions, acceptance races, no membership escalation, private question threads, retained replies, later uploads excluded, manifest/review changes, corrupt bytes, quarantine/revocation/expiry/issuer removal during downloads and composite foreign-key boundaries. HTTP tests cover activation gates, uncached errors, authentication before body parsing and rejection of forged guest identity. PostgreSQL tests use a disposable GitHub CI database; Auth, scanner and object storage use fictional injected fixtures.

The private-service switches and every paid integration remain disabled. This code does not buy services, activate subscriptions, send invitations, run paid calls or enable Vercel previews. It is not live customer operation, formal certification, qualified legal validation or demonstrated competitor parity. Signed-in desktop/mobile acceptance against actual Auth and Storage, retention/erasure, provider session revocation guarantees, penetration testing and production migration remain release work.


## Audit-period requests

See [Audit periods and wider coverage](audit-period-and-coverage.md) for the added owned-request workflow, submission history, independently accepted samples and JSON package index. The current UI requires an explicit period; legacy file-only manifests remain readable. Empty period drafts cannot publish. Request acceptance only changes the draft; external access still requires deliberate publication and a named invitation.

## Sync evidence into an audit firm's software

Enable `REGPILOT_AUDITOR_API_ENABLED` after applying `prisma/changes/auditor-sync.sql` to the intended environment. Existing invitations have no API key. In **Auditor workspace → Guest access**, an administrator can issue a key for a named reviewer who has accepted a published room. Transfer the one-time value through the firm's secure credential channel. Replacement immediately invalidates the previous key. The key expires after seven days or at room closure or expiry, whichever comes first. Revoking just the key preserves the reviewer's browser access.

The integration contract is available at `/api/v1/auditor/openapi`. Send the key in the HTTP Authorization bearer header. Each key reads a single room. A firm wanting to sync several clients needs a separate grant from each client.

| Request | Response |
| --- | --- |
| GET `/api/v1/auditor/package` | Selected evidence, live availability, accepted control request versions and period coverage. Store the ETag for the next sync. |
| GET the package with `If-None-Match` | HTTP 304 after RegPilot checks the grant, room, issuer and current evidence again. Withdrawn evidence changes the ETag. |
| GET a listed evidence download path | Verified file bytes with a SHA-256 Content-Digest. Compare this digest with the package entry before accepting the transfer. |

The firm should retire withdrawn entries from its active evidence set. HTTP 401 ends access to the room for that key. HTTP 409 requires a fresh review before relying on the selected evidence. HTTP 429 includes the retry interval. The limit is 60 requests per grant and 240 per client organisation per minute. Keys and download requests have no write access. The activity log records access and downloads without retaining bearer tokens.

Control versions and coverage describe the accepted request when the client published the room. A file-only room can have zero control requests. The firm receives no staff identifiers, review notes or internal storage addresses. RegPilot rechecks access and file approval after retrieving bytes. A firm that already downloaded a file holds its own copy.
