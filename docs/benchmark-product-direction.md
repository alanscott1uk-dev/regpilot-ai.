# RegPilot AI — November 2026 benchmark and next-stage product plan

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
