# RegPilot private evidence and regulatory-change systems

## What is built in the development branch

### 1. Evidence Vault
- Organisation-protected PDF upload endpoint and a responsive Evidence Vault page linked from team tasks.
- PDF signature, extension, EOF marker and 5 MB size enforcement.
- Mandatory ClamAV INSTREAM scan before any file is uploaded. A missing, timed-out, infected or erroneous scanner verdict fails closed.
- A pre-existing private Supabase Storage bucket, server-only secret key and server-generated organisation-prefixed object keys. Storage public buckets are rejected before upload or retrieval.
- Real SHA-256 digest calculated from uploaded bytes and checked again against retrieved bytes and size for each authorised download.
- Atomic per-organisation quotas of up to 120 files and 100 MB, with best-effort deletion of objects if DB transaction fails.
- Independent evidence decision: uploader cannot approve own evidence; Owner/Admin reviews with a rationale, status, version check and audit event.
- Private attachment downloads; no public object URLs, no user-supplied bucket key or credentials.
- Evidence records use actual PostgreSQL associations, not browser-only attachment flags.

### 2. Official source version history
- Four pre-allowlisted GOV.UK Content API publications, selected and fetched server-side using an exact source ID.
- Authorised operators manually capture a text baseline, compute a SHA-256 fingerprint, compare subsequent content and view added/removed text passages.
- Repeated checks inside 15 minutes are skipped, rather than refetching the publication.
- Different official metadata alone does not count as a legal or publication text change.
- Every new textual version is held as an organisation-specific snapshot with status NEEDS_REVIEW.
- A different Owner/Admin must record the human source decision and a written rationale.
- A human can explicitly create a follow-up task with the original source attached.
- This is manual tracking, not automated full UK regulatory coverage, legal change detection or effective-date interpretation.

### 3. Genuine AI connection to evidence
- A user may navigate from an Evidence Vault record to AI Studio, give explicit external-processing consent, and run an analysis against the authenticated server-side PDF bytes.
- The AI route checks the organisation membership and verifies the stored SHA-256; files are never exposed through a public download link.
- AI supports private evidence PDFs up to 2 MB and rejects larger files; the vault itself accepts PDFs up to 5 MB.
- No AI processing of real confidential or sensitive records is authorised until processor and security review.

## Offline checks
- Unit tests use a simulated ClamAV TCP service to verify clean, infected and error results; PDF detection and digest utilities are tested.
- Disposable PostgreSQL integration tests use an isolated in-memory object-store test adapter, verifying quota, tenant access, sha mismatch blocking, review version and independent approval checks.
- Regulatory-source DB tests use fictional publication bodies to verify baseline, unchanged metadata, changed body, cross-tenant denial and review conflicts.
- Next.js local smoke checks key routes and confirms protected APIs fail closed when disabled.
- GitHub CI is the release gate; Vercel preview deployments remain disabled. These tests do NOT prove the real Supabase Storage or ClamAV network connectivity.

## Pre-release requirements
1. Restore Supabase staging and produce a reviewed versioned migration, backup/restore process and rollback plan; no migration has been applied to actual staging.
2. Provision a private Storage bucket with size and MIME restrictions. Verify the bucket is not public, then configure a server-only Supabase secret/service-role key in the deployment.
3. Deploy an updated ClamAV daemon reachable from the deployment's secure network; verify real malware test files, timeout/failure handling, signature freshness and costs.
4. Perform real end-to-end authenticated cross-organisation upload, download, review and AI workflows against a staging provider, including tests with expired tokens.
5. Implement storage orphan reconciliation, file deletion and quota decrement, backup retention, access logging, encryption/key rotation, and regulator-specific data handling policies.
6. Complete appropriate UK privacy impact assessment, documented processors and retention, accessibility audit and qualified regulatory review before real customer files are accepted.
7. Run a genuine AI Gateway request only after model, budget, permissions and privacy terms are approved.

## Important qualification
A hash confirms byte integrity against a stored digest, not authenticity or legal adequacy. Antivirus scanning identifies only threats detectable by the configured engine. Source text differences are not proof of a changed regulation. Recorded human approval isn't a legal certification.
