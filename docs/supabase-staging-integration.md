# Supabase staging connection — 27 October 2026

Supabase project: `oellqijznylgpbwyvlde` (London).
API URL: `https://oellqijznylgpbwyvlde.supabase.co`

## Applied in staging
- Six public tables with RLS enabled.
- Membership-based SELECT policies on organisations, memberships, module records, documents, links and audit events.
- Module-record INSERT/UPDATE restricted to OWNER, ADMIN, EDITOR.
- Module-record DELETE restricted to OWNER, ADMIN.
- Documents, links, audit events: SELECT only for authenticated members.
- No anonymous grants; no self-service organisation bootstrap yet.
- Security advisor returned no findings after migration.

## Important integration constraints
The current GitHub app uses Prisma models and does not yet match the Supabase staging schema. Do not point the current Prisma client at staging or run `prisma migrate deploy` until the schemas are reconciled.

For a future Supabase client use the project URL and a publishable key. Never commit service role or database passwords. Configure authentication, session verification, organisation onboarding and secure storage before enabling customer records.

## Acceptance tests outstanding
- Sign in as two synthetic users belonging to different organisations.
- Verify SELECT/INSERT/UPDATE/DELETE cross-tenant denials.
- Verify VIEWER cannot write and EDITOR cannot delete.
- Verify no anonymous table reads.
- Test same-organisation document-action foreign keys.
- Verify auth/session handling and storage controls.

This database is staging only and must not be described as a production-ready customer backend.
