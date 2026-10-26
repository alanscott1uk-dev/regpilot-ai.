# RegPilot AI

Early-stage compliance workflow prototype for regulated UK businesses.

## Current functionality

- Add, search, filter, update and delete demo compliance actions
- Assign owners, categories, due dates and notes
- Dashboard counts including overdue actions
- Export filtered records to CSV
- Browser localStorage persistence (single-device demonstration only)

## Run locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Visit http://localhost:3000.

## Important limitations

**Not production-ready.** No login, permissions, server database, audit trail, backups, evidence uploads or AI integration. Data is saved only in the browser's localStorage and may be lost. The initial example tasks are illustrative, not authoritative regulatory obligations. Do not enter patient, employee, sensitive or real customer data.

## Next engineering milestones

1. Secure authentication and organisation-level access control
2. Server database, migrations and input validation
3. Tamper-evident audit events and evidence attachments
4. Regulatory source tracking, review workflow and tests
5. AI-assisted drafting with human approval and source citations

## Try the interactive prototype

Run `npm install && npm run dev`, then open:

- `http://localhost:3000/` — obligation register demo
- `http://localhost:3000/prototype` — minimal action tracker with browser-local persistence and JSON backup

The standalone HTML demo can also be distributed separately for offline evaluation.

**Security:** These prototypes have no production authentication, encrypted cloud storage or verified audit trails. Do not enter real regulated or sensitive data. The Prisma backend modules are not yet exposed through authenticated routes.

## Release checklist

- [ ] Install dependencies and confirm CI build passes
- [ ] Browser smoke-test action creation, updates, deletion and export
- [ ] Configure real authentication and organisation membership
- [ ] Run PostgreSQL migrations and cross-tenant tests
- [ ] Implement evidence upload security and durable audit storage
- [ ] Deploy to an approved hosting environment

## Star Medical pilot scenario

Open `/prototype` and select **Load Star Medical demo**. This replaces local demo actions with eight fictional regulated-distribution workflow examples. Export your existing JSON backup first if needed.

The public repository contains only synthetic examples. The fixture does not disclose actual Star Medical security, supplier, financial or licensing records, and is not a verified MHRA/Home Office checklist.

Run `npm run test` to execute the fixture, backup and obligation unit tests. A successful CI build and manual browser test are still required before describing the hosted prototype as verified.
