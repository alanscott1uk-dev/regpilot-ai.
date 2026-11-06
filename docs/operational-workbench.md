# RegPilot AI — operational workbench (Nov 2026)

This release makes **daily task triage** the default route \`/\`, with the existing obligation register retained at \`/register\`.

## Demonstration workflow

1. Open the workbench. It lists urgent actions, upcoming tasks, missing evidence and completion exceptions.
2. Select an action. A guided panel explains the next step based on stored task and document metadata.
3. Use **Add / link evidence** to open the document library with the action preselected.
4. Record the owner, due date, source URL and user-entered source review date.
5. Update the status. If there is no current approved supporting file recorded, a written exception reason is required to mark an action complete.
6. Export a CSV work report or a browser-local JSON backup. File attachments are NOT included in the workbench backup.

Templates are illustrative. No template claims to be an authoritative UK legal obligation.

## Boundaries: NOT production-ready

- Tasks are stored in browser localStorage and file attachments in IndexedDB.
- The demo has no account security, tenant separation, cloud backup or role-based approval.
- Evidence coverage uses document metadata, not actual file verification, quality review, malware scanning or authenticity checks.
- The "source reviewed on" field is entered by a user and is **not** regulatory source verification.
- Activity entries are editable browser data, not a tamper-evident audit log.
- No live regulatory feed or functioning AI analysis is connected.
- A recorded completion exception is not an approved legal or quality sign-off.
- Only synthetic, non-sensitive examples should be used.

## Engineering gates for real use

1. Account authentication and company membership, enforced by server-verified sessions.
2. PostgreSQL and tenant-scoped APIs with cross-tenant authorization tests; resilient backup and restore.
3. Private object storage with signed access, attachment scanning, hashing, retention controls and secure file retrieval.
4. Independent reviewer approval, controlled exception escalation, evidence integrity and trustworthy audit logs.
5. Source-linked verified regulatory ingestion, documented effective dates, deduplication and impact analysis.
6. AI-assisted document evaluation with traceable quotations, confidence/uncertainty and human review; no autonomous regulatory conclusions.
7. Accessibility, mobile usability tests, notification preferences, rate limits, monitoring and incident-response plan.

**Release policy:** do not put live employee, customer, supplier, patient or regulated records into the demo. The first production pilot should be gated on security testing and a clearly scoped compliance review.
