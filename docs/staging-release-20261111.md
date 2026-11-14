# Staging activation — 11 November 2026

## Scope

Deploy the existing development work to an authenticated Vercel preview backed by the existing **RegPilot AI - Staging** Supabase project. Production remains on its prior release until live acceptance. This is a fictional-data pilot, not an assertion of production readiness or regulatory approval.

## Database work completed

- The project initially reported healthy while SQL timed out. Auth health and SQL recovered after wake-up.
- The existing database contained eight lowercase prototype tables, including one organisation, one membership and one module record. These tables and records were preserved.
- Applied `regpilot_current_private_workspace_20261111` and `regpilot_private_table_api_deny_20261111` through Supabase's migration API. These introduce the current 48 Prisma model tables and enable RLS/revoke Data API privileges. No prototype data was imported into the new workflow without a mapping review.
- `prisma/releases/20261111_staging_schema.sql` records the complete additive schema and API hardening together in one transaction for a future empty app schema. Do not rerun it on this migrated staging project; it intentionally fails on existing model types/tables.
- Created `regpilot_staging_runtime`, restricted to CRUD on these application tables. It has no superuser, role creation, database creation, bypass-RLS, Auth-schema or legacy-table access. A role-specific RLS policy permits server access; the existing server APIs must still verify identity, membership, role and organisation scope for every request.
- The generated password is stored only as a protected Vercel preview `DATABASE_URL`. No credentials are committed. Rotate through the database and Vercel secret settings together.
- SQL verified all 48 tables have RLS, all runtime CRUD grants exist, and neither `anon` nor `authenticated` can read/write them. A real REST request using the publishable key was rejected with HTTP 401 / SQLSTATE 42501. Original prototype record counts were unchanged.

## Deployment configuration

- Preview variables are scoped to `feature/traceability-benchmark-batch-20261106` in the existing Vercel project.
- Configured the existing project's public Supabase Auth settings, the verified existing pilot email allowlist, and the restricted database URL. Enabled the workspace for this staging acceptance environment only.
- `REGPILOT_STAGING_PREFLIGHT=true` makes the build query the actual database, check all model tables, RLS and runtime privileges, exercise Prisma, and reject access to unrelated schemas/data.
- Builds now regenerate Prisma explicitly. The original Vercel build used a stale database client and failed TypeScript despite CI passing.
- The preflight uses typed PostgreSQL parameters and checks Auth schema isolation without trying to resolve a table inside a deliberately inaccessible schema.
- Paid AI, paid services, evidence upload, provider collectors and scheduled workers remain disabled.

## Verification and remaining acceptance

- Deployment `dpl_DwS9mwUZhKb5gAPovRT8m3VJeNkB` reached READY at commit `53bb68516521279cd3a08f83191cc0b75b8bfa1d`.
- Staging entry: https://regpilot-ai-qnx6-git-feature-traceabil-2f0b3f-alanscott1uk-5933.vercel.app/team/operations (Vercel protection retained).
- Live health, operations, coverage and recognition pages returned HTTP 200. Unauthenticated context/briefing requests returned 401. Browser navigation from operations to the real email sign-in form succeeded.
- Engineering CI 43048688165 and official-source probe 43048688612 passed on the deployed commit. Desktop/mobile acceptance 43048688032 was still running when this note was prepared.
- Local production build passed after the Prisma generation fix.
- Local smoke passed for 33 pages and gated APIs; isolated PDF extraction passed for ten production route packages, Word extraction for nine.
- Vercel's live database preflight passed: 48 private tables, RLS and restricted runtime role.
- Complete signed-in browser acceptance with the existing pilot owner, then a separately provisioned second account and organisation. Check Auth redirect allowlisting against the preview origin; this configuration is not exposed by the current Supabase connector.
- Private evidence needs a private bucket, server storage credential and reachable ClamAV service. Do not bypass the scanner or substitute a fake clean scan.
- Each provider needs its own restricted sandbox credentials and real acceptance. A connected ChatGPT app is not automatically a credential for RegPilot's own collectors.
- Paid AI activation needs actual provider/privacy approvals and enforceable budgets. Do not mark the governance flags reviewed without the evidence.
- Independent human usability testing still needs recruited participants; automated browser runs do not satisfy it.

## Rollback

Remove preview access or disable the preview workspace flag and redeploy if acceptance fails. The production alias was not promoted. Leave additive tables intact to preserve any pilot audit history; do not drop them as a rollback shortcut. Revoke the runtime role's login and rotate its Vercel credential if it is compromised.
