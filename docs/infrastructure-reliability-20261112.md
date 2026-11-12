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

Release commit, successful CI runs, activated schedule and staging deployment are recorded after verification. The old production application is not implicitly promoted by the scheduler-only main commit.
