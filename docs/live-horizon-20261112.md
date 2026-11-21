# Live horizon discovery — 12 November 2026

This records the initial release. The subsequent [infrastructure reliability release](infrastructure-reliability-20261112.md) supersedes the collection limits, cadence and deployment evidence below.

The existing 38-publication watch detects changes to already selected text. This batch adds discovery of recently published or updated items across twelve GOV.UK publishers, a public horizon screen, and authenticated revision-specific review decisions.

## Public discovery and operation

The collector uses the official GOV.UK Search API with fixed publisher filters and a rolling 30-day timestamp window. It checks every returned organisation slug, canonical publication path, title, document type and timestamp. Three bounded workers read at most two pages of 50 records per publisher. Result caps, missing feeds and retained older observations are explicit; there is no claim of comprehensive UK coverage. Stored metadata is deduplicated by official URL, with first-seen time, last observation time and a metadata revision hash. Metadata differences do not establish changes in law.

Initial direct live run: 1,008 distinct records; all twelve publisher feeds responded; six exceeded the 100-result per-run limit. The cap is intentional and visible, not counted as complete coverage. The retained feed is also limited to the latest 1,500 records. Departments are not all regulators; this is twelve selected publishing authorities, not twelve comprehensive regulatory integrations.

Publishers: MHRA, Home Office, HMRC, Companies House, Department for Business and Trade, CMA, Environment Agency, Defra, DWP, Office for Product Safety and Standards, DSIT and DHSC. This does not cover every devolved authority, FCA, ICO, HSE or secondary publication site. Existing curated-text checks remain separate.

A separate publisher job in the six-hour public-watch workflow publishes validated public metadata to the fixed `regpilot-public-feed` branch. This branch contains public data and a Vercel configuration disabling deployments. The read-only collection job does not receive repository write permission. The publishing job has no dependency installation, uses sparse checkout of a pinned standard-library Python script, receives only the expected artifact, checks code provenance and schema, and can address only `horizon.json` on the fixed data branch. No private workspace records or credentials are included. A provider outage still produces an explicitly degraded report; a failed publication leaves the previous report timestamp visible as it ages.

## Product workflow

`/horizon` is public and does not require an email sign-in. It supports publisher/category/activity/text filters, explainable category/activity priority, bounded display, publisher health, official-source links, and saved workspace decisions. No AI model or paid integration is activated.

A signed-in workspace owner, administrator or editor can assign a publication revision to an active member with a real internal review date, or dismiss that revision with a rationale. Every action requires deliberate acknowledgment and at least 20 characters of context. Viewer access is read-only. Decisions and tasks are scoped to the organisation and exact publication revision. Concurrent duplicates reuse the same unique task; an already queued revision cannot be silently dismissed. Reconsidering a dismissed revision can create its owned task. Stale observations and currently unavailable publishing feeds cannot create new review decisions.

Queued work links to the original publication. It does not claim full-text capture, set a verified source-check timestamp, accept a legal obligation, generate evidence, or close a control. Existing source review, change response, and independent evidence workflows handle those later stages. The review date is explicitly an operational target rather than a legal deadline.

## Verification and release

Unit tests cover publisher identity, request limits, pagination, stale/future data, unsafe URLs, outage retention, metadata comparison, and transparent ranking. PostgreSQL integration covers role revocation, cross-tenant ownership, duplicate concurrency, revision mismatch, dismiss/reconsider, and absence of fabricated source snapshots. Browser acceptance uses clearly fictional fixtures on desktop and mobile; live external discovery is verified separately.

The tested code is deployed to staging, the public data-only branch is populated, and the default-branch scheduler pins the verified code commit. The first successful publication and public endpoint are verified below. This does not establish long-term availability or competitor superiority.

Official API contract: https://github.com/alphagov/search-api/blob/main/docs/using-the-search-api.md

### Observed release evidence

Code commit: `51c90305d05b22acb99a23985d14871e5d177f1b`.

- GitHub CI [43133908358](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43133908358) passed: 181 JavaScript tests, 176 TypeScript/API tests, 36 PostgreSQL integration tests and 2 RLS tests (395 total), plus type checking, production build and runtime smoke checks.
- Browser acceptance [43133908345](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43133908345) passed with fictional desktop/mobile fixtures, including publication filtering, bounded rendering, deliberate acknowledgment, owned task creation, viewer restrictions and overflow checks.
- Independent external probe [43133908363](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43133908363) passed: 38/38 selected text sources; 1,008 distinct discovery records, 12 responding publisher feeds, six explicit collection limits and zero unavailable feeds.
- Default-branch scheduler activation commit: `b344324c205351e4f17f3e8da6bf9c485c679ba7`. Its [first collection and publishing run](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43134215630) completed successfully. The installed schedule is 00:17, 06:17, 12:17 and 18:17 UTC. This is configured recurring operation with one observed successful publication, not an uptime claim.
- Published report timestamp: `2026-11-12T01:24:07.295Z`. The public data branch and staging `/api/horizon` both returned HTTP 200 with 1,008 records and state `limited`. An unauthenticated private workspace horizon request returned HTTP 401 with `Cache-Control: no-store`.
- Staging deployment `dpl_4BrE5syLdWrPATsCCG3AGGk1LHzN` reached READY for the tested code. The [public horizon page](https://regpilot-ai-qnx6-git-feature-traceabil-2f0b3f-alanscott1uk-5933.vercel.app/horizon) was verified in a real browser without email authentication; its MHRA filter returned 80 publications.
- The scheduler-only main deployment was canceled by the existing exact-message build guard. The old production application was not promoted. Authenticated customer use and long-term scheduled uptime remain separate verification boundaries.
