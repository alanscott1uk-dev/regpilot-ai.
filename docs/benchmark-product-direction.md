# RegPilot AI — November 2026 benchmark and next-stage product plan

Historical development notes follow. For the latest implemented workflow and measurable acceptance criteria, see [Coordinated change response](coordinated-change-response.md), [Audit periods and wider coverage](audit-period-and-coverage.md) and the current [release checklist](release-checklist.md). Earlier “not implemented” entries describe their original batch, not the current branch.

**Current technical baseline — 20 November:** [Competitive technical specification](technical-spec-20261120.md) records the new file questionnaire, contextual answer reuse, evidence-grounded drafting and durable processing capabilities, plus the remaining advanced-feature and infrastructure requirements. The current user priority is advanced capabilities and infrastructure first, then workflow refinement. Historical snapshots below must not override that direction or be reused as current implementation status.

## Vanta comparison from the supplied screenshots · 20 November 2026

Vanta presents three customer jobs on mobile. Compliance shows a framework’s completion, number of tests and last refresh. Risk shows counts in an inherent-risk heatmap. Proof lets a customer request access to a Trust Center, ask a question and inspect published controls. The illustrated 87%, 115 tests and three-minute refresh are example dashboard values. The demo page advertises 400+ integrations, 35+ frameworks and 16,000+ customers. These are vendor-reported figures. The demo form also identifies vendor risk, questionnaire automation and US federal frameworks as buying needs, including CMMC, FedRAMP and NIST. Pricing is by quotation.

| Vanta plan | What the buyer sees |
| --- | --- |
| Essentials | One framework, policy generation and templates, AI questions spanning policies, controls, frameworks, tests and documents, evidence checks and collection, ongoing control monitoring, audit reporting, an auditor API, a Trust Center and access to expert partners. |
| Plus | Policy onboarding, access requests and reviews, and 25 automated questionnaires per year. The supplied capture also puts policy-to-control mapping, change summaries and SLA tracking with remediation here. |
| Professional | The capture shows advanced control and AI-assisted issue management. The pricing page also lists 144 questionnaires per year, custom monitoring tests, automated access management, expanded risk reporting and an advanced Trust Center. |
| Enterprise | A configurable governance, risk and compliance package. Scope and price require a quote. |

