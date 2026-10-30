# RegPilot database connection guide (staging first)

RegPilot uses Prisma with PostgreSQL. The Prisma schema is in `prisma/schema.prisma`.

## Provision
1. Create a dedicated **staging** PostgreSQL database with backups enabled.
2. Store the connection string in the Vercel project as `DATABASE_URL` (server-side secret, never `NEXT_PUBLIC_`).
3. Configure a separate least-privileged runtime database user and a migration user.
4. Configure an authentication provider. A database connection by itself does not authenticate users.

## Validate
1. Run `npm ci`.
2. Run `npx prisma validate` and `npx prisma generate`.
3. Review migration differences using `npx prisma migrate dev --name initial_staging` against a disposable development database.
4. Inspect generated SQL, especially composite organisation foreign keys and evidence links.
5. Apply reviewed migrations to staging with `npx prisma migrate deploy`.
6. Test authenticated access for two independent organisations before enabling any write endpoint.

## Security gates
- No direct browser-to-Postgres connection.
- Every request must derive the user from a verified server-side session.
- Every record query must check organisation membership and role.
- Organisation IDs supplied by the browser are untrusted.
- All evidence objects must be stored privately and served with short-lived authorised URLs.
- Log write operations and evidence review decisions.
- Keep production upload endpoints disabled until isolation tests pass.

## Current state
No database credentials are present in the repository. The module record schema is committed but no staging migration or live connection has been verified.
