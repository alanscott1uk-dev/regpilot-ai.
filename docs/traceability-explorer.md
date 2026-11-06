# Traceability Explorer — demonstration module

Location: \`/traceability\` (development branch only until intentionally released).

Data sources are browser-local obligation records, control links, document metadata and manually recorded regulatory decisions. A limited GOV.UK metadata request helps compare publication versions when sources are available. No AI interpretation takes place.

## Workflow
1. Select an obligation/task and inspect its user-recorded source URL and source-check date.
2. Inspect operating controls linked to the task, including shared documentation links reused across other tasks.
3. Inspect the actual document **metadata** record: review date, user-entered approval label, and whether a file is flagged as attached. No contents, hashes, signatures or storage security are tested.
4. Review detailed gap explanations and click through to edit the original record.
5. Export a CSV or JSON snapshot if necessary. Reports are not regulatory compliance declarations.

## Accuracy safeguards
- Never count evidence attached through a Designed, Under Review or Retired control as current operational evidence.
- Never claim that missing a source link is proof of legal non-compliance: internal tasks may not have an external source.
- When a previously reviewed official source is unavailable, do not assume a newer regulation exists.
- If an official publication's metadata version changes, prompt human review, not automatic legal action.
- A source-check date older than 90 days is a **maintenance reminder**, not proof the source is incorrect.
- Duplicate identifiers, stale document links and missing control references are surfaced separately from regulatory findings.
- No score implies audit readiness or legal compliance.

## Shipping requirements
Authentication, tenancy, protected file storage, encryption, malware scanning, trustworthy review histories, completeness and accuracy benchmarks, legal review and accessibility testing remain prerequisites before real customers use the system.
