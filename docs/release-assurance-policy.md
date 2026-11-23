# RegPilot — Regulatory and security release policy

Status: DRAFT. Applies to private beta, regulated pilot and production releases.

## Scope
RegPilot is a compliance management and intelligence platform, not a regulator, law firm, certification body or guaranteed legal compliance service. No MHRA, Home Office or other government endorsement may be claimed without written confirmation.

## Release approval
- Maintain a requirements register with source, owner, jurisdiction, version and applicable controls.
- Attach independent reviewer, timestamp and verifiable evidence to each release control.
- Fail closed when evidence is missing, stale or a test fails.
- Record known limitations, residual risks, deviations and an accountable release decision.
- Distinguish technical release approval from legal/regulatory certification.
- Obtain qualified legal and sector-expert review for applicable requirements.

## Data protection
- Document controller/processor roles, lawful bases, purposes, retention and subprocessor arrangements.
- Complete a DPIA where required by risk, and establish data-subject request and breach-response processes.
- Apply privacy by design, data minimisation and secure deletion.
- Review international transfers and customer contractual commitments.

## Security
- Threat model, authentication and least-privilege controls.
- Two-tenant negative tests and secure file storage.
- Supply-chain scanning, independent penetration testing, audit logging, backups and restore drills.
- Incident response, monitoring and vulnerability remediation with ownership and timelines.

## AI and regulatory content
- Human-approved source registry and applicability rules.
- Source freshness, effective dates, jurisdiction and exemptions.
- No autonomous licence determinations, legal certification or evidence approval.
- Record model/provider version, prompts, source references, reviewer overrides and known limitations where appropriate.

## Accessibility and commercial controls
- WCAG 2.2 AA design target, keyboard and mobile tests.
- Transparent pricing, contractual terms and support commitments.
- Avoid representing ISO 27001, SOC 2, Cyber Essentials or any other assurance as obtained until independently evidenced.

## Exit criteria
A release cannot be described as customer-ready merely because the application builds. Documented security, functional, regulatory and privacy checks must be passed. The code-level release gate is a tracking aid; human review and independent testing remain essential.
