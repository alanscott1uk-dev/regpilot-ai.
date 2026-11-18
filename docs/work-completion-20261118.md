# Reviewed work completion — 18 November 2026

## User outcome

The work hub now carries an ordinary task from its current evidence state to an explicit, recorded completion. Its task panel explains what is missing, links back to the relevant review work, presents eligible reviewed files, asks for the completed outcome and confirmation, and retains an inspectable, downloadable completion record. A successful file review alone leaves the task open.

Source-linked tasks continue to require the existing current, independently accepted content assessment. The hub uses that assessment's exact evidence manifest, including approved evidence reused from another task in the same organisation. It does not substitute an attachment count for a content assessment.

## Behaviour and integrity

- Readiness is calculated on the server for the exact organisation and task. Reads do not fetch private file bytes, write audit events, call a model or change a task.
- An ordinary task uses one to ten selected clean, independently reviewed files. An outcome of 20–500 characters and explicit confirmation are required. No batch completion or exception switch is accepted by this endpoint.
- Confirmation binds the task, control, source, assessment, evidence versions and current participating memberships. Stored file bytes are downloaded and checked before a final serializable transaction repeats the relevant guards.
- A change during verification prevents closure. The same successful confirmation can be reconciled without adding another completion event. A browser with a lost response checks current state before showing success; it does not blindly resubmit.
- The completion audit record freezes the outcome, actor, task state, evidence fingerprints and reviewer identities, plus linked source, assessment and control versions. Its content hash detects an altered record; it is not a digital signature. Later evidence changes do not rewrite the historical receipt.
- A reopened task does not display an old receipt as its current completion. A completed task with no verifiable receipt says that the record is unavailable.
- Change response, audit request and access review tasks retain their specialist approval workflows. Both the hub and the legacy generic status endpoint reject attempts to bypass those workflows or reopen their task independently.

## Concrete defects repaired

The evidence endpoint's UUID expression omitted a group, rejecting genuine organisation/task identifiers before authentication or scanning. A regression now covers actual generated identifiers at both the listing and multipart-upload boundaries.

The real-services browser journey asserts the exact rejected and successful upload responses. A marked PDF must leave no stored object, quota reservation or success audit. Its workflow tests the same PDF fixtures against ClamAV and retains safe response diagnostics and screenshots on failure.

The upload screen also consumes the successful JSON response and verifies its organisation and task before showing stored-file feedback. A targeted Chromium reproduction showed that leaving the successful body unread stalled browser-side response inspection even though the page had already shown success. `scripts/check-upload-response-lifecycle.mjs` retains the A/B reproduction; it is a transport diagnostic, not a substitute for the real-service acceptance journey. The journey now persists phase checkpoints and bounds response-body, screenshot and cleanup waits.

The legacy exception handoff must retain the requested organisation and exact task, including a task outside the first hundred records. Unsupported or stale organisation context must not silently display another workspace's task.

## Verification

The change is covered by input and HTTP-boundary tests, PostgreSQL integration using real application service functions and injected file storage, and desktop/mobile browser journeys with fictional API responses. The separate private-evidence journey uses actual disposable Supabase Auth, mailbox, private Storage, PostgreSQL and ClamAV to exercise upload, independent review and explicit completion through the normal UI.

Local results before committing this increment:

- `npm test`: 443 tests passed (197 JavaScript and 246 TypeScript), zero failures or skipped tests.
- Disposable PostgreSQL 17: all six cases across completion, assurance, audit request, change response and access review integration passed. The existing work-hub and evidence-storage integration cases also passed separately.
- Production build and TypeScript checks passed. The final build passed the 34-page and private-API smoke check. Packaged PDF and Word extraction checks passed.
- Existing browser acceptance: all 12 scenarios passed. New hub acceptance passed at 1440×1000 and 390×844, including 11 completion and exception-handoff scenarios, zero page errors, and zero horizontal overflow in the page and task dialog.
- New hub screenshots were visually reviewed for the completion form and saved record on both screen sizes. The actual disposable-service journey remains a separate remote acceptance gate; its result must be read from the exact CI run.

Check results for the exact branch commit before treating a run as passed. Local verification and exact remote run links are recorded in PR #10. Fixture browser checks are not customer-provider acceptance or an independent human usability study.

## Scope

This is a task completion record, not a legal verdict or a guarantee of continuing compliance. No model call, new dependency, database migration, provider activation, production deployment or merge is included. Private feature configuration and separate release acceptance still apply.

The official-source probe remains a separate coverage signal. The repair run on 18 November retrieved 37 of 38 selected text bodies; the Scottish Government fire-premises source returned HTTP 202, classified as a publisher challenge. The last successful source content was retained and the failure stayed visible. This increment does not claim to resolve that source availability gap or establish competitor parity.
