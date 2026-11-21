# Continuous verification and recovery — 12 November 2026

This batch deepens existing collectors and makes public-source checks repeatable. It does not establish competitor parity or live customer connections. Six provider adapters remain available in code; no private provider credentials or tenant jobs were activated.

## Implemented behavior

- GitHub collector v2 verifies repository and actual branch identity, reads classic protection, up to three pages of active branch rules, and default workflow-token/approval permissions. Twelve explicit signals distinguish accessible settings from unknown data. Classic protection and rulesets are reported separately, including required reviews, status checks, force pushes, deletion, signatures and stale approvals. Ruleset absence is a scoped finding, not a verdict on the combined effective policy. Bypass actors, workflow permission overrides and operating effectiveness still require review.
- Microsoft 365 collector v2 additionally reads conditional-access policy configuration under existing `Policy.Read.All` consent. It retains aggregate counts only. Disabled and report-only policies do not count as enabled MFA requirements; an OR grant with an alternative non-MFA control does not count as mandatory MFA. Three pages / 200 policies / 512 KiB cap; incomplete lists remain unknown. Authentication-strength-only policies and user/application coverage require separate assessment.
- Monitoring recovers tasks from committed changed snapshots even if the worker stopped before enqueueing. It joins exact capture-audit provenance, source hash and organisation, skips baselines and reviewed snapshots, and uses the existing unique task key. Up to ten pending reviews are repaired per check; remaining backlog schedules another pass in one minute. Existing lease, role and pilot-allowlist checks fence every write.
- Workers stop starting new source/connector work after 20 seconds rather than 45, leaving more of the 60-second request window for bounded collection and commit. Existing lease expiry still handles hard termination.
- Public official-source verification retains last-good hashes across outages, differentiates baseline/unchanged/changed/unavailable, and reports recovery after missing checks. Every unavailable source makes the check fail visibly; the former 65% success threshold no longer hides partial outages. Cache loss produces an explicit baseline, never a claim of no change. Hashes are not legal conclusions.
- A real GitHub API contract job uses a short-lived read-only repository Actions token. It verifies target reads and active-rule API shape, retains aggregate signal counts and an observation hash, and treats inaccessible administrator settings as unknown. It is distinct from proving a customer-installed credential or end-to-end customer workflow.

## Scheduler release

GitHub schedules execute only from the default branch. The feature-branch workflow alone is not an active scheduler. The dedicated default-branch public-watch workflow is installed at main commit `baed55b322bdef5240d004798a7bca292016710b`, with checkout pinned to tested commit `4f392ab2b09b9aafd126dadf20e3b574fca08203`. It runs at 00:17, 06:17, 12:17 and 18:17 UTC, with overlap prevention, bounded runtime, read-only repository permissions and 30-day JSON artifacts. GitHub may delay scheduled runs; this is periodic monitoring, not an uninterrupted real-time stream or SLA.

The default-branch operational release includes an exact-message Vercel ignored-build rule so that installing this scheduler cannot publish the older application tree. No application merge or production promotion is part of this batch. Public-watch history is isolated from pull-request caches and contains no private tenant data. A future application release can replace the operational Vercel configuration with its own reviewed configuration.

Staging database inspection before this batch found zero organisations, enabled watches and enabled connectors. Customer automation therefore remains inactive. Live Microsoft/Google/GitLab/Cloudflare/Companies House validation still requires the appropriate dedicated credentials; no fixture is represented as that evidence.

## Authentication routing correction from the preceding session

The stable staging alias now permits access to RegPilot's own sign-in screen without the outer Vercel login. The former `design-modern-workspace` alias redirects with HTTP 307 to stable staging and preserves callback path/query. Application authentication and API membership gates remain intact. Supabase Site URL/allowlist settings were not changed; a completed user email sign-in remains unverified. Do not trigger additional email sends as part of verification.

## Verification

Local: 352 unit/API tests passed and TypeScript passed. Database recovery/idempotency assertions run in disposable PostgreSQL CI, not in staging. The live contract report, public-source manifest and comparison report are produced by CI and the default-branch scheduler; inspect their actual results before claiming coverage. Provider documentation: GitHub REST rules and Actions permissions, Microsoft Graph conditional-access policy list (v1.0).

Verified release evidence:
- Feature CI: https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43131220125 (passed, including PostgreSQL integration and access isolation).
- Desktop/mobile acceptance: https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43131220053 (passed).
- Independent live probe: https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43131220005 (38/38 texts retrieved; actual GitHub read contract passed).
- Default-branch scheduler initial run: https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43131452511 (passed; 38 baselines persisted; cache saved in main scope). The scheduled trigger is installed; the first observed execution was its push trigger, not six hours of uptime evidence.
- GitHub read observation: 5 actual API reads; 1 configuration signal passed, 6 active-ruleset requirements absent, 5 settings unknown. Contract verification is not a clean security assessment.
- Preview deployment `dpl_8D2iTPPWS6SsXFUXMpGwtmvSUYJs` READY on tested code.
- Operational main deployment `dpl_6rLPabCcuidnnA8qyvFJSEyJVmS8` CANCELED by the ignored-build rule; no production promotion.
