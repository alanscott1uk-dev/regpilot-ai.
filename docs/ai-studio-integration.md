# RegPilot AI Studio — private-pilot AI integration

## Current architecture
- Supabase email OTP login, verified by the server against the Auth user endpoint.
- Exact allowlist of confirmed emails: REGPILOT_AI_ALLOWED_EMAILS. Only OWNER, ADMIN, EDITOR membership can use AI.
- First-login organisation onboarding restricted to verified allowlisted users, with DB membership and audit event.
- Real Vercel AI Gateway model invocation through AI SDK 6 and configurable REGPILOT_AI_MODEL; default openai/gpt-5.4-mini.
- Three supported workflows: document/PDF review (2 MB max), source-linked impact drafts, and grounded questions.
- GOV.UK sources fetched only from a fixed catalogue; no SSRF-style arbitrary URL fetching.
- Structured provisional findings, citations checked against official text or pasted document text, draft actions requiring explicit acceptance.
- PDF quotations cannot be independently verified by the server; a matched quote is not proof of legal applicability.
- Usage reservations limited per user and organisation by a PostgreSQL AiDailyUsage record, without logging document contents.
- Model outputs do not directly update DB. Accepted action drafts are still saved only in the browser prototype.

## Status: NOT ACTIVATED
Vercel preview deployments remain disabled to conserve the free plan. The development branch has not been deployed.
Vercel currently has only preview-public Supabase URL/publishable key env values. Production DB is not configured. Staging Supabase was hibernated/unavailable; no database migration or live authenticated AI request was possible. No AI credits were purchased.

## Steps required to enable an authorised pilot
1. Restore and validate staging PostgreSQL. Create the base schema and AiDailyUsage table via reviewed Prisma migration, then test cross-tenant access.
2. Configure Supabase Auth redirect URLs for /ai and confirm email link flow, JWT verification, token expiry and revocation.
3. Configure DATABASE_URL, Supabase public URL and key, REGPILOT_AI_ENABLED=true, REGPILOT_AI_SAFEGUARDS_VERIFIED=true only after documented safeguards verification, exact allowlisted email addresses, and AI Gateway OIDC or a server-only gateway key in an approved environment.
4. Set and verify a low Gateway budget and team/key spending alerts. Daily app quota is not an absolute monetary cap.
5. Test a genuine authenticated model response, quota enforcement, blocked non-member, blocked VIEWER, bad PDF and browser action acceptance.
6. Complete processor/data residency/UK GDPR review, audit integrity, encryption, malicious-document scanning, retention and incident response before actual customer data.

## Limitations
Official source text extraction is only for a few known GOV.UK pages and is not an exhaustive legal register.
External provider processing may occur outside the UK. Do not send patient, employee, supplier, confidential or regulated information.
An AI quote or confidence label is not an official verification or compliance outcome.
AI model credentials remain on the server, no actual client model call is permitted without auth, allowlist, membership and quota.
Client demo files remain in IndexedDB; database-backed evidence storage and approval are separate production blockers.
Tests and builds should never invoke or bill a model.

## Human-reviewed amendments
The schema also supports up to three draft policy paragraphs with rationale and source-excerpt fields. No edits are committed automatically. Users may copy proposed wording or export a JSON review; both require independent human assessment.

## Next development batch — Human review inbox

A new optional `retainDraft` selection saves only the generated AI result (including short excerpts and proposed amendments) to a tenant-scoped PostgreSQL `AiReview` record with SHA-256 digest. Original PDF bytes and submitted document text are **not** stored by the review service. This is not privacy anonymisation; result excerpts can still contain input details.

Saved drafts start `PENDING_REVIEW`. A different authenticated `OWNER` or `ADMIN` in the same organisation can mark a draft `REVIEWED` or `NEEDS_CHANGES` with a written rationale. These labels describe a human review of the AI draft, **not regulatory certification or formal evidence approval**. Writes are version-checked and audit events are created transactionally. Hash checking helps detect accidental changes to the stored result but is not cryptographic non-repudiation because an administrator could alter the database.

The staging PostgreSQL migration and cross-tenant end-to-end tests remain an activation prerequisite; no customer data should be submitted or stored. Retention, deletion/export controls, audit append-only enforcement and backups remain to be implemented before production use.

## Citation checks
Findings, suggested actions and proposed amendments now explicitly flag whether a quoted source phrase appears in the fetched, allowlisted official publication text. This verifies only an exact text match (after whitespace normalisation), not legal applicability or the sufficiency of a quotation. When an official publication is unavailable, source quotations are labelled unverified.

## Persistent private team tasks
The secure team task API is separately gated by `REGPILOT_WORKSPACE_ENABLED=false` by default. It uses verified Supabase identity, database-backed organisation membership and role checks on every read/write. Work items are stored in PostgreSQL with audit entries; the former browser-only workbench remains an explicitly separate demonstration. An accepted AI suggestion goes to `/team` and never silently falls back to localStorage.

Because the staging Supabase database has been inaccessible, the database service is tested against disposable PostgreSQL in GitHub Actions. Production database migration, role invitation tooling, retention policies and protected file evidence remain required before a real customer rollout.

## Private pilot login safeguards
Passwordless Supabase login now sets `shouldCreateUser:false` to prevent anonymous browsers from automatically creating Supabase Auth users. An administrator must provision and confirm invited email accounts in Supabase Auth before the user can sign in. The app separately checks an exact server-side email allowlist and database membership. The authenticated AI route reports disabled until the secure workspace flag, AI flag, a provider/model identifier and Gateway credentials are present. This is a readiness check, not a substitute for an end-to-end live model request.

## Model selection
No model is assumed as a production default. The operator must select a currently available `provider/model` identifier from the live Vercel AI Gateway catalogue, check data-handling terms, configure the key or OIDC token and set a budget. The route remains disabled if the model is unset.


## Saved AI draft data minimisation (pre-deployment)
Saved AI drafts can be redacted through an authenticated DELETE endpoint even when paid AI generation is turned off, provided the separate private workspace is enabled. A record creator or an OWNER/ADMIN may remove the stored model output. The active record is overwritten with a small redaction marker and its SHA-256 hash is recalculated, with status REDACTED and version incremented. An audit event preserves content hashes and actor identifiers but **not** original generated text.

**Important:** This is an active-record content-redaction mechanism, not a full GDPR data-erasure implementation. DB backups, AI provider processing/retention, and audit metadata need separate policy and deletion/expiry procedures before customer data is allowed. Previous reviewer rationale fields are blanked from the active record during redaction.

PDF quotation grounding now uses bounded server-side extraction with page anchors and coverage reporting; original files still require visual review. See docs/evidence-assurance.md for current scope and parser limits.
