# Development release verification

The current development branch contains authenticated workspace, regulatory monitoring, PDF assessment, programme import and connector integration code. Feature flags and environment readiness determine availability. Passing offline checks does not make these services operational.

## Required automated checks

- Unit, HTTP gate, parser, provider-adapter and grounding tests.
- Prisma validation and generation; full additive migration chain on disposable PostgreSQL 17; zero schema drift.
- Default-deny checks for all 48 private tables and PostgreSQL integration workflows, including tenant boundaries, independent reviews, stored-byte integrity, concurrent jobs, revoked permissions, redaction and duplicate prevention.
- Production build; isolated PDF extraction from all ten traced route packages and Word extraction from nine independently packaged routes; 29-page and gated-API smoke checks; dependency audit.

## Service acceptance before release

Use fictional/non-sensitive records and two real staged organisations with distinct user accounts. Exercise sign-in, membership changes, upload/scanning, independent file review, programme acceptance, control ownership, source change, evidence assessment, recurring work, GitHub connection/rotation/disconnect, lease recovery and exports through the browser and actual configured services. Record failures and timings.

Verify provider privacy/retention and enforceable financial budgets before enabling paid calls. Confirm production backups/recovery, migration rollback strategy, private storage, server secrets, external worker triggers, deletion/retention procedures and logging without document or credential leakage. Test load, accessibility, mobile interaction and non-technical user task completion. Independently review security and legally significant applicability/interpretation results.

Keep preview deployments disabled. Batch changes on the development branch, keep the draft PR unmerged until acceptance and reserve Vercel releases for approved substantial milestones.

Runbooks: [programme operations](programme-operations.md), [evidence assurance](evidence-assurance.md), [monitoring and semantic interpretation](monitoring-and-semantic-analysis.md), [database security](database-deployment-security.md).

### Obligation library batch

- [ ] Apply `obligation-library.sql` after `programme-operations.sql`, verify zero schema drift and default-deny protection on all 26 private tables.
- [ ] Keep `REGPILOT_LIBRARY_ENABLED` and `REGPILOT_LIBRARY_AI_ENABLED` off until the acceptance workflow in `docs/obligation-library.md` is completed.
- [ ] Verify real GOV.UK discovery/identity/withdrawal behaviour and meaningful sector/devolved-nation coverage with a domain reviewer.
- [ ] Run authenticated two-person library intake → applicability → shared controls → impact/withdrawal/redaction acceptance with fictional documents first.
- [ ] Measure live AI relationship quality, review effort, spend enforcement and mobile usability; do not present quotation-grounding tests as legal accuracy or competitor superiority.

### Team access batch

- [ ] Apply `team-access.sql` after `obligation-library.sql`; verify zero schema drift and default-deny on all 32 private tables.
- [ ] Complete the real-service workflow in [Team access](team-access.md), including account provisioning, allowed redirects and independent review.
- [ ] Confirm revoked/demoted members cannot complete in-flight writes, and paused connectors/watches require deliberate reconfiguration.
- [ ] Check mobile invitation acceptance, role changes and work handover with fictional records before customer use.

For Word/document inspection release acceptance, follow [Document understanding](document-understanding.md). Verify the private bucket allows both PDF and standard Word MIME types. Do not enable customer processing solely because offline parsing and CI pass.

### Connected identity monitoring batch

- [ ] Complete [Microsoft 365 acceptance](connected-identity-monitoring.md) with a fictional test tenant before setting `REGPILOT_MICROSOFT365_ENABLED=true` for customer access.
- [ ] Confirm tenant binding, least-privilege admin consent, report licensing/freshness, multi-page collection, credential rotation and revocation with the actual Microsoft service.
- [ ] Verify before/after changes, owner task deduplication, retry/pause and historical exports through authenticated mobile and desktop sessions. A stalled worker is shown as stale; this batch does not deliver external alerts.
- [ ] Review transient Microsoft identifiers, encrypted secrets, tenant offboarding, retention/deletion and logs. Only aggregated report observations may be retained.
- [ ] Confirm the existing worker trigger runs reliably at the chosen interval. No new database migration, deployment, scheduler or paid service was activated by this batch.

### Paid services batch

- [ ] Apply `paid-services.sql` after `team-access.sql`; verify zero drift and default-deny on all 32 private tables.
- [ ] Keep the paid master, safeguards and provider flags false; leave budget defaults at zero until the [paid-service acceptance runbook](paid-services.md) is complete.
- [ ] Validate real Azure OCR, Resend delivery/suppression, Supabase IdP and Stripe test checkout/portal/webhooks without confidential records.
- [ ] Configure provider-enforced spend limits. Application spending reservations are allocations, not verified actual bills.
- [ ] Confirm service drafts, recurring reminder policies and billing events cannot activate providers, grant membership or bypass human evidence review.

## Auditor workspace batch (7 November 2026)

