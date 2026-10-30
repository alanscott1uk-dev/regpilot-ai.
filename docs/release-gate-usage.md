# Running the RegPilot release assurance gate

This is a **manual** GitHub Actions workflow, intentionally separate from normal development CI. It must not block ordinary preview builds or be interpreted as regulatory endorsement.

## How to use
1. Complete real security, privacy, validation, accessibility and regulatory review work.
2. Record each completed control in `assurance/release-evidence.json` with `controlId`, `status: "PASS"`, `reviewer`, `reviewedAt` (ISO date/time) and `evidenceRef` (stable reference to an actual reviewed report).
3. Run `node scripts/check-release.mjs` locally, or trigger the **Release assurance** GitHub workflow manually.
4. Inspect the resulting `assurance/release-report.json` artifact and outstanding blockers.
5. Keep independent security testing, human release sign-off and applicable legal/regulatory review as separate mandatory decisions.

## Current state
The evidence manifest is deliberately empty, so the gate **fails**. This is correct until tests and reviews are completed.

## Security notes
Do not commit confidential customer documents, test credentials, sensitive penetration-test findings or personal information as evidence. Use controlled private storage and reference identifiers instead. A named reviewer and evidence reference alone do not prove that a review actually occurred; evidence must be checked independently.

## Limitations
This gate checks metadata completeness and status, not the underlying validity of a report or whether an authority endorses RegPilot. Release controls are a minimum engineering checklist, not a universal legal compliance guarantee.
