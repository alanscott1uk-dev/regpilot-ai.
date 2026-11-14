# Evidence assurance — development batch, 7 November 2026

## Concrete problem and changed behaviour

An approved attachment previously allowed a source-linked task to be marked complete without a content-level assessment linking that file to the specific requirement. This batch adds that missing relationship. A source-linked task now requires a current independent evidence assessment, with verified PDF passages, before completion. The application rechecks the actual stored file hashes before closing the task. Ordinary internal tasks retain their existing documented-exception workflow.

This is a scoped evidence decision, not a legal compliance certificate. Text extraction, quotation matches and human attestations cannot establish that the underlying record is authentic or that a business actually performed an activity.

## End-to-end flow

1. Open Evidence assessment from the regulatory inbox, task queue or evidence vault. Choose an existing task created from an independently accepted source recommendation.
2. Select up to three antivirus-scanned PDF or Word documents from the same organisation. A file may be reused from another task without copying the storage object. Each new use needs its own scope decision.
3. Content search extracts page text locally and finds passages related to the requirement. It returns **unassessed** search candidates, never automatic proof. Negative and conditional wording is a cue to investigate, not a contradiction verdict.
4. Optional AI assessment separates the requirement into draft checks. The prompt distinguishes a written policy promise from dated evidence that an activity happened. Checks may be supported, contradicted, not found in the supplied extraction, or unassessed. The model has no tools and no authority to approve anything.
5. Every retained model citation must be a unique exact substring on the stated page of a selected file. Fabricated sources, invented file IDs, wrong pages and missing/ambiguous quotations become withheld, unassessed claims. Grounding does not validate the interpretation itself. The model's live accuracy is not yet measured.
6. A different administrator who did not prepare the assessment or upload any selected file checks the original PDFs, business scope, conditions, exceptions, dates and implementation evidence. They select up to eight supporting passages, record a rationale, and choose a review date within 90 days. This is an internal review interval, not a statutory deadline.
7. Acceptance requires independently approved evidence files, a reviewed source checked within seven days, stable business context and a valid result hash. It is blocked by unreadable/truncated extraction, withheld claims, missing proof, contradictions, or unresolved AI checks. Content-search candidates can be assessed by the human reviewer; search itself never establishes sufficiency.
8. Task completion revalidates the assessment, its inputs and the underlying stored bytes. A new source version, evidence review revision, business-profile change, expired review, superseding decision or newer adverse finding invalidates the old assessment. Existing task status is not silently rewritten, but a new completion attempt is blocked and the assessment workspace shows the reason.

## PDF understanding

Mozilla PDF.js 6.5.438 is pinned in the lockfile. The application uses server-side text extraction only: no viewer, rendering, scripts, document actions, annotations, attachments or supplied URLs. Parsing runs in a separate worker thread with an empty environment, discarded parser diagnostics, an eight-second timeout and V8 heap limits. The worker is **not an OS sandbox**, and V8 limits are not a hard cap on native memory. More adversarial parser/security testing is a release requirement.

Per document limits: existing 5 MB file cap, 40 extracted pages, 20,000 characters per page and 80,000 characters overall. Blank/image-only pages and truncation are disclosed. Image-only documents require a text-based copy or manual handling; OCR has not been added. Extraction does not validate tables, reading order, layout, handwriting, signatures, authenticity or freshness. Approval requires the original PDFs to be inspected as well. AI assessment is capped at 60,000 extracted characters across selected files.

AI Studio also uses this extractor before a paid request. Its document quotations can now have a page number and offsets in whitespace-normalised extracted page text. Quotations repeated on multiple pages remain ambiguous. Extraction coverage is displayed. These coordinates are not byte positions or visual bounding boxes. The original multimodal PDF review remains available behind the AI activation gates, including image-only PDFs; their quotations remain unverified when no text can be extracted. The structured evidence-assurance acceptance path requires readable text.

## Persistence, privacy and concurrency

- Full extracted PDF text is held in memory for processing, not stored in the assessment table. Explicit consent is required to save short quoted passages in a draft. AI processing separately discloses sending extracted text to the configured provider.
- The assessment stores the source snapshot, task, business-profile version, evidence IDs/digests/review versions, method, input hash, result hash and human decision. Compound organisation foreign keys protect task/source links; every evidence selection is independently tenant-filtered.
- A unique organisation/input/method reservation prevents duplicate processing and repeated paid requests. An interrupted or failed attempt is visible and cannot silently replay. Twenty assessment attempts per organisation per day bound extraction work. Paid requests also use the existing per-user/per-organisation daily counter and zero SDK retries.
- Permissions and input state are checked again after extraction and before saving. A compare-and-set update prevents an in-flight model response from restoring quotations removed by an administrator. Review versions prevent duplicate or competing decisions.
- Administrators can remove retained assessment quotations. This clears result content, selected passages, reviewer notes and the evidence manifest, while retaining minimal audit metadata and hashes. It invalidates that decision and does not reinstate an older approval. Original evidence PDFs remain in the vault; this is not a complete customer-data deletion/retention programme.
- Audit events contain IDs, versions, hashes and outcomes, not filenames, raw PDF text, excerpts or free-form review rationale.
- The private-data hardening SQL includes AssuranceAssessment. The direct Prisma connection still relies on application tenant filtering; this is not tenant RLS for the privileged database connection.

## Review record export

An authorised member can export a JSON record with the task, saved source reference, evidence manifest, quoted assessment, human rationale, review interval and current/stale state at export. Original PDFs are not included. A deterministic hash covers the serialized payload. That hash is an integrity aid, **not a digital signature or independent proof of authenticity**. Access and exports are audited; redacted or integrity-invalid results cannot be exported.

## Activation, migration and verification

New flags default off: REGPILOT_ASSURANCE_ENABLED and REGPILOT_ASSURANCE_AI_ENABLED. The former additionally requires the existing private Evidence Vault configuration. All paid AI paths now require REGPILOT_AI_SAFEGUARDS_VERIFIED as well as the existing AI settings; this flag is an operator attestation, not automated proof that privacy, authentication, security or provider billing controls were verified. Nothing has been enabled or deployed by this batch.

The additive migration prisma/changes/evidence-assurance.sql follows monitoring-semantic.sql and uses fixtures/schema-a5866b5.prisma as its exact prior schema. CI runs the complete migration chain, drift checks and private-table checks on disposable PostgreSQL 17. No hosted migration has been applied.

Tests use fictional PDFs generated with valid page trees, content streams and cross-reference tables; PDF extraction is real. Model calls are mocked; storage and antivirus use isolated adapters in integration tests. Coverage includes page anchoring, wrong-page/file/source citations, incomplete PDFs, concurrent request reservations, independent review, evidence reuse, expiry, stale revisions, file tampering, superseding adverse findings, redaction while generation runs, permission revocation, source drift, completion gates and auditable export. A separate production-package test copies only Next-traced parser assets to an isolated directory and executes real extraction there, catching missing worker/native dependencies before deployment.

Live-model evaluation, real-provider staging acceptance, OCR/table/visual fidelity, browser usability/accessibility testing, workload/cost tests, independent security review and a complete retention/deletion policy remain required before customer use. Tests are not evidence of competitive superiority or production readiness.

## Word and inspection extension

The programme and assessment paths now support standard Word documents with block references, extraction-issue gates and a searchable vault inspector. See [Document understanding](document-understanding.md) for format limits, coordinate compatibility and honest readiness boundaries. Existing PDF page references remain unchanged.
