# Document understanding: PDF and Word

This development batch lets an SME use its existing Word policies and records across the private evidence, programme, assessment and control-mapping workflows. For example, a `.docx` training policy can become a proposed owned control; its exact paragraph remains inspectable, and a separate reviewer decides whether dated records demonstrate the requirement. A policy statement alone never proves implementation.

## Implemented workflow

- Upload a PDF or standard `.docx` to a task in the private Evidence Vault. Existing organisation limits, explicit CLEAN antivirus result, private storage, hash verification and independent file review remain mandatory. Word packages also pass structural/security parsing before any storage write. The stored MIME type, object extension and original download name retain the correct format.
- Use **Check what RegPilot can read** to inspect and search extracted content. It makes no model request and retains no additional extracted text. It reports missing/unsupported content and the next step before paid analysis. Inspection checks tenant membership before and after file access/extraction, allows 30 attempts per organisation per rolling hour and audits IDs only.
- Select up to five PDFs/Word documents for a programme import, or three for evidence assessment. Exact quotations, offsets, originating files and labelled locations accompany proposals. No automated acceptance or compliance verdict is added.
- Use independently approved Word evidence in cross-collection control relationships. Incomplete extraction prevents relationship preparation. Existing version, applicability, independence and stale-context checks remain.
- AI Studio accepts a non-sensitive Word example (2 MB maximum) or an authorised vault reference. Word is parsed on the server and supplied as labelled text blocks; its raw archive is not sent as a PDF attachment. Existing provider activation, consent and request quotas apply. Provider responses in automated tests remain mocked; live-model quality is unverified.
- Programme/assessment acceptance rejects Word extraction gaps even when the original attachment has already received independent approval. File approval does not override content-quality gates.

## Coordinates and completeness

Word pagination changes with fonts and layout, so RegPilot identifies **paragraphs and table rows**, not Word pages. It extracts the main body, basic table cells, standard headers/footers and footnotes/endnotes. Labels include the part, paragraph or table row and recognised built-in heading context. Tables retain cell boundaries as tabs, but this does not validate semantic interpretation or visual layout.

Legacy saved JSON uses `page`, `totalPages` and `extractedPages`. Those keys remain backward compatible; new Word results carry `unitKind: block`, source-part labels and `format: DOCX`. For Word, these numeric keys are extraction ordinals/counts, never rendered page coordinates. Consumers must display the supplied labels/unit kind. Programme, assurance and coverage engine versions change so new requests do not reuse earlier extraction results. Existing PDF records remain readable.

Tracked changes, comments/supplementary content, drawings/text boxes, calculated fields, hidden text, merged/nested tables and unsupported symbols/forms are disclosed and block automated acceptance. Automatic list numbering is not reconstructed and requires original-document review. OCR, handwriting, authenticity/signature validation, general Office-format support and guaranteed whole-document completeness are not provided. Supply a resolved text-based document when needed. Exact regulatory/framework clause intake remains publication/PDF-only; its selector excludes Word files.

## Parser boundaries

- File: 5 MB in the vault; 2 MB in AI Studio. Existing programme/assessment selection text caps still apply.
- Word: at most 500 archive entries, 20 MB total declared expanded content, 10 MB per archive entry, 2 MB per UTF-8 XML part, 150:1 expansion ratio, XML depth 80, 500 extracted blocks, 10,000 characters per block and 80,000 characters total. Truncation is visible and blocks acceptance.
- ZIP entry sizes and CRCs are checked while reading. Duplicate/unsafe paths, encrypted or unsupported compression, executable/macro/embedded-object packages, DTD/entity declarations, external templates and active external fields are rejected. External hyperlinks are never fetched; only their displayed text is extracted.
- Pinned `yauzl` and `saxes` parsers run in an eight-second worker with an empty environment and bounded V8 heap. Parser diagnostics are discarded. No archive files are written, Office automation invoked or external relationship fetched. A worker thread is **not an OS security sandbox** and V8 limits are not hard native-memory isolation.
- Deployment tracing explicitly includes both workers and dependencies. Tests execute the Word worker from each of eight independently assembled route packages, plus PDF extraction including the inspection route.

## Verification and activation

Fictional OOXML fixtures exercise real ZIP/XML extraction, paragraphs/tables/supplementary parts, grounding, unsafe archives, expansion limits, DTDs, malformed/deep XML, macro/template/DDE rejection and legacy PDFs. A disposable PostgreSQL workflow covers real metadata, MIME/hash handling, organisation isolation, independent programme and assessment acceptance, blocked incomplete content, permission revocation during inspection, quotas and content-free audit events. Antivirus, object storage and AI provider responses remain test adapters, not live service evidence.

This batch needs no additional database migration. Deployment needs both PDF and Word MIME types permitted in the existing **private** Supabase evidence bucket. Keep the current runtime/authentication/scanner gates; a bucket policy change alone does not activate private processing. Complete authenticated multi-user browser testing and real scanner/storage acceptance using fictional files before activation. No paid model calls, confidential customer processing or Vercel deployment were performed for this batch. Broad connector coverage, expert regulatory validation and measured competitor performance remain separate work.

Integration files run sequentially against their shared disposable database because worker tests intentionally scan all organisations and use process-local pilot allowlists. Explicit concurrent request/lease/invitation tests inside each suite remain concurrent. This isolates fixtures without weakening the concurrency assertions.
