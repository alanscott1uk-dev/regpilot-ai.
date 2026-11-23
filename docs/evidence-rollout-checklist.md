# Evidence vault acceptance checklist

This SQL file is a migration **draft**, not an applied Prisma migration. Do not execute in production before schema alignment and backup.

## Data integrity
- [ ] Add matching Prisma fields and relations, then run `prisma validate`.
- [ ] Generate and review a formal Prisma migration.
- [ ] Verify every document-to-action link has the same organisation ID at database level.
- [ ] Test rejection of cross-organisation links and unknown evidence IDs.
- [ ] Preserve old evidence records and existing obligation references.
- [ ] Verify that migration is repeatable in a disposable database.

## Secure document service
- [ ] Implement authenticated organisation membership checks on each endpoint.
- [ ] Check roles for uploads, approvals, download and deletion.
- [ ] Use private object storage, short-lived URLs and malware scanning.
- [ ] Enforce file size, MIME validation and server-side checksum.
- [ ] Record uploader, reviewer, timestamp and version history.
- [ ] Retain auditable approval/rejection events and deletion policy.

## UX acceptance
- [ ] Action details show linked documents and review status.
- [ ] Library filters by category, expiry, owner and action.
- [ ] A single document can be linked to multiple actions.
- [ ] Missing/expired evidence does not automatically establish legal non-compliance.
- [ ] Expiry reminders are deduplicated and assigned to an owner.

## Deployment
- [ ] CI passes type-check, tests, build and migration verification.
- [ ] Two-organisation negative access tests pass.
- [ ] No real customer data is used in preview or localStorage.
- [ ] Production remains protected until a security review is complete.
