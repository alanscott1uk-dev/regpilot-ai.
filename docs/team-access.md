# Team access and independent review

This batch adds `/team/settings` and the organisation-scoped `/api/workspace/team` and verified-account `/api/workspace/invitations` APIs. It uses the existing Supabase Auth, Prisma and private-pilot allowlist. There are no new paid services, automatic emails or public registration.

## Workflow

1. An approved pilot owner creates an invitation for a colleague's verified email and role. An administrator can invite editors and viewers; only an owner can invite administrators.
2. The owner shares the ordinary `/team/settings` address. It contains no access token. The colleague signs in with their existing approved Supabase account and accepts or declines the invitation in their account.
3. Accepted membership makes the workspace available to existing document, task and independent-review flows. The original author's/uploading account still cannot approve its own work.
4. Owners/admins can revoke pending invitations, change permitted roles or remove members. Only an owner can transfer ownership, and the target must already be an administrator. Self-removal and editing another owner's role are prohibited.
5. Removal/read-only changes with outstanding assigned work require an active replacement in the same organisation. Open assigned tasks, active owned controls and the latest applicable decision for each accepted current requirement move atomically. Historical decisions and completed work keep their original attribution. Changed control/applicability versions invalidate dependent relationship contexts; handover does not approve compliance.
6. Removing or demoting an administrator pauses their configured source watches, recurring control schedules and evidence connectors. Stored connector credentials and active leases are cleared. A remaining administrator must deliberately reconfigure/re-enable them. Their outstanding invitations are revoked and do not become valid again after re-promotion.

## Protections

- Identity is resolved server-side with Supabase's verified-user endpoint. JSON bodies and user-editable metadata cannot select the recipient identity. A colliding local email with a different provider identity cannot claim an account.
- Invitations are email-bound, single-use and expire after seven days. Acceptance rechecks inviter authority, current allowlisting, expiry, version and membership capacity. It never silently replaces an existing member's role.
- Organisation advisory locks and serializable retries protect concurrent grants, acceptance, revocation and ownership changes. Member edits check the expected current role.
- Limits: 100 members, 50 live pending invitations, 20 new invitations per rolling 24 hours per organisation. Team history returns the latest 100 invitations and 30 access events; an account inbox returns at most 50 live invitations across organisations.
- Legacy task writes, AI review writes, uploads and file approvals now recheck current membership. Upload finalisation rechecks after scanning/storage and cleans up an object if access was lost. Downloads recheck after retrieval. A completed response cannot be recalled; access removal is not erasure of previously downloaded data.
- An additive `prisma/changes/team-access.sql` migration adds one private table, enabling RLS and revoking Data API grants in the same transaction. The private-table checks now cover 27 tables. No browser/service-role Data API grants are introduced.

## Verification and activation

CI applies the complete additive schema chain from the original fixture, checks drift/default-deny security and runs the PostgreSQL team workflow. Tests cover role escalation, foreign-tenant IDs, email collisions, concurrent acceptance, expiration/revocation, stale permissions, responsibility handover, preserved history, mid-upload removal and mid-review demotion. Provider identities, documents and object storage in tests are fictional fixtures; no real sign-in or paid AI is exercised.

Before activation: restore a working staging database connection, review/back up the existing schema, apply the reviewed migration chain, configure runtime database/auth values and the pilot allowlist, and add `/team/settings` to the allowed Supabase email redirects. Provision two distinct pilot Auth accounts through the established administration process. A workspace invitation does not itself provision a Supabase account or change the allowlist.

Then complete browser acceptance with two organisations and three distinct accounts: owner, preparer and independent reviewer. Verify invitations, acceptance, review separation, ownership transfer, handover, revoked access, paused automation and mobile use against the actual services. SSO/SCIM, email delivery, general customer onboarding and complete retention/erasure are not included.

On 7 November 2026 production configuration was still missing. Supabase metadata reported active, its health advisor reported hibernation, and database queries continued to time out. No hosted migration, private activation or additional Vercel deployment was performed for this batch. These blockers are not resolved by this code.
