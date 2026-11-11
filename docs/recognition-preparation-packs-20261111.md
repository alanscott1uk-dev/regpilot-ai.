# Recognition assessment preparation packs

## Purpose and boundary
This development feature prepares a **private external-assessment evidence pack**. It does not submit an enquiry, change public certification status, contact an authority, validate a pharmaceutical installation or award a certificate.

## Workflow
1. In **Recognition readiness**, an owner/administrator creates the relevant evidence action.
2. Attach working evidence to that action using the existing private evidence vault. An independent authorised reviewer must approve each file after its malware and stored-byte checks.
3. Select **Prepare assessment pack**. Choose the files explicitly: nothing is preselected. Pending, rejected, quarantined and self-approved evidence cannot be selected for export.
4. Preview the selected evidence. The preview binds the organisation, exact action, action state, requirements, approved file identities and review versions to a SHA-256 digest.
5. Confirm authority to download the private evidence. Export re-reads the source files, verifies their hashes and lengths, then repeats the authorisation, action and evidence checks before releasing the archive.
6. The browser checks the downloaded ZIP against the server-provided archive SHA-256 before saving it. A changed account, sign-out or organisation change invalidates the relevant client requests.

## Archive contents
- `README.txt`: preparation-only scope and disclosure cautions.
- `manifest.json`: package ID, timestamp, preparer, organisation/action scope, preview hash, selected file paths/hashes/review versions, and unassessed preparation requirements.
- Selected original file bytes, using server-generated safe filenames.

Every requirement remains `NOT_ASSESSED`; a file's presence or internal approval is not evidence that it satisfies a requirement. `externallySubmitted`, `externallyCertified` and `requirementCoverageAssessed` remain false. The public recognition register is unchanged.

## Limits and controls
- Maximum 10 explicitly selected files and 15 MB source bytes per archive.
- Only evidence attached to the exact selected action in the authenticated organisation is eligible.
- Candidate display is limited to the most recent 100 files and explicitly discloses that limit.
- Owner/admin checks use current database membership; a client role is not sufficient.
- Stale preview, changed review version, wrong organisation/action, file corruption or permission revocation blocks export.
- A successful export creates `recognition.preparation_package_exported` with the package ID, preview and archive hashes, selected IDs and `notAnApproval: true`. No file bytes are copied into the audit event.
- Downloads are private and uncached. No signed public storage URLs are issued.
- The pack must be reviewed for recipient/disclosure suitability before the user shares it. Export is not a formal regulatory submission or an independently approved disclosure.

## Engineering checks
`tests/recognition.integration.test.ts` exercises disposable PostgreSQL, fictional PDF bytes and injected private storage: selection eligibility, tenant separation, duplicate-task protection, preview binding, exact ZIP contents and hashes, tamper rejection, review changes during retrieval, and authority revoked during retrieval. `tests/request-scope.test.mjs` covers stale reads, sign-out, same-organisation account replacement, and A-to-B-to-A transitions.

These checks do not replace live Supabase/storage acceptance, external penetration testing, qualified pharmaceutical validation, regulatory advice or recruited human usability testing. No hosted database migration, paid-service activation or production deployment is part of this batch.
