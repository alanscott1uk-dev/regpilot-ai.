# Infrastructure reliability expansion — 12 November 2026

## Running pipeline

This batch expands the GOV.UK collector from 100 to 2,000 results per publisher, with a fixed end timestamp, pagination identity checks, explicit index-change/limit states, a 90-second deadline per publisher, three concurrent publishers and bounded retries. A failed publisher does not overwrite its previously observed records. Per-publisher cooldowns and consecutive-failure counts survive in the published checkpoint: transient failures back off from 15 minutes to six hours, and explicit provider delays up to seven days are preserved. Longer delays require operator review rather than an early retry. The retained report is bounded to 10,000 records or 4 MB, whichever comes first, to remain within hosting response limits. Retention limits are explicit.

The direct external run returned 2,508 distinct publications, twelve responding feeds and zero result-limited feeds. HMRC returned 1,092 records; these are discovery metadata, not verified legal obligations. Selected publishers and the 30-day window remain deliberate coverage boundaries. The existing 38 official-text checks continue separately.

The default-branch collection schedule is upgraded from six-hourly to hourly. Report history retains up to 48 earlier published runs, including record and feed-health counts. Publication rejects a report older than the currently published report, with GitHub's expected blob SHA protecting concurrent writes. A separate, read-only hourly watchdog checks the published data independently of the collector. Its failed workflow signals unavailable, malformed, degraded or over-three-hour-old data; this does not send external messages or claim an uptime guarantee. `/api/horizon/health` supplies a small machine-readable report and returns HTTP 503 for stale/degraded/unavailable data. UI exposes request/retry counts and published history.

The collection and publishing jobs remain separate. Only the pinned standard-library publisher receives repository write permission; it can write only public horizon data on the data branch. No tenant records enter that branch. The watchdog uses no credentials or third-party Python dependencies. Provider read tokens, if later configured, are exposed only to the pinned default-branch contract step, never PR code or install steps.

## Integration infrastructure

One fixed-origin, deadline-bounded GET transport now serves GitHub, Microsoft Graph, Google Directory, GitLab, Cloudflare, Companies House, Vercel and Supabase adapters. It retries transient network/502/503/504 failures and throttling at most three attempts, with a total request budget, bounded exponential jitter and support for `Retry-After` dates/seconds and GitHub rate-reset headers. It does not follow redirects, retry permission denials or retry OAuth POST requests. Long provider waits up to seven days become a persisted connector `nextRunAt`, with longer delays pausing for operator review; rate limiting does not exhaust the permanent failure allowance. Last good evidence is preserved and follow-up tasks remain deduplicated. Other persistent failures still use the existing pause/recovery controls.

Two new read-only adapters are integrated through configuration validation, encrypted secrets, version fencing, concurrent claims, observations, follow-up tasks, export, setup status and the Connections UI:

| Provider | Exact target scope | Observations | Deliberately not inferred |
| --- | --- | --- | --- |
| Vercel | Project ID and team ID, case preserved | Verified identity, fork protection, declared deployment-authentication scope | Protection of every alias, app authentication, production health, operating effectiveness |
| Supabase | Project reference and separate provider organization ID | Verified identity, active project status, successfully applied database SSL enforcement | RLS, backups, database rows, storage policies, compliant data residency |

Dedicated read-only credentials are required. The two customer collectors remain disabled until configured. The HTTP contract harness records `NOT_CONFIGURED`, `READ_CONTRACT_VERIFIED` or `READ_CONTRACT_FAILED`; absent credentials never become a pass. Existing GitHub live contract verification remains separate.

## Verification boundaries

