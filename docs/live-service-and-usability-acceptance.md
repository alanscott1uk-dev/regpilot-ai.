# RegPilot: live intelligence, connector verification and independent usability acceptance

## Delivered implementation (10 November 2026)
- 38 explicitly curated UK public publications in the catalogue, including GOV.UK content and bounded official website parsers. Catalogue entries **are not** live successful checks or verified legislation.
- Bulk daily/weekly monitoring schedules: the administrator filters by sector, jurisdiction or words and selects up to 30 exact registered sources; API enforces organisation membership and audit history. Master and worker flags must be enabled separately.
- One Vercel Cron entry, 06:00 UTC daily, at `GET /api/internal/cron`. It requires `CRON_SECRET` bearer authentication; do not reuse the existing monitor secret. It runs isolated bounded monitoring, connector and recurring-review sub-batches with lease-based deduplication. Stale workers cannot overwrite a newer configuration; bad grants, collection failures and unavailable sources are visible rather than silently passing.
- The connector screen supports **Verify live connection now**, a permission-checked direct request for that exact stored connector and configured target. Runs use actual API collectors and log immutable hashes to the tenant-scoped database when the provider is **independently enabled and accessible**. In CI a fictional collector is injected; a green CI test is not a real GitHub/Microsoft/Google/GitLab/Cloudflare/Companies House acceptance.
- External GitHub Actions probes of the published UK regulatory URLs run independently of the Next app, store digest/status-only evidence and fail clearly on source retrieval degradation. HTML page coverage, GOV.UK API availability and legal-effective-date interpretation require separate source checks.
- The black-box Playwright workflow uses a production Next build and desktop/mobile Chromium with fictional data, checks completion and persistence of a task, navigation, keyboard focus, horizontal overflow and console errors. Screenshot/JSON artifacts retained for 14 days.

## Live-service activation gates (not complete)
1. Use a dedicated staging Supabase instance: run the reviewed migration chain, RLS/Data API isolation tests, two organisation sign-ins, recovery and scanner/storage checks; obtain a successful actual remote SQL query before asserting service readiness.
2. Configure *server-only* Vercel `DATABASE_URL`, Supabase Auth, `REGPILOT_AI_ALLOWED_EMAILS`, then enable `REGPILOT_WORKSPACE_ENABLED` only after actual two-tenant validation. Never place private keys under `NEXT_PUBLIC_`.
3. Set random `CRON_SECRET` (at least 32 characters), then test `GET /api/internal/cron` in staged runtime with all worker masters disabled: expect 503. Verify bad secret returns 401. Use only a reviewed protected environment for the secret.
4. Configure one *test* source watch with `REGPILOT_MONITORING_ENABLED=true` and `REGPILOT_AUTOMATION_ENABLED=true`, then enable `REGPILOT_CRON_ENABLED=true` and observe durable snapshots, revision diffs, last-success timestamps and source-failure handling across two scheduled runs. Measure total backlog against interval promises. The bounded default worker handles 12 monitored sources/tick. A higher-volume interval SLA requires more protected worker executions/capacity.
5. For each read-only connector, provision an actual sandbox account and scope-minimal provider credential stored encrypted server-side. Enable the specific provider flag, request **Verify live connection now**, independently check exact target and known test settings, toggle a benign setting in the provider, verify before/after capture, recheck revocation, credential rotation, staleness and tenant isolation. Keep provider flags off for integrations that cannot pass.
6. Configure worker health monitoring and external alerting to an owned operations channel; 503 from a sub-batch, repeated lease recovery and stale snapshots must page a human. The current workflow **does not** itself send outbound notifications.
7. Only after signed-off staging live acceptance, reviewed migrations, rollback and PII retention, enable production flags, create a controlled deployment and verify Vercel's scheduled execution logs. This batch does not deploy or activate production.

## Independent usability study (human participants)
Recruit at least **five genuinely external UK SME operators** with no RegPilot development involvement. At least two must have no compliance software experience; include keyboard-only and narrow-mobile participants. Obtain consent, use a fictional company and no real private/medical data. Moderator must not supply step-by-step instructions.

Five prespecified tasks:
1. Create the fictional company, identify its home nation and business activities, and find one source relevant to that context.
2. Review a changed source *without* assuming it is a law change; assign a real-looking but fictional owner to investigate.
3. Connect a synthetic read-only provider account, inspect a failing/unknown setting and propose a corrective action.
4. Link a fictional evidence file to one shared control and request separate review; explain who has authority to accept it.
5. Produce a scoped review/evidence export, describe what is proved and what still requires human assessment.

Record per task: success unaided (yes/no), time, user errors, navigation dead ends, false-confidence assertions, assistance requested, keyboard issues, mobile overflow and System Usability Scale (SUS) questionnaire results. Predefine thresholds **before** first test: ≥90% completion unaided across all 25 task attempts, median first two tasks ≤10 minutes combined, no critical cross-tenant exposure, zero incorrect implied-compliance verdicts, SUS ≥80, keyboard navigation functional, no material horizontal overflow at 390px. Publish anonymised raw observations and deviations; do not advertise a usability victory without participants and measures.

Separate machine and human results: the Playwright suite is independent-of-component automated verification, **not** an independent human study. It must not be reported as five external users or competitor superiority. To establish parity, independently benchmark matched end-to-end tasks and production uptime against Vanta, Sprinto, Drata and CUBE using comparable customer roles and workload, not a feature checklist alone.
