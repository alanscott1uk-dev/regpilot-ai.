# UK AI, ICO and MHRA regulatory applicability assessment — 10 November 2026

**Scope:** RegPilot AI (UK SME business-compliance research, official-source monitoring, draft policy evaluation, evidence organisation and independent human review). **Status:** development risk assessment, not a legal opinion, regulator authorisation, MHRA compliance certificate or completed DPIA. Review before commercial launch and on any new AI feature.

## 1. Regulatory classification

| Area | Applicability | Current judgement | Release action |
| --- | --- | --- | --- |
| UK cross-sector AI framework | Context-specific regulator-led principles; not a general standalone compulsory AI licence | Design for safety, explainability, fairness, accountability and contestability | Document model risk assessment, change management, red-team results, human control and incident escalation |
| UK GDPR / Data Protection Act 2018, amended by Data (Use and Access) Act 2025 | Applies whenever personal data are processed. As of June 2026, DUAA data-protection provisions are in force | Users may upload sensitive data inadvertently; a checkbox is not lawful basis or DPIA | Establish controller/processor roles, privacy notice, records, lawful basis, Article 28 DPA, retention and erasure, risk-assessed international transfers, security and DPIA where processing likely high-risk |
| Solely automated significant decisions | DUAA broadens circumstances for some processing, subject to safeguards (information, representations, meaningful human intervention, contestation); special-category processing has stricter conditions | RegPilot **chooses not to support** solely automated significant decisions in its pilot | Block such purpose, test challenge/redress and human review if ever introduced; obtain specialist legal review before changing the prohibition |
| MHRA GxP / GDP / GMP data integrity | Applies to regulated businesses when RegPilot is used for GxP records or decisions in an MHRA-regulated process | **Not validated as an authoritative GxP system.** Current AI is draft-only with separately attributed human decisions | Complete customer-specific intended-use validation (URS, risk assessment, test protocol/results, traceability, access/audit trail, retention/recovery, supplier qualification and change control) before any regulated use |
| MHRA medical-device rules | Medical-device qualification depends on intended purpose, functions and real usage, not the word 'AI' | **Current nonclinical business-compliance purpose does not appear to be SaMD**, but no regulator ruling has been obtained | Reassess qualification on clinical functionality, diagnosis, dosing, prescribing or care recommendations; secure appropriate regulatory advice and conformity path before feature development or marketing |
| UK government AI Playbook | Applies particularly to public-sector organisations; useful procurement/assurance expectation rather than blanket private-SME legal mandate | Useful reference for human oversight, assurance and lifecycle governance | Document limitations, governance, performance monitoring and procurement transparency for public-sector customers |

### Authoritative current references

- UK government cross-sector approach: https://www.gov.uk/government/publications/implementing-the-uks-ai-regulatory-principles-initial-guidance-for-regulators/implementing-the-uks-ai-regulatory-principles-initial-guidance-for-regulators
- ICO on DUAA commencement, 19 June 2026: https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-what-does-it-mean-for-organisations/
- **SI 2026/425 (in force 12 May 2026):** directs the ICO to develop a code of practice for AI and automated decision-making; it does not itself certify or license private AI services. The ICO code draft was expected in spring 2027; track its publication and review requirements once issued: https://www.legislation.gov.uk/uksi/2026/425/made\n- ICO privacy by design (updated 5 February 2026): https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-by-design-and-by-default
- MHRA GxP data integrity, revision 1 March 2018: https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity
- MHRA SaMD market-entry guidance, 6 November 2026: https://www.gov.uk/government/publications/guidance-on-bringing-software-as-a-medical-device-to-market
- Government response to the National AI Commission, 6 October 2026 (proposals vs current legislation must be distinguished): https://www.gov.uk/government/publications/government-response-to-the-national-commissions-recommendations-on-the-regulation-of-ai-in-healthcare

## 2. Controls implemented in this branch

