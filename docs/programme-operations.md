# Programme operations — development batch, 7 November 2026

This batch joins programme import, owned controls, recurring reviews and the first customer-system connector at `/team/operations`. It extends the existing Next.js/Prisma/Supabase architecture. It has not been activated or deployed to production.

## User workflow

1. Add non-sensitive, text-based programme PDFs to the existing private Evidence Vault. An administrator independently reviews the files.
2. In Operations → Import programme, select up to five files. Pattern search has no model cost. Optional AI proposes consolidated controls and human test procedures from the selected pages.
3. An administrator other than the importer and uploaders checks exact page quotations, conditions, exceptions, scope and completeness. They select proposals, a current team member, an operational review interval and first date. Accepted controls are persisted; acceptance does not establish operating effectiveness.
4. In Control library, manage ownership/schedules and record the rationale for each control-to-task scope link. Reassigning a control reassigns its open generated tasks. Links do not bypass requirement-specific assurance or assert framework equivalence.
5. In Connections, associate a GitHub repository/branch with an active control. A restricted fine-grained token is required. Collect classic branch-protection settings daily or weekly; rotate credentials, change settings, request another collection or disconnect.
6. Today shows open/overdue work, clean files awaiting review, source-change impact, evidence-review dates and connector attention. Source-linked tasks still go through the existing evidence-assessment completion gate.

The queue shows the first 100 open tasks, controls the first 100, import history the latest 20, clean-file selection the latest 120 and connector history the latest five observations per connection. Counts and display limits are labelled. These are bounded pilot views, not enterprise pagination.

## Programme integrity and processing limits

Imports reuse the existing real PDF.js worker: 5 MB/file, 40 pages, 80,000 characters/file, eight-second parser timeout, bounded V8 heap, empty worker environment; programme selections additionally cap extracted text at 60,000 characters. No OCR or DOCX support. The parser is not an OS sandbox and does not verify signatures/authenticity or guarantee table extraction.

Every retained control quotation must appear exactly once on the selected document page. Unknown themes and ungrounded/ambiguous/duplicate proposals are withheld. A quote being present does not prove the proposed interpretation is correct. The independent reviewer remains responsible for that decision. Incomplete extraction blocks acceptance.

An organisation-scoped reservation deduplicates identical input/engine/method combinations before parsing or model calls. Failed requests require explicit retry and processing consent. Interrupted requests can be retried after ten minutes. At most three attempts are permitted; version fencing prevents a late earlier attempt overwriting the retry. Redacted and accepted imports cannot be retried. Evidence changes produce a new input identity.

Files, membership, feature gates and hashes are checked after generation and before saving. Acceptance downloads the originals again and verifies actual stored hashes. Redaction fences in-flight saves, clears retained quotations/manifest/control text and disconnects dependent connectors. It deliberately does not claim deletion of original vault objects, earlier task descriptions, mapping rationale or connector observations. Full retention/deletion tooling remains a release requirement.

## GitHub collection contract

The adapter calls only `GET https://api.github.com/repos/{owner}/{repo}` and the selected branch's classic protection endpoint. It rejects arbitrary hosts/traversal, disallows redirects, bounds responses to 64 KB and applies ten-second request deadlines. It retains selected observations, not repository contents, raw responses or access tokens.

Three explicit setting checks cover required pull-request approval count, administrator enforcement and force-push protection. A protection 404 yields UNKNOWN, because missing access, missing branch/protection or separate rulesets cannot be distinguished. Actual review history, repository rulesets, bypass actors and control effectiveness are not evaluated. GitHub plan and repository permissions affect endpoint availability. See [official GitHub branch-protection API](https://docs.github.com/en/rest/branches/branch-protection).

Tokens use AES-256-GCM with random IVs and organisation/connector-bound authenticated data. The server-only master key must be securely backed up. Credential rotation through the UI replaces the token and fences old jobs. Changing the master key requires a separate controlled re-encryption operation or reconnecting affected integrations; key-ring migration is not implemented.

Workers atomically claim 90-second leases with SKIP LOCKED. They verify current configuration, configuring administrator access and enabled control/owner before collection and again before writing. Pauses, redaction, rotation and revoked access prevent obsolete results being saved. Failed jobs retain the last successful observation, retry with backoff and pause after three attempts; credential rejection and revoked authority pause immediately. A repeatedly interrupted job is stopped before another network call.

Missing/failing signals create one open follow-up per connector, assigned to the control owner. Successful checks never complete tasks automatically. Review dates are operational dates, not inferred legal deadlines. Observation exports require membership and matching integrity hashes and label stale/historical data. The hash is not a digital signature.

## Recurring reviews and background trigger

Due schedules create at most one open review task per control. Organisation-level transaction locks plus unique cycle keys prevent duplicate creation. Missed periods coalesce into the next future review date rather than creating a historical backlog. Already-open review tasks are excluded before batch selection so they do not starve other controls.

The worker rechecks the administrator who most recently configured each schedule. Revoked schedulers/owners pause affected automation; another administrator can adopt the schedule through Manage control. Each invocation processes up to five organisations (25 controls each) and two connector jobs. It does not send emails, Slack messages or external reminders. In-app overdue work remains visible.

Configure an external authenticated `POST /api/internal/automation` trigger using the server-only `REGPILOT_MONITOR_SECRET`. No cron, subscription or deployment is created by this batch. Invocations can overlap safely; production throughput, retry latency and worker provisioning still need acceptance testing. Larger organisations will need proper pagination/queue capacity work.

## Activation and migration

All four new flags default to false: `REGPILOT_PROGRAMME_ENABLED`, `REGPILOT_PROGRAMME_AI_ENABLED`, `REGPILOT_CONNECTORS_ENABLED`, `REGPILOT_AUTOMATION_ENABLED`. Connectors additionally require a 32-byte encryption key represented by 64 hex characters. Private workspace authentication/allowlist, database and existing Evidence Vault/scanner configuration remain required. Paid programme AI also requires the existing AI gates, configured model/provider, safeguards attestation and per-user/per-organisation request reservation.

Request limits are not financial spend caps. Before activation, verify actual provider budgets/alerts, privacy terms, retention, authentication, secret handling and relevant account limits. An environment attestation is not proof these controls work.

Apply `prisma/changes/programme-operations.sql` after `evidence-assurance.sql` on a backed-up, reviewed database. The additive migration creates five new tables and task relations/indexes. Default-deny Supabase Data API hardening covers all 20 private tables in the same migration transaction. Server queries must still enforce tenant scope because the privileged Prisma connection is not tenant-isolated by this RLS layer. No hosted migration has been performed.

The committed fixture `schema-fff3015.prisma` records the exact preceding development schema. CI applies the entire migration chain from `schema-b857436.prisma` on disposable PostgreSQL 17 and checks for drift and anonymous/authenticated Data API access denial.

## Coverage and remaining competitive gaps

The allowlist grows from six to 14 selected GOV.UK references: employer registration, workplace pensions, VAT records, limited-company records, distance selling, food registration, food safety and commercial waste are added to the earlier six. Business activity selection expands accordingly. These are guidance references, not a complete obligation library. Food registration and waste rules differ across UK nations; the business profile remains a relevance aid requiring territorial review, not an applicability ruling.

Still outstanding: validated cross-framework equivalence, broad regulatory corpus/licensing, expert-labelled extraction evaluation, audited customer-system collection, Microsoft 365/cloud/HR connectors, full auditor collaboration, SSO/SCIM/invitations, OCR/DOCX, complete deletion/retention, external reminders, production load/recovery/spend testing and non-technical usability studies. This implementation is a concrete step toward the competitor benchmark, not evidence of superiority.