- Connected Vercel and Supabase tools returned actual project metadata. Applying the same observation parsers to those selected fields verified project/team or project/organization identity. Vercel's omitted fork setting stayed UNKNOWN; Supabase SSL enforcement was not supplied by the tool and stayed UNKNOWN. This was a connected-tool response contract check, not an end-to-end test of dedicated customer collector credentials.
- Unit tests cover transient recovery, long throttling, request budgets, redirected targets, secret-free errors, wrong accounts, missing fields, applied-versus-pending settings, expanded pagination, retention byte limits, publisher failure retention, changing indexes and public payload allowlists.
- PostgreSQL tests extend tenant isolation, encrypted storage, configuration rotation, provider disablement and concurrent claim coverage to both new adapters. A repeated-throttling test verifies durable deferral, preserved retry allowance, zero fabricated observations and a single follow-up task.
- Fictional desktop/mobile browser journeys exercise both connection forms, consent, credential clearing, preservation of provider and workspace identities, case-sensitive project IDs, viewer restrictions and overflow. They are not customer sign-in acceptance or independent human usability research.

## Provider references

- Vercel official OpenAPI, `GET /v9/projects/{idOrName}`: https://openapi.vercel.sh
- Supabase project identity: https://supabase.com/docs/reference/api/v1-get-project
- Supabase applied SSL response and permission: https://supabase.com/docs/reference/api/v1-get-ssl-enforcement-config
- GOV.UK paging and timestamp filters: https://github.com/alphagov/search-api/blob/main/docs/using-the-search-api.md

## Release evidence

Verified code commit: `7a58c2bc060a416dc95be884fc807f58854996fd`.

- [CI 43137931673](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43137931673) passed: 182 JavaScript tests, 188 TypeScript/API tests, 37 PostgreSQL integration tests and 2 RLS tests (409 total), plus type checking, dependency audit, production build, PDF/Word runtime and 33-page smoke checks.
- [Browser acceptance 43137931668](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43137931668) passed all eight desktop/mobile journeys. The connection and private-workspace journeys use fictional fixtures; they do not establish real customer authentication or provider credential acceptance.
- [Independent external probe 43137931706](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43137931706) retrieved 38/38 selected text bodies and 2,508 distinct publications, with all 12 publisher feeds available and none result-limited. The GitHub read contract passed. Dedicated Vercel/Supabase contracts reported NOT_CONFIGURED, as expected without customer credentials.
- The default-branch activation commit is `8ffe92c203b9fbc8e277989cf4a19ecf4d48ef2e`. Collection is scheduled at minute 17 of every hour; the separate read-only watchdog at minute 47. Both pin the verified code above and all actions in these workflows pin verified release SHAs. GitHub schedule timing is best effort, not an uptime guarantee.
- The [independent watchdog activation run 43138303863](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43138303863) succeeded. That initial check ran before the new collection was published and validated the still-fresh earlier report. A subsequent direct execution checks the expanded report below.
- Staging deployment `dpl_ArBHeNmxbkePuGfKbKGcEA13T1h8` reached READY for the verified code. Its public health endpoint returned HTTP 200, and unauthenticated `/api/workspace/horizon` returned HTTP 401 with Cache-Control: no-store. The scheduler-only main deployment `dpl_FZs8sJZqJ9VbM4oKixvbHwhxVqEx` was canceled by the existing build guard; the old production application was not promoted.

Provider maintenance responses with Retry-After also persist a cooldown. Manual collection requests cannot override an active provider cooldown. No paid service or dedicated customer provider collector was activated.


### First expanded publication

[Collection and publishing run 43138303864](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43138303864) completed successfully: 38/38 text bodies, a passing GitHub read contract and a validated public report at `2026-11-12T02:00:26.616Z`. Public data commit: `697700151a19315890212b01895886fd8e0f590f`.

The published report contains 2,508 records, 12 available feeds, zero unavailable or result-limited feeds, 56 HTTP requests, zero retries on this successful run, an 8,161 ms collection duration, and a retained history entry for the earlier 1,008-record run. The independent watchdog script was executed directly against this new published report and returned `current`, with zero unavailable feeds. This proves the first expanded publication and check, not sustained uptime. The initial cached read path was subsequently corrected as recorded below.

### Delivery correction and live verification

Live validation found the app still returning the prior 1,008-record snapshot beyond its expected cache refresh. Commit `ce1b2c35cd7a71907ccc5177a8fd242bd70a7386` removes platform data caching from the bounded, validated public-report read. The durable data branch remains the source; a failed fresh read is reported as unavailable. This increases upstream reads per user refresh rather than hiding publication behind stale cache revalidation.

