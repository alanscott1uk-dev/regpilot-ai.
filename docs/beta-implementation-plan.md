# RegPilot private beta implementation — deployment checklist

## Gate 1: Build
- [ ] Both Vercel previews report success for the current branch head.
- [ ] Run npm test and prisma validate.
- [ ] Confirm /workspace and /company-scan load on mobile.

## Gate 2: Identity and tenancy
- [ ] Choose and configure an authentication provider.
- [ ] Create users and organisations with server-verified membership.
- [ ] Scope all database queries by organisation ID and verified session.
- [ ] Deny anonymous writes and cross-organisation reads.
- [ ] Validate OWNER, ADMIN, EDITOR and VIEWER permissions.

## Gate 3: Durable actions
- [ ] Replace browser demo records with PostgreSQL-backed module records.
- [ ] Create/update actions with audit events in one transaction.
- [ ] Link module records to obligations without losing department ownership.
- [ ] Test concurrent edits and deletion restrictions.

## Gate 4: Document evidence
- [ ] Apply reviewed Prisma migrations to a staging database.
- [ ] Add private storage with server-authorised signed URLs.
- [ ] Validate file content and malware-scan uploads.
- [ ] Add review and approval endpoints with independent reviewer checks.
- [ ] Confirm evidence expiry creates deduplicated renewal tasks.

## Gate 5: Regulated beta
- [ ] Review official regulatory rule sources and effective dates.
- [ ] Confirm monitoring job authentication and rate limiting.
- [ ] Test backups, restoration and incident response.
- [ ] Conduct two-organisation isolation tests.
- [ ] Permit only synthetic data until security review passes.

Current /workspace remains a demo; no live evidence upload or authenticated organisation data is enabled.
