# Distribution and supply chain — pilot module

Route: `/distribution`

This prototype provides browser-local supplier, certification and import-planning registers. All included records are fictional. It does not upload certificate documents or verify regulatory approvals.

## Supplier qualification
- Manufacturer, exporter, wholesaler, laboratory or other supplier
- Country, qualification status and notes
- Status changes are demo-only and do not constitute formal supplier approval

## Certificates
- Evidence type, reference, expiry date and review flag
- Example categories: GMP, GDP, manufacturing authorisation, wholesale authorisation, CoA
- A checked review flag does not establish that a certificate is authentic or current

## Import planning
- Supplier, product, origin, internal reference and workflow status
- No controlled-drug permit or customs submission integration
- Marking a record Received is not evidence of lawful import, quality release or stock availability

## Next stage
Implement an import document checklist by jurisdiction and product category; capture official permit identifiers, expiry and shipment-level checks; attach verified documents with immutable audit history; support batch traceability, quarantine and release workflows; add real authentication and database storage. Confirm legal requirements for each trade route with a qualified regulatory specialist.
