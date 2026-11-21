# RegPilot AI — Connected intelligence and integration expansion, 10 November 2026

## What was implemented

### One regulated-intelligence operational view
- `/team/coverage` is an authenticated, tenant-aware dashboard: catalogue size, text baselines, human-review queue, source checks, stale/failed/never-monitored status, regulator breakdown, responsive filters and safe CSV export.
- Source health is not estimated from a configured watch. Current requires an enabled service, a successful collection and a timely check. Paused, unavailable, failed and pending states remain visible.
- Connected evidence health is also shown on this page. `/api/workspace/connectors/health` rechecks stored observation integrity and connector version, exposed only through authorised organisation membership. It never exposes encrypted secrets or claims compliance.
- Both domains link to their actual independent review workflows.

### Seven-day briefing, not a fabricated score
- `/team/briefing` and `/api/workspace/briefing` combine audited regulatory text-change events, current pending source review, scheduled-source failures, provider-collection problems and upcoming team obligations.
- The server uses a read-only tenant-scoped repeatable-read transaction and bounded inputs. It only labels a publication text change when an actual stored `regulatory.source_text_changed` event exists. A first baseline is not reported as a regulatory event.
- Report and CSV do not invent requirements, legal effective dates, approved obligations or provider health.

### UK SME-specific source intelligence
- Business-profile activities now cover supply-chain operations and sponsored workers alongside existing privacy, medicines, controlled drugs, staff, premises, VAT, food and waste.
- The deterministic source analysis uses curated activity + jurisdiction tags, with different-nation sources requiring more context rather than being called applicable. Existing source mappings remain as explicit legacy fallbacks.
- Source history now offers profile-based, explainable starting-point recommendations. The operator can narrow the catalogue and configure an explicitly chosen monitoring portfolio. Unclassified references remain available.
- Deep links take a source finding to its exact publication review screen.

### Automated verification
- Coverage classification, CSV formula safety, connector hash/version/freshness, seven-day brief contents and profile recommendation rules have direct tests.
- PostgreSQL integration checks tenant isolation in briefing retrieval and the full suite retains multi-organisation source/evidence workflows.
- Offline production-build smoke checks and external black-box desktop/mobile browser tests cover both new pages, keyboard focus, task persistence and horizontal overflow.
- Independent official-source probes report retrieval digests and failures without claiming legal effect.

## What is not activated
The draft branch remains unmerged. No remote database migration, paid provider, production scheduler or production deployment was enabled in this batch. The latest completed external publication probe retrieved 37/38 text bodies; the ICO webpage was not retrievable and must remain flagged as unavailable. This is not comprehensive coverage or a validated interpretation benchmark.

## Release gates
1. CI and browser acceptance pass on the **exact final commit**; review external source extraction evidence.
2. Staging Supabase Auth and PostgreSQL become reachable and the complete, default-deny migration chain runs against a disposable staging environment with two distinct organisation identities.
3. A safe staging account for each provider passes credential handling, exact target, revoked access, known failing setting, changed setting, history, stale observation and offboarding.
4. Scheduler flags and protected `CRON_SECRET` are enabled **only in verified staging** and checked for missed runs and a durable audit trail. Configure alerts if scheduled jobs repeatedly fail.
5. Independent external SME operators complete the prespecified five-person usability study with actual results before marketing usability superiority.
6. Compare matched end-to-end production tasks with Vanta, Sprinto, Drata and CUBE; do not label code/test coverage as product-market parity.

See [live-service and usability acceptance](live-service-and-usability-acceptance.md) and [release checklist](release-checklist.md).
