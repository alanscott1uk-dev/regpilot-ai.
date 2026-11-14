# MHRA Innovation Office — proposed enquiry (DRAFT, NOT SENT)
**Prepared:** 11 November 2026
**To:** InnovationOffice@mhra.gov.uk
**Subject:** Regulatory guidance request — RegPilot AI non-clinical compliance intelligence and potential GxP computerised-system use

Dear MHRA Innovation Office,

We are developing **RegPilot AI**, a UK-focused software platform intended to support small and medium-sized organisations with regulatory intelligence and controlled business-compliance workflows. An intended customer group includes pharmaceutical manufacturing and distribution businesses operating under GMP and GDP requirements.

Our purpose at this development stage is **not** to diagnose, treat or advise individual patients, issue prescriptions, provide dosing recommendations, release products, make an RP/QP decision or automatically determine statutory compliance. RegPilot is designed to identify potentially relevant official publications, compare recorded text changes, prepare draft procedural and evidence-review suggestions, assign follow-up work and retain explicit human-review decisions. We are intentionally prohibiting clinical, patient-record and regulated original-GxP-record use within the existing AI pilot.

We are seeking **regulatory guidance, not an MHRA approval or endorsement**. We wish to establish the correct formal route early, before expanding into pharmaceutical operational use.

We would appreciate advice on the following:

1. **Non-clinical software boundary.** Does the described intended use indicate that RegPilot is ordinarily outside the current software-as-a-medical-device qualification pathway, provided it remains non-patient-specific? We recognise classification depends on intended purpose and actual functions; please refer us to the appropriate medical-device enquiries service for any formal question of qualification.
2. **GxP computerised-system controls.** If an MHRA-licensed manufacturer or wholesaler chooses to use RegPilot for quality-system oversight, SOP management or evidence tracking, what additional validation, integrity, supplier and record-lifecycle expectations would typically fall on that licensee and on its software supplier? We are reviewing the MHRA GxP Data Integrity Guidance and relevant computerised-system controls.
3. **Vendor validation evidence.** Is there any MHRA-recognised assessment, advice, or inspection route available to a software-only supplier seeking to demonstrate its readiness for pharmaceutical use, distinct from the regulated company's own risk-based intended-use validation? If there is no standalone product approval, we would welcome confirmation of the correct evidence-led approach.
4. **Future functions.** If we later contemplate regulated electronic signatures, controlled original quality records or AI-assisted product-quality decisions, which team should advise on the change in intended use and required quality controls before development or deployment?
5. **Appropriate contact.** If these questions are outside the Innovation Office's remit, would you kindly direct us to the appropriate MHRA inspectorate, regulatory advice or medical devices team?

At present, RegPilot is a **development platform**, not a deployed validated pharmaceutical system. Security controls include organisation-scoped access, audit events, recorded source provenance, integrity checks and independent human review. Some external integrations and AI processing are intentionally disabled pending security, data-protection and provider assessments. We are preparing a formal user requirements specification, GxP impact/risk assessment, verification traceability and supplier validation documentation, but no such material has yet been independently approved as a completed GxP validation.

We can supply a concise intended-use and technical architecture pack to assist your triage. Please let us know the most appropriate submission route.

Kind regards,

RegPilot AI project team

---

## Technical annex — draft version 0.1

### Intended functionality (in development)
- Periodically retrieve exact official UK publication text from an allowlisted catalogue and retain dated source fingerprints.
- Record and compare source text versions; explicitly separate changed text from changed law or established obligations.
- Suggest potential regulatory applicability from an SME's declared activities and UK nations, with human review of territory, legal status, exceptions and effective dates.
- Let staff create owned corrective actions and link reviewed documents to controls and source records in tenant-separated workspaces.
- Allow AI to propose non-binding findings and amendments to **non-sensitive business working drafts** only, with independent review and recorded uncertainty; no automatic external filings or approvals.
- Use restricted, read-only evidence connectors only after tenant consent, target verification and provider acceptance; do not imply an observation is compliance.
- Compile owner-assigned assurance/evidence reports for human review.

### Explicit exclusions in the present pilot
No patient/clinical decisions or identifiable patient records; no medical prescribing or dosage recommendations; no batch or medicinal-product release; no Responsible Person or Qualified Person decisions; no controlled original GMP/GDP records; no solely automated legally significant decisions; no claim of MHRA conformity assessment, validation or authorisation.

### Expected regulated-user validation topics (for MHRA advice)
- URS and intended-use / impact classification.
- Supplier qualification and control over AI provider, subprocessors and international transfers.
- Data integrity assessment (ALCOA+), audit attribution, original records/true copies, timestamps, access rights, review, retention and export.
- Computerised-system specification, risk-proportionate testing/requirements traceability, configuration/change control, and evidence of independent QA sign-off.
- Incident/change/deviation/CAPA governance, recovery, continuity, data lifecycle and customer SOPs.
- Treatment of model outputs as draft proposals, model-version governance, prompt-injection protection, monitoring and meaningful human oversight.

### Technical evidence status
The development branch contains a tested application with official source monitoring and evidence workflow prototypes. Public retrieval probes and CI tests are **engineering verification**, not MHRA approval or successful customer-specific computerised-system validation. Paid-model usage, regulated sensitive inputs and production deployment are not authorised by this enquiry.

### Official contact and reference URLs
- MHRA Innovation Office: https://www.gov.uk/government/groups/mhra-innovation-office
- Innovation Office guidance: https://www.gov.uk/government/publications/mhra-innovation-office-guidance-and-support/mhra-innovation-office-guidance-and-support
- MHRA GxP data integrity guidance: https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity
- MHRA general medical-device classification enquiries: info@mhra.gov.uk (per the current MHRA Innovation Office guidance)
- MHRA SaMD guidance: https://www.gov.uk/government/publications/guidance-on-bringing-software-as-a-medical-device-to-market

**Not submitted. Review intended purpose, legal entity, sender details and any confidential information before external transmission.**
