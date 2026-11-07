# Development release verification

The current development branch contains authenticated workspace, regulatory monitoring, PDF assessment, programme import and connector integration code. Feature flags and environment readiness determine availability. Passing offline checks does not make these services operational.

## Required automated checks

- Unit, HTTP gate, parser, provider-adapter and grounding tests.
- Prisma validation and generation; full additive migration chain on disposable PostgreSQL 17; zero schema drift.
- Default-deny checks for all 27 private tables and PostgreSQL integration workflows, including tenant boundaries, independent reviews, stored-byte integrity, concurrent jobs, revoked permissions, redaction and duplicate prevention.
- Production build; isolated PDF extraction from all eight traced route packages; 17-page and gated-API smoke checks; dependency audit.

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

- [ ] Apply `team-access.sql` after `obligation-library.sql`; verify zero schema drift and default-deny on all 27 private tables.
- [ ] Complete the real-service workflow in [Team access](team-access.md), including account provisioning, allowed redirects and independent review.
- [ ] Confirm revoked/demoted members cannot complete in-flight writes, and paused connectors/watches require deliberate reconfiguration.
- [ ] Check mobile invitation acceptance, role changes and work handover with fictional records before customer use.
