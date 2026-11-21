# Audit periods, wider identity collection and direct official sources

Development batch on 7 November 2026, building on `e9db678`. This batch preserves Next.js, Prisma, Supabase Auth/private storage and existing workers. No paid service, hosted migration, provider connection or deployment is activated.

## Audit evidence requests

An administrator creates a draft with an explicit audit period (up to 366 days), even before evidence exists. Requests choose an active control, responsible colleague, due date and sampling instructions. Each request freezes the control version and creates an owned preparation task linked to the Evidence Vault.

The colleague uploads files against that task and obtains independent file approval. They then select up to ten approved files and explain the population, sampling method, coverage and exclusions. The declared coverage must include the requested period and cannot claim future dates. This validates date consistency; it does not prove the files cover that period or that a sample is representative.

A different administrator reviews the submission. Acceptance verifies the stored bytes and rechecks membership, control version, file approval and request version after retrieval. Acceptance adds frozen file metadata and an accepted-request receipt to the draft package. Returning a submission preserves the earlier submission and review notes in database history; cancelling an accepted draft request removes its receipt and files. Neither changes an already published room.

Publishing is blocked by unresolved requests, stale controls/files and an empty package. The exact disclosure preview includes dates, accepted request titles, control titles/versions and file selection. The external auditor receives only that published selection and their own question threads. Internal sampling notes, task instructions, staff identities and review notes stay private. The administrator can download a JSON package index with the frozen manifest and SHA-256 fingerprint. It contains no evidence bytes and is not a digital signature, audit opinion or full population export.

Limits: 50 requests per room including cancelled requests, 10 prior submissions per request, 10 files per submission and 50 files per package. My audit requests lists at most 50 requests. The control-linked task is administrative preparation and cannot establish control effectiveness. Existing recurrence, handover and reminders can act on its owner/deadline through the established task infrastructure.

Migration: `prisma/changes/audit-evidence-requests.sql`, after `people-vendor-assurance.sql`. The schema baseline is `fixtures/schema-e9db678.prisma`. The new `AuditRequest` table has composite organisation-scoped foreign keys and joins the default-deny policy for all 41 private tables. CI applies the complete migration chain in disposable PostgreSQL and checks schema drift.

## Google Workspace connector

`REGPILOT_GOOGLE_WORKSPACE_ENABLED=false` is the default. The connector also requires the existing workspace/connector flags and encryption configuration. It reuses encrypted credentials, leases, version checks, permission fencing, aggregate history, change follow-up tasks, freshness checks and disconnection. No extra scheduler or paid call is introduced.

A Google administrator must separately prepare a dedicated OAuth client and a refresh token restricted to `https://www.googleapis.com/auth/admin.directory.customer.readonly` and `https://www.googleapis.com/auth/admin.directory.user.readonly`. This batch accepts that credential through the existing authenticated configuration form; it does not implement a Google consent redirect or self-service OAuth onboarding. Do not grant mail, document or write scopes. Verify current Google requirements and tenant permissions before activation.

The collector exchanges the refresh token at the fixed Google token endpoint, then uses GETs against fixed Directory endpoints. It verifies the exact case-sensitive customer ID before reading accounts. Redirects are refused. Collection is bounded to 25 seconds, 10 pages, 2,000 records, 500 KB per directory response and 2 MB total re-encoded response bytes. It rejects duplicate IDs, looping pagination, malformed data and cross-customer rows.

Only aggregate 2-step-verification enrolment/enforcement, administrator enforcement and coverage are retained. Suspended and archived accounts are counted separately; unknown status and missing fields prevent an all-account pass. Names, email addresses, user IDs, raw responses and credentials are not retained in observations. Directory settings are a point-in-time report, not proof of sign-in enforcement, application access, device posture or compliance. Unknown or incomplete data cannot produce an all-account pass.

Before activation, use a fictional tenant to verify scope consent, customer matching, real false/omitted-field behaviour, pagination, provider errors, token revocation, rotation, history and owner follow-up. The provider remains unverified live.

Official API contracts: [users resource](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users), [users.list](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list), [customers.get](https://developers.google.com/workspace/admin/directory/reference/rest/v1/customers/get), [OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server).

## Direct regulatory publication coverage

The static source catalogue adds three exact official URLs to the existing 14 references:

- [ICO accountability and governance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/)
- [HSE risk assessment steps](https://www.hse.gov.uk/simple-health-safety/risk/steps-needed-to-manage-risk.htm)
- [FCA Consumer Duty overview](https://www.fca.org.uk/firms/consumer-duty/about)

The adapter accepts only those curated identities, uses a bounded fixed-origin fetch without redirects, checks one semantic main region and the expected heading, and excludes navigation, scripts, forms and comments. Changed/error layouts, HTTP failures and oversized pages fail closed. It never treats retrieval time or HTTP Last-Modified as a legal effective date or publisher revision date. Text snapshots and changes enter the existing review, applicability and traceability pipeline; any AI interpretation stays behind existing disabled paid gates. GOV.UK discovery remains separate; arbitrary external URLs cannot be registered.

Public retrieval on 7 November returned HSE and FCA HTTP 200, with 3,540 and 7,026 extracted characters respectively. ICO returned HTTP 403 from this environment and remains unavailable here. These are one-time retrieval checks, not proof of continuous monitoring availability. No confidential material was retrieved.

This expands useful UK coverage but is not a complete legal corpus, qualified validation of control mappings or demonstrated superiority to CUBE. Control mappings and territorial/business applicability still require domain review.

## Verification and release boundary

Automated fixtures cover Google customer binding/privacy/uncertainty, source parser failure paths, audit-request authorisation, file/period constraints, independent review, retained submissions, concurrent decisions, stale controls, permissions changed during file retrieval, disclosure redaction, scoped exports and cross-organisation database constraints. Tests make no paid calls. Check the CI run associated with the final commit for the complete result.

Signed-in browser acceptance remains outstanding. The managed preview runner supplied Vite-specific options to the existing Next.js command and stopped before serving. The app architecture was preserved. Add `/team/audit-requests` to the staging Auth redirect allowlist. Before release, exercise the complete audit workflow on desktop/mobile with two administrators, a request owner and an external reviewer, and validate real Auth/Storage/provider behaviour with fictional records.

Remaining competitive gaps include broad connector coverage, self-service connector onboarding, formal access review campaigns, a Trust Centre/questionnaire workflow, larger expert-reviewed regulatory libraries, validated mapping quality, and measured SME task-completion performance. Passing our regression tests is not a hands-on competitor benchmark.
