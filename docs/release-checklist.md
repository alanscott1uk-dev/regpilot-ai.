# Prototype release verification

## Automated checks
GitHub Actions should run:
- Node unit tests
- Prisma schema validation
- Prisma client generation
- Next.js production build

Do not claim release readiness until all checks pass.

## Browser smoke test
1. Open the deployed root page and `/prototype`.
2. Create a dummy action with a future due date.
3. Mark it complete and reload to verify browser-local persistence.
4. Export a JSON backup.
5. Delete the action, restore the backup and confirm the record returns.
6. Export CSV and check the headings and escaped values.
7. Open `/api/health` and confirm a JSON status response.
8. Check the browser console for runtime errors.

## Release limitations
No authenticated sessions, durable cloud data, verified audit trail, AI regulatory monitoring, or secure evidence uploads. Never enter sensitive or production records.
