# RegPilot private database — pre-deployment release gate

**Deployment state:** The previous code batch was deployed on 7 November 2026, with private services inactive. No hosted schema migration has been executed. Team-access changes are development code awaiting service acceptance.

## Why this matters
RegPilot accesses its PostgreSQL tables from server-side Prisma through an administrator-managed connection. Supabase exposes the **public** schema to its Data API under some settings; a direct publishable-key request must never read sensitive workspaces.

To protect this integration until properly reviewed row-level, role-specific policies exist, \`security/supabase-private-tables.sql\` enables RLS on **all 32 current private app tables** and REVOKES direct privileges from \`PUBLIC\`, \`anon\`, \`authenticated\`, and \`service_role\` (when present). There are **no public read/write policies**. It is intentionally default-deny.

The privileged Prisma database connection can bypass ordinary row-level restrictions when using an owner/bypassrls role. For this reason, **each API route must still enforce verified identity, organisation membership, roles and organisation-scoped query filters**. These SQL guards do not make the app fully tenant secure on their own.

## Offline validation
GitHub Actions uses a disposable PostgreSQL 17 service. After \`prisma db push\`, it creates temporary test roles, executes the SQL and runs \`tests/private-tables.integration.test.ts\`, checking:
- Every model table exists and has RLS enabled.
- No anon, authenticated, or service_role SELECT, INSERT, UPDATE or DELETE grants.
- No policies open these tables to API clients.
- Existing direct database integration tests still pass with tenant filters.

No confidential records are used.

## Applying to a real staging environment (future work)
1. Restore Supabase staging to a working state. Back up all existing data and review current grants/policies before changing anything.
2. Generate a **versioned, reviewed Prisma migration** for the app's actual schema. Do not run \`prisma db push\` on customer data or use this SQL as a schema migration.
3. Apply the schema migration, inspect tables, then apply \`security/supabase-private-tables.sql\` with authorised DBA credentials.
4. Repeat the no-grants and tenant-access tests, including verification via REST using an actual publishable key and signed-in token. Confirm that direct server-side Prisma calls still work without cross-organisation access.
5. Review future schema changes so every newly introduced table gets RLS and appropriate grants *before* it can be exposed.
6. Decide whether to disable Supabase Data API entirely for this project: only Auth and direct server-side Prisma are currently intended. This setting should be reviewed in Supabase Dashboard rather than assumed.

**Do not** run these operations against Supabase until the staging connection, backups, and release authorisation are verified. In particular, this script must not be used to introduce privileged browser access or bypass Supabase Auth's own schemas.
