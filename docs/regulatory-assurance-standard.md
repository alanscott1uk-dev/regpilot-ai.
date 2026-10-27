# RegPilot — Regulatory assurance standard (draft v0.1)

**Objective:** Design software that supports defensible, inspection-ready compliance work. This is not MHRA or Home Office endorsement.

## Release gates
1. **Source registry:** Each rule has regulator, canonical URL, legislative/guidance classification, jurisdiction, effective date where known, checked date, reviewer, version and source snapshot/hash where permitted.
2. **Applicability:** Require business activities, licences, geography, exemptions and operational facts. Unknown facts result in **information required**, not a compliance verdict.
3. **Expert validation:** Qualified sector reviewers approve each rule and its interpretation before it can generate live obligations. Expired or changed guidance returns rules to review.
4. **Human oversight:** AI may summarise source material and propose actions, but cannot independently approve evidence, close critical findings, issue certificates or represent regulatory authorisation.
5. **Evidence integrity:** Private storage, checksums, version history, independent approval, immutable or tamper-evident audit events, retention and export verification.
6. **Security:** Two-tenant negative tests, least privilege, vulnerability scanning, incident response, restore testing and independent penetration testing before regulated pilots.
7. **Validation:** Trace requirements to tests and controlled releases. Capture expected outcomes, negative cases, deviations and sign-off.
8. **Inspection exports:** Produce timestamped manifest with evidence IDs, versions, source citations, reviewer decisions and outstanding exceptions. Exports must not be labelled regulator-approved.
9. **Monitoring:** Detect changed official sources, queue expert review, identify potentially affected organisations and record human-approved actions. Never infer changes from page timestamps alone.
10. **Regulator engagement:** Seek feedback only after independent validation. Do not use regulator logos or claim recommendation, partnership or approval without written permission.

## Initial official references
- Home Office domestic licensing: https://www.gov.uk/guidance/controlled-drugs-domestic-licences
- Home Office application guidance: https://www.gov.uk/government/publications/domestic-licensing-application-guidance
- Home Office controlled-drug security: https://www.gov.uk/government/publications/general-security-guidance-for-controlled-drug-suppliers
- MHRA manufacturer and wholesaler licensing: https://www.gov.uk/guidance/apply-for-manufacturer-or-wholesaler-of-medicines-licences

## Immediate engineering backlog
- Persist source registry and review approvals in organisation-independent controlled tables.
- Add an official-source change detection queue with reviewer assignment.
- Build read-only regulatory evidence links into actions; keep rule publication disabled until reviewed.
- Add tests for source provenance, jurisdiction, unknown applicability, access denial and version supersession.
- Add a clearly visible **Not regulator-endorsed** disclosure in relevant modules.

All four seed controls are **PENDING_EXPERT_REVIEW**. They are not legal determinations or deployable compliance certificates.