- Restricted AI purpose: only `business-compliance-assistance`; `working-draft` records only, with `synthetic` or `non-sensitive-business` declaration. All other declared purposes/data classifications fail before any paid model request.
- The caller explicitly accepts independent human review, not solely automated significant decision-making, and authorised external processing; no clinical or controlled GxP records permitted in pilot AI.
- Model instructions rule out diagnosis, prescribing, dosing, treatment, significant individual decisions, original GxP record creation, RP/QP release, regulatory signoff and MHRA certification.
- AI model output remains a draft with source-quote matching, explicit unverified semantics, independent reviewer separation, content hashes and authenticated organisation scoping, where configured.
- Environment activation now requires separately recorded `REGPILOT_AI_PROCESSOR_REVIEWED`, `REGPILOT_AI_TRANSFER_REVIEWED` and `REGPILOT_AI_INTENDED_USE_REVIEWED` attestations in addition to existing safeguard/provider/workspace gates. **Environment flags are assertions, not evidence of due diligence.**
- An authenticated source and evidence system is developed, but production integration and true validation for actual regulated records are **not demonstrated** by unit tests.

## 3. Essential pre-launch evidence and accountable sign-off

| Control | Required evidence | Owner / reviewer | Status |
| --- | --- | --- | --- |
| Intended purpose and forbidden features | Versioned intended-use statement, user instructions, clinical/AIaMD qualification assessment, change impact process | Product owner + specialist regulatory adviser | OPEN |
| Data protection | Role split (controller/processor), Article 28 DPA, privacy notices, processor list, lawful-basis analysis, DPIA screening and completed DPIA where needed | DPO/privacy adviser | OPEN |
| AI vendor assessment | Contractual data-use/training/retention/subprocessor clauses, security location, deletion, breach support, UK transfer mechanism and transfer risk assessment where required | Privacy/security owner | OPEN |
| Model assurance | Known-model version, approved use cases, source precision/recall and hallucination evaluation, prompt-injection/PII leakage testing, model change control, drift review | AI technical owner + independent evaluator | OPEN |
| GxP regulated use | Formal URS and intended-use risk classification, data integrity impact assessment (DIRA), computer system validation evidence, independent approval, ALCOA+, audit trail, time sync, disaster recovery, supplier audits | Customer QA/RP/QP or applicable regulated role | **NOT AUTHORISED** |
| Security/retention | Penetration test, role/tenant isolation, backup/restore, immutable/tamper-evident history controls appropriate to use, retention/deletion and incident plan | Security owner + independent assessor | OPEN |
| Significant decisions | Clear prohibition in product/terms/API, escalation and human-contest process if introduced | Legal/privacy lead | PILOT PROHIBITION |
| User assurance | External SME usability and accessible human-review tests; no automation default approvals | Independent testing lead | OPEN |

## 4. Product release red lines

**Never** label RegPilot 'MHRA approved', 'GxP validated', 'certified compliant', 'medically approved', or its AI model 'GDPR compliant' on the basis of this implementation. Avoid marketing that implies the system authorises WDA(H), GMP/GDP status, licensable controlled drug activity, or discharges a Responsible Person/Qualified Person's duties.

For regulated customers: distinguish **general compliance drafting** from a **validated GxP system of record**. The latter requires the user's intended-use validation and documented organisational controls, potentially more stringent security, audit-trail retention, electronic signatures and inspection support. The MHRA's GxP guidance sections 6.13 (audit trail), 6.14 (electronic signatures), 6.17 (retention), 6.19 (validation for intended purpose) and 6.20 (cloud suppliers) are explicit considerations. A test passing CI is not full CSV/CSA validation.

For clinical use: the latest MHRA guidance is dated 6 November 2026; functionality and deployment context matter more than a disclaimer. Any new diagnosis, treatment or patient-specific decision-support feature needs formal qualification assessment **before** development deployment.

## 5. Operating decision

**Approve development-only non-sensitive pilot** with current safeguards. **Do not authorise live sensitive data, GxP source records, clinical decisions, or claims of regulatory certification.** Commercial launch needs accountable legal/privacy, security and pharmaceutical GxP reviews proportionate to intended use, as documented above.

This document is a maintained engineering compliance assessment, not an attestation that the product currently complies with all applicable laws.
