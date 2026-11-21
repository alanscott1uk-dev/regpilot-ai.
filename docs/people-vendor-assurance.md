# People, policies and vendor assurance

This batch extends the existing private workspace at /team/people and /team/vendors. It does not activate external providers, publish a deployment or apply a live migration. Fixtures use invented data only.

## Policy lifecycle

An administrator prepares a policy using independently approved Evidence Vault content. A different administrator, who is not its document uploader, publishes the exact version to named current members. Publication checks the stored bytes and rechecks current membership, source review and policy version after retrieval. Each person must download their own current assignment before explicitly acknowledging understanding. Acknowledgements preserve the file manifest hash, revision and time.

A replacement version supersedes pending assignments, retains earlier acknowledgements and requires fresh reading. Withdrawal prevents further acknowledgements. Team removal revokes pending assignments; rejoining does not silently restore them. Historical assignment reads are scoped by organisation and policy version. An acknowledgement is a recorded statement, not proof of competence or a training certificate.

Pilot limits: 100 policies per organisation, 50 revisions per policy, 100 readers per version. These are explicit total limits; archived history is included. Evidence selectors show the latest 200 approved files.

## Supplier lifecycle

An administrator records the actual service, information handled, system access, impact, owner and review date. Six internal review areas cover service scope, security, information handling, access, continuity and incident communication. Required areas depend on the recorded service scope. Every supported finding cites selected reviewed evidence; gaps cannot produce an APPROVE recommendation. These generic checks do not constitute validated framework mappings or legal advice.

A different administrator signs off an evidence-bound APPROVE, CONDITIONAL or REJECT decision. Stored bytes and current tenant permissions, evidence versions, vendor snapshot, dates and the previous accepted review are checked again immediately before acceptance. Concurrent or superseded drafts cannot overwrite a newer accepted baseline.

Accepted gaps produce owned tasks in the existing team work queue. REJECT also creates an explicit next-steps task; it does not terminate any contract. Completing a task, including by exception, never changes the recorded supplier decision. Scope changes, ownership changes and evidence changes make previous reviews stale. Expired reviews remain visible as expired. Team removal requires handover for active suppliers and open tasks. Archiving preserves outstanding work and history.

Pilot limits: 200 suppliers per organisation, 50 reviews per supplier, 10 files per review. This batch does not provide automatic vendor monitoring, supplier-facing questionnaires or access recertification.

## Security and migration

Apply prisma/changes/people-vendor-assurance.sql only after auditor-workspace.sql, using the operator's reviewed direct administrator process. It creates Policy, PolicyRevision, PolicyAssignment, Vendor and VendorReview, with organisation composite foreign keys, enables RLS and revokes Data API role privileges in the same transaction. The full private-table check now covers 40 tables. No browser receives direct database access.

All new routes use verified workspace authentication before reading request bodies. Policy inbox routes return only the authenticated member's assignments. Supplier management and policy administration require current OWNER or ADMIN membership. Audit events record lifecycle transitions. Private downloads use attachment delivery, no-store, nosniff and sandbox headers.

Verification uses domain tests, fail-closed HTTP handlers, PostgreSQL lifecycle/race tests, migration drift checks, a production build and gated page smoke checks. These checks do not establish live provider operation or browser usability acceptance. A separate fictional-data browser pilot and reviewed migration are required before release.
