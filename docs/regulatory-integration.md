# Regulatory-source integration — Phase 1

RegPilot AI retrieves **public publication metadata** from GOV.UK's Content API for selected MHRA and Home Office sources. It is not connected to private regulator licensing systems.

## Implemented
- Server-side read-only retrieval of three fixed GOV.UK pages
- Explicit source allowlist (no user-supplied fetch URLs)
- Timeout and failure handling
- Source directory at `/regulatory-sources`
- JSON endpoint at `/api/regulatory-sources`
- Link to original official pages and last-check timestamp

## Not implemented
- Automated comparison of saved publication versions
- Complete MHRA/Home Office regulatory coverage
- Verified change classification or legally binding deadlines
- AI impact assessment or automated creation of obligations
- MHRA WDA(H) or Home Office licensing portal integration
- Durable monitoring history, scheduled polling or alert delivery

## Next stage
Add durable version snapshots and a scheduler, calculate changes from canonical content hashes, queue proposed impact reviews, and require human approval before any action becomes a compliance obligation. Monitor official safety notices separately and establish coverage tests and update-frequency expectations.

GOV.UK Content API documentation: https://content-api.publishing.service.gov.uk/
Home Office controlled drugs guidance: https://www.gov.uk/guidance/controlled-drugs-domestic-licences

The public API may be incomplete for some dynamically generated pages and does not directly provide all attachments.
