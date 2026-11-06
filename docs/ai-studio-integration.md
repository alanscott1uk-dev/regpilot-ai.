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
3. Configure DATABASE_URL, Supabase public URL and key, REGPILOT_AI_ENABLED=true, exact allowlisted email addresses, and AI Gateway OIDC or a server-only gateway key in an approved environment.
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
