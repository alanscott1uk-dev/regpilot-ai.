# RegPilot AI — secure multi-tenant architecture plan

Status: design only. The Prisma schema is not yet connected to the UI.

## Identity and authorization

Use a trusted authentication provider. Verify every server session, map provider identity to User.externalId, and resolve organisation membership on the server. Every read and write must scope records to the verified organisation and enforce membership roles. Never trust organisationId, role, or actorId supplied by a browser. VIEWER cannot mutate. OWNER/ADMIN manage membership. Validate inputs at the API boundary.

## Tenant isolation

All obligation, evidence and audit queries must include the authorised organisation ID. Use PostgreSQL row-level security as defence in depth if feasible, with tests proving cross-tenant reads/writes fail. Evidence must belong to the same organisation as its obligation; enforce in transactional application logic and preferably composite foreign keys.

## Auditability

Create audit events in the same database transaction as each mutation. Record actor, organisation, action, entity and relevant change details without storing secrets. Current AuditEvent is an ordinary database table, **not** tamper-evident or immutable. A future append-only/hash-chain or external audit sink and retention policy are needed before compliance-grade claims.

## Evidence handling

Store files in private object storage, not the public web directory. Use short-lived signed URLs, MIME/content verification, malware scanning, size limits, SHA-256 integrity hashes and explicit retention/deletion rules. Avoid storing sensitive data in logs.

## AI guardrails

AI output is draft-only, includes source links and checked dates, and requires qualified human approval. No automatic regulatory conclusions. Maintain source provenance and version history.

## Deployment gate

Do not accept customer or patient data until authentication, tenant isolation, authorization tests, encryption, backups, recovery, monitoring, incident response, data protection assessment and legal review are completed.
