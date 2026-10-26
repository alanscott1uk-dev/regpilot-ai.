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