Deployment `dpl_BJEBdGpRb914qPxo2pv99khUra88` reached READY for this correction. Both `/api/horizon` and `/api/horizon/health` then returned HTTP 200, state `current`, 2,508 publications and cadence 60 minutes for the published `2026-11-12T02:00:26.616Z` report. A real browser verified the public `/horizon` page displaying CURRENT, 2,508 records, 12 responding feeds, zero limited/unavailable feeds, 56 reads, zero retries and one previous published run. No email sign-in was required. The source collector and watchdog remain pinned to the independently tested `7a58c2b` collector code; this delivery correction changes only the app reader.

The delivery correction passed [CI 43139527459](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43139527459), [eight browser journeys 43139527740](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43139527740) and [external probe 43139527536](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43139527536). These runs validate the final deployed application code.


## Private worker activation — 14 November 2026

Code `26c68523ed2eeab058f2976df41fd0ccaca8f4b4` adds a deployed, durable private worker. GitHub OIDC uses pinned issuer keys, RS256, audience, immutable repository/owner IDs, main ref, exact workflow identity, allowed trigger types and short token lifetime. No permanent scheduler password is stored. The request cannot select arbitrary tenants, jobs or provider targets. The existing tenant membership, provider gates and child-job leases remain enforced.

`WorkerRun` records each invocation with a unique run/attempt key, global overlap exclusion, a three-minute lease, terminal outcome and aggregate module counts. Expired execution is marked interrupted; stale finishers cannot overwrite a recovered run. Replayed requests do not repeat completed work. Operational records retain 30 days. A public aggregate health endpoint returns 503 for missing, disabled, failed, interrupted or older-than-90-minute execution; it exposes no tenant or credential details. Independently scheduled checks detect stopped worker delivery.

The additive migration was applied to staging. The new table has RLS and restricted runtime CRUD; anon, authenticated and service_role have no table privileges. Staging connector encryption, worker, monitoring and automation configuration are present. Paid services and unverified provider flags remain off. The old production application was not promoted.

Verification:
- CI [43534915933](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43534915933) passed 414 tests: 182 JavaScript, 192 TypeScript/API, 2 RLS and 38 PostgreSQL integration tests, including concurrent invocation, replay, lease expiry, interruption, stale health and secret-free failure reporting. Schema drift was zero; build and runtime checks passed.
- Browser acceptance [43534915880](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43534915880) passed. No new interface is part of this release.
- External probe [43534915866](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43534915866) initially reported one Scottish Government extraction failure (37/38). A direct recheck succeeded; one rerun passed. This is an intermittent upstream/layout retrieval limitation, not evidence of continuous full coverage.
- Staging deployment `dpl_7PqvcX742giPsDj2YtBdmgt5zDQn` reached READY. Unauthenticated POST `/api/internal/worker` returned 401. Before the first invocation, `/api/worker/health` correctly returned 503/stale.
- Main activation `b0acd9d80140baf9f92dcf8c323b0de381830113` installs the worker at minutes 8 and 38 and independent watchdog at 23 and 53 each hour. GitHub scheduling is best effort. Its production app build was canceled by the workflow-only guard.
- First real invocation [43535535490](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43535535490) passed both invocation and independent health verification. PostgreSQL records COMPLETED at 00:38:39 UTC; one source processed, zero customer connectors and zero recurring control reviews processed. The deployed health endpoint returned HTTP 200/completed.
- An isolated synthetic canary workspace, with a non-login internal service identity, watches the public `mhra-gmp-gdp` source daily. Its first genuine capture persisted 12,000 characters, content hash `c3eb6ce3a0a1341b53ac334cabddd6339946b80a71c9efd4e297ffccb4f65715`, status NEEDS_REVIEW and the next scheduled check. This tests source-to-database operation, not customer authentication, complete document coverage or regulatory approval. No customer tenant or provider credentials were invented.

Customer connector acceptance still requires dedicated, least-privilege account credentials and real observations. This release establishes an operating staging worker and real public-source persistence; it does not claim broad live customer integrations or production parity.