- Apply the additive auditor migration after paid-services; verify 35 private tables and no schema drift.
- Add the two staging Auth redirect paths in `docs/auditor-workspace.md`.
- Use fictional accounts: two organisations, two administrators and two external guests. Complete draft → disclosure preview → publish → invite → accept → selected download → question → response → resolve/reopen → revoke.
- Verify guests never gain team membership and cannot see unselected files, other reviewers' questions, staff identities or storage paths. Recheck expiry and revocation during retrieval against actual services.
- Test signed-in mobile and desktop interactions, stale browser/session changes and human-readable error paths before customer activation.
- Keep every paid provider and Vercel preview disabled. This batch requires no production deployment or hosted database change.


## People and supplier assurance batch

- Apply the additive people-vendor-assurance migration after auditor-workspace only as part of the reviewed release; it has not been applied to production.
- Confirm all 40 private tables remain RLS enabled and inaccessible to Data API roles.
- Run a fictional-data browser pilot: independent policy publication, staff download and acknowledgement, replacement policy history; supplier assessment, independent sign-off, follow-up handover, expired/stale reviews and archive.
- Keep paid services, connector schedules and Vercel previews disabled until their separate activation is authorised.
- Policy acknowledgements are not training certification. Supplier checks are internal review prompts, not validated regulatory mappings. Never advertise these development modules as verified live operation.


## Audit requests, Google Workspace and official web sources

- Apply `audit-evidence-requests.sql` after `people-vendor-assurance.sql`; verify zero schema drift and all 41 private tables protected.
- Follow [the batch acceptance runbook](audit-period-and-coverage.md). Complete request → owned task → independently reviewed upload → sample/period submission → independent acceptance → disclosure preview → publish → guest download using fictional accounts.
- Check stale controls/files, permissions changed during retrieval, request cancellation, unresolved requests, room expiry and historical package downloads in desktop/mobile sessions.
- Keep `REGPILOT_GOOGLE_WORKSPACE_ENABLED=false`. Before separate activation, validate the read-only OAuth scopes, customer binding, pagination, missing fields, credential rotation and revoked consent against a dedicated synthetic Google tenant.
- Confirm the selected ICO, HSE and FCA pages remain retrievable and meaningful. ICO returned HTTP 403 from the development environment; never count that as successful monitoring. Source excerpts and proposed mappings still require qualified applicability/interpretation review.
- Browser QA is pending: the managed preview runner injected unsupported Vite options into `next dev`. No framework change or deployment was made to work around it.


## Coordinated change response

- Apply `change-response.sql` after `audit-evidence-requests.sql`, verify zero drift and default-deny protection for all 43 private tables.
- Complete the [change-response acceptance workflow](coordinated-change-response.md) with fictional data and real staged identities/storage. Add `/team/changes` to approved Auth redirects.
- Check shared-control grouping, downstream dependency review, colleague-only action visibility, stale preview rejection, independent acceptance, storage verification at closure and later-change exports.
- Verify a second source change supersedes unfinished response tasks explicitly without treating them as successful remediation.
- Record desktop/mobile task completion times and errors before claiming usability or competitor superiority. The automated 100-link/five-action fixture tests scope preservation and work deduplication, not real-user performance.
- Keep all paid integrations and preview deployments disabled; do not apply this migration to production as part of development verification.


## Access reviews, customer assurance and audit preparation

- Apply `assurance-operations.sql` after `change-response.sql` through the reviewed release process. Confirm zero schema drift and default-deny on all 48 private tables. No hosted database change was made during development.
- Follow [the assurance operations runbook](assurance-operations.md). Add `/team/access-reviews`, `/team/answers`, `/team/questionnaires`, `/team/trust` and `/trust` to staged Auth redirects as needed.
- Use fictional accounts for access inventory → assigned decisions → source-system change → new inventory → reviewed proof → independent verification → closure. Check self-review, stale/new permissions, reassignment, removal of administrators during retrieval and historical exports.
- Exercise approved answer → CSV questionnaire → per-question confirmation → independent disclosure approval → private Trust Centre → named guest acceptance/download → withdrawal and revocation. Revised answers must block existing shares and exports until new disclosure review.
- Exercise audit period → reproducible sample preview → owned requests → independent acceptance → disclosure publication → ZIP with verified bytes. Check empty populations, changed files, unselected-file rejection, historical review context, archive limits and cancellation.
- Check these workflows in authenticated desktop/mobile sessions with real staged Auth/Storage before customer use. Offline page rendering and API fixtures are not signed-in browser acceptance.
- Access inventories remain human-confirmed CSVs; answer suggestions are deterministic matching; sampling is not a statistical opinion; the Trust Centre is private and named-access. These are not automatic provider discovery/revocation, AI-generated questionnaire answers, a public Trust Centre, or certified audit conclusions.
- Keep every paid integration and Vercel preview disabled. No deployment is part of this batch.