The live Essentials listing also includes policy-to-control mapping and SLA remediation. The capture places these under Plus, so their tier needs confirmation before a purchasing comparison. [Vanta plans and pricing](https://www.vanta.com/pricing)

| Capability | RegPilot evidence on PR #10 | Comparison to demonstrate |
| --- | --- | --- |
| AI across the workspace | The preview answers UK guidance questions with verified quotations. The branch also has separate private company knowledge search and questionnaire drafting. | From one question, retrieve the current approved SOP, its mapped control, the latest authorised evidence and the official UK passage. Show which source supports each statement. |
| Continuous monitoring and framework coverage | The branch records source checks and connector evidence. The preview catalogue contains 51 official publications. | For each supported framework, show applicable controls, passing and failing tests, collection failures and last successful checks. Count integrations with repeatable live evidence collection and frameworks with reviewed control mappings. |
| Risk and customer assurance | The branch has inherent and residual risk ratings, treatment records and private assurance rooms. | Demonstrate drill-down from a risk heatmap to the exact control and evidence. From the customer side, test requesting access, asking a question and seeing only approved material. |
| Questionnaires and access governance | The branch supports questionnaire intake, grounded drafts and response packs. | Measure reviewer correction rates and completion time on real formats. Assess recurring access reviews, requests and remediation separately from questionnaire throughput. |

**UK pharma acceptance question:** “What does our temperature-mapping SOP require, and do we have current evidence for the cold room?” Run it against two isolated test organisations. One has an approved SOP, an obsolete revision and a current mapping report. The other has no report. The answer should cite the approved revision and report, distinguish company procedure from MHRA guidance, and identify missing evidence in the second organisation. A reviewer with restricted access should see only records they can open. Repeat with “temperature mappping” and “standard operating procedures”. This is a proposed test for the next build.

RegPilot baseline: [preview application commit](https://github.com/alanscott1uk-dev/regpilot-ai./commit/1510964dc90eb8d3f119e5d9b38bebbfd7387531) · [22 live search checks](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/44783048904).

## Cross-sector acceptance on PR #10

| Business question | Feature to exercise | Evidence required |
| --- | --- | --- |
| Who owns the risk from a payroll supplier retaining access? | Search supplier, control, access campaign and risk metadata. Open the risk register from its inherent likelihood and impact. | A matching risk opens in the correct organisation. A second organisation cannot see the result. |
| Which controls or collections need review before our customer audit? | Choose controls, evidence connections, audit requests and questionnaires in Reports. Filter for attention and export those checks. | Export has separate record and exception counts. Empty scopes are identified. A bookmarked view recalculates counts on refresh. |
| Which published procedure supports a claim in a tender? | Compare official passages with the current private procedure revision and reviewed evidence. Select the tendered product to restrict documents. | A superseded policy file cannot return as supporting evidence. Organisation-wide operational records are omitted in product scope. |
| Which training, regulatory changes and corrective actions concern a topic? | Search across training curricula, change responses, quality cases and requirement references. | Matching records display their type, recorded status and workspace destination. |
| Is there a mapping report for a particular storage location? | Restrict private evidence by site or asset. | Cold Room 1 and Cold Room 10 return different evidence. A passage match still requires a review of report date and coverage. |

These branch features cover workspace discovery and reporting. The control workspace also runs a versioned Open Policy Agent test over active connections mapped to a chosen control. An administrator sets the minimum number of distinct providers. The downloadable decision records its threshold, test time, source and compiled policy fingerprints, control version, evidence observation IDs and integrity-checked hashes. Findings, missing or stale evidence, insufficient provider diversity and a met target have separate results. The same policy can be rebuilt with `OPA_BIN=/path/to/opa bash scripts/build-control-policy.sh` using OPA 1.22.4. Full competitive comparison still requires live integration coverage, maintained framework mappings, independently scored answer quality, scheduled custom tests and remediation, and end-to-end customer and auditor trials.

## Active competitor-derived development choices — 19 November 2026

The user direction is to use the strongest competitor capabilities as the product baseline, then improve the experience for RegPilot's UK SME customers. Compare the complete customer job, implement the missing workflow, and retain its acceptance evidence. Do not count an existing module again as a new capability or infer superiority from a feature list.

| Priority | Current official benchmark | Concrete RegPilot gap and development decision |
| --- | --- | --- |
| Company-wide evidence library | [Drata Controls and Evidence](https://drata.com/products/compliance/controls-and-evidence) describes central storage, linked reuse and readiness visibility. | Existing cross-task reuse was difficult to discover from the task-first Evidence screen. Implemented company search/filter/pagination, exact original and assessment-use visibility, and an explicit canonical-file handoff into a source-task assessment. The 647b23b browser and actual-service acceptance passed without duplicate upload and with company/task/review authority preserved. |
| Guided starter programme | [ISMS.online Platform](https://www.isms.online/platform/) describes templates, guided methodology and in-platform support; [Vanta Automated Compliance](https://www.vanta.com/products/automated-compliance) describes a first-login-to-audit roadmap. | Implemented three original operational packs with editable task selection, scope rationale, member owners and target dates. A no-write preview and explicit confirmation create one atomic, replayable task set per pack/company. Exact tasks use the existing evidence completion workflow. These are practical starter plans, not imported document controls, licensed standards text or complete regulatory coverage. |
| Owned internal risk lifecycle | [Drata Risk](https://drata.com/products/risk) describes risk scoring, ownership, control links and remediation. | Implemented owned internal risks, reasoned likelihood/impact ratings, existing-control links and existing/new owned treatment tasks. Residual proposals require current verified completion receipts and original reviewed files, followed by a different eligible administrator. Changed context invalidates current reliance while preserving decision history. Exact risk/task navigation and JSON export retain the recorded basis; completion does not automatically lower the score. |

Official product descriptions were checked on 19 November 2026. They establish relevant vendor-offered capabilities; they do not independently establish product quality, customer outcomes or comparative performance. Current development evidence and remaining release gates are maintained in [product-completion.md](product-completion.md) and [PR #10](https://github.com/alanscott1uk-dev/regpilot-ai./pull/10).

## Competitive benchmark

- **Vanta**: strongest overall product model for connected compliance operations, automated testing, evidence workflows, integrations and a polished interface. Reference: https://www.vanta.com/products/automated-compliance
- **CUBE RegPlatform**: benchmark for continuous regulatory intelligence, verified source lineage, applicability, obligations, impact and audit-ready decisions. Reference: https://www.cube.global/products/regplatform
- **Sprinto**: benchmark for guided task execution, evidence gap analysis, templates, auditor workflows and remediation automation. Reference: https://sprinto.com/pricing/
- **ISMS.online**: useful UK-market reference for guided onboarding, sector-relevant guidance and connected management frameworks. Reference: https://www.isms.online/platform/

## RegPilot positioning

UK SME-first, cross-sector compliance operations with plain-language action guidance; broad coverage must be built incrementally, not promised before verified content exists. Do not imply regulatory completeness or accuracy without source coverage, monitoring SLAs and expert review.

## Shipped in this iteration

1. Redesigned premium responsive command centre (dark-violet hero, genuine metadata coverage ring, explicit demo indicator, simplified actions).
2. Official source-watch signal on the home screen (live metadata check, not legal change verification).
3. Regulatory intelligence inbox with source-version keyed human applicability assessment (not auto-classification), impact rating, owner and target date.
4. Conversion of an approved-by-user "action required" assessment into a draft work item linking the primary source and user-entered review date.
5. Unit tests for source URL restrictions, review versioning, applicability rationale and action creation.

## Remaining gaps to meet Vanta / CUBE / Sprinto

### Priority 0 — prerequisite for live use
- Trusted user sessions, tenant membership, least privilege and cross-tenant tests.
- Persistent PostgreSQL records with versioned migrations and reliable backup/restore.
- Protected evidence storage, malware scanning, immutable artifact hashes, retention policies and signed file access.
- Server-side append-only/tamper-evident audit history and reviewer approvals.
- Security, privacy, accessibility, production monitoring and incident-response readiness.

### Priority 1 — genuinely useful AI engine
- UK primary-source ingestion by regulator and sector, with licensing, version identification and publication metadata.
- Human-reviewed applicability and effective date extraction; evidence and source passage citations.
- Document parsing and requirement-to-control mapping with uncertainty indicators.
- Draft corrective actions, reusable evidence mapping, version comparisons and owner confirmation.
- No automatic "compliant" verdicts or silent changes to source-to-obligation relationships.

### Priority 2 — market differentiation
- Plain-English onboarding for UK sole traders, SMEs and regulated specialists.
- Sector-pack rollout only after professional verification (initially one focused pack, then adjacent industries).
- API connectors, scheduled notifications, reviewer portals and audit exports.
- Published pricing and onboarding cost lower than enterprise-focused providers.
- Usability test with non-technical operators: create a task, review a source, link evidence, record outcome without training.

## Truthful product metrics
The command-centre ring means **percent of work items with document metadata marked as current, approved and containing an attachment**. It is not a compliance rate, a file-integrity check, or a real-time risk score. The official-source signal reports publication metadata only and does not identify legal amendments or guarantee completeness.

## Release gate
No real customer, supplier, employee or patient data until secure backend and validation gates above are completed. The staging Supabase project was discovered but returned connection timeouts; no database or security configuration was changed in this iteration.


## Revised competitive benchmark — testable outcomes (November 2026)

The reference products are Vanta (automated controls and shared evidence), Sprinto (guided remediation and evidence automation), CUBE (source-to-obligation lineage), and ISMS.online (first-time user support).

**Do not describe RegPilot as better than these products without independent side-by-side testing.**

| Dimension | Objective test | Target | Current RegPilot |
| --- | --- | --- | --- |
| First use | New nontechnical operator creates task, links document, maps control, reviews gaps | <=10 minutes without instructions | Guided demo only; no independent test |
| Traceability | Open task -> reference -> control -> evidence -> issue | 100% of recorded links explorable | New traceability explorer, local metadata |
| Reuse | Connect one relevant file to 2+ actions with shared control | One file referenced, not duplicated | Implemented for operating controls in demo |
| Data integrity | Remove linked item; inspect alerts | 100% broken links surfaced in tests | New reference checks, unit tested |
| Source provenance | Source version changes or fetch fails | Version change requires review; outage never called a regulatory change | Limited GOV.UK metadata comparison |
| Human review | Convert decision to task and generate review pack | No silent approval, audit attribution | Manual local decision, no authenticated reviewer |
| AI accuracy | Compare verified obligations against document with cited passages | Precision/recall measured by expert-labelled sample | Not implemented |
| Security | Separate two organisations | No cross-tenant reads/writes | Not implemented; production blocker |
| Evidence authenticity | Tampered document or stale upload | Hash verification + malware checking | Not implemented; local attachment flag only |
| Notification | Important confirmed publication changes | Time-based alerts with delivery logs | Not implemented |

### Current development batch
- Source-to-action-to-control-to-evidence traceability explorer.
- Records unresolved issues in plain English and links to the relevant editing screen.
- Catches duplicated identifiers, deleted linked records, overdue action dates and recorded source checks older than 90 days.
- Exports reviewable CSV/JSON **without asserting audit certification**.
- No new production deploy until the wider, secure multi-tenant batch is finished and validated.

### Cost constraint
Vercel preview deployments are disabled for the linked project during development to conserve the plan's limits. Development is verified using GitHub Actions; production deployment remains a separately controlled milestone. Check these project settings before a later release.

## Substantial pre-Vercel implementation batch

- Private Evidence Vault: scanned PDFs, private object storage, real hash checked retrieval, quota, separate human review, organisation access and actual task links.
- Manual GOV.UK text snapshots: exact source IDs, content hashes and passage-level diff, persistent history, explicit review outcomes and manually-created team follow-up tasks.
- AI Studio can use a private Evidence Vault PDF via authenticated server fetch and SHA verification (2 MB AI cap, 5 MB vault upload cap).
- Offline CI includes three disposable Postgres integration suites plus a synthetic ClamAV protocol test. No Vercel previews required.
- **Remaining gap against Vanta/Sprinto/CUBE:** live provider integration, enterprise scale and monitoring, autonomous updates, validated AI output, legal coverage, robust privacy/data retention and real-user testing.

Do not release customer uploads until staging, privacy, scanner and recovery tests are complete.
