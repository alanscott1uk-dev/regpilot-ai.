# Star Medical workflow pilot — synthetic demonstration

The fixture in `fixtures/star-medical-demo.mjs` uses **fictional actions** inspired by the operating model of a UK medical cannabis wholesaler.

It is not an authoritative licensing checklist and does not assert that Star Medical has completed, failed, submitted or obtained any regulatory requirement. Dates, completion statuses and assigned roles are illustrative.

## Test coverage
- WDA(H) application workflow
- Controlled-drug licence evidence tracking
- GDP goods-in, dispatch and traceability
- Temperature excursions
- Site security incident response
- Supplier qualification
- Mock inspection readiness

## Manual browser test
Run `npm install && npm run dev`, then visit `/prototype`.
Use the Load Star Medical demo button to replace local sample data with the eight fictional records. Check counts, completion toggles, persistence after reload, CSV export, JSON backup and restore.

## Privacy
The public repository contains no actual premises security design, contracts, controlled-drug inventories, personal details, financial information or supplier terms. Never import real confidential records into the browser-local demo.
