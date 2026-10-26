# Backend integration status

The Prisma client, organisation authorisation helper, and obligation service have been added. They are **not connected to HTTP endpoints or the dashboard**. No production database has been configured.

Before enabling API routes:
1. Configure a trusted authentication provider and verify sessions on the server.
2. Resolve the active organisation using verified membership; never trust client-supplied actor identity or roles.
3. Run and verify database migrations against a configured PostgreSQL instance.
4. Add cross-tenant integration tests, concurrency controls, rate limiting and request validation.
5. Make audit records append-only or externally verifiable before compliance-grade claims.
6. Add evidence storage, access controls and backup/recovery procedures.

Do not use real customer, patient or confidential data in the demo.
