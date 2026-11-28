# Reviewing completed work — 18 November 2026

## Customer workflow

The Tasks workspace now connects a historical completion to the work needed when its supporting proof changes. Open **Completed work reviews**, inspect the original completion and current findings, preview an assigned follow-up, and explicitly record a fresh verified review once the supporting evidence is ready.

The original task remains complete. Its original completion receipt, completion time and actor remain historical facts. A new review records what was checked later; it does not rewrite the earlier decision. An open follow-up remains visible after a fresh review and must be finished through its own normal workflow.

An accepted source-linked evidence assessment can also receive a new independent review period. The reviewer must inspect the unchanged original documents and selected passages, confirm the scope and choose the next review date. Renewal uses no paid model and does not manufacture a new extraction merely because the old review period expired.

## What the review view means

The queue uses server-side pagination and search across completed work. Counts of change states describe the displayed page, not an uncomputed organisation-wide total. Exact task links work independently of which page contains the task.

- **No recorded changes detected** means the current metadata matches the latest valid reviewed basis and the required permissions and review periods remain valid. Opening the page does not download or recheck stored file bytes.
- **Needs another review** identifies the recorded change or failed prerequisite and links to the existing evidence, assessment or source workflow needed to investigate it.
- **Review unavailable** means the historical record cannot be verified or a necessary context is unavailable. It must not be represented as unchanged proof.
- Specialist change-response, audit-request and access-review decisions retain their own workflows.

Source polling timestamps alone do not constitute a changed requirement. Existing source freshness limits still apply. A changed control configuration calls for review; it is not automatically a failed control. Ordinary files do not receive an invented expiry date.

This is an on-demand comparison of recorded application context. It is not a background notification service, continuous examination of file contents, complete UK regulatory coverage or a guarantee of continuing legal compliance.

## Owned follow-up

An administrator supplies an eligible assignee, a due date and a rationale. Preview shows the proposed task and the findings behind it without creating work or writing an audit event. Explicit confirmation rechecks the preview and permissions before saving.

The new task is linked to the exact original completion and reviewed basis. A repeated confirmation returns the same saved task. Source-origin and recurring-control identifiers are not copied onto an ordinary tracking task: doing so could incorrectly activate a source-assessment requirement or suppress the control's next scheduled review.

Finishing the follow-up does not, by itself, make the original proof current. That requires a separate explicit verified review.

## Fresh verified review

The administrator chooses the current eligible evidence and records the reviewed outcome. Source-linked tasks retain the exact manifest of a current independently accepted assessment. Ordinary tasks can select current approved files attached to that task.

Confirmation checks the stored private bytes and then repeats the task, proof and membership checks in a serializable transaction. Changes during file access invalidate the request. The saved record freezes the current evidence fingerprints and review versions together with source, control and assessment provenance, and binds them to the original completion event and hash.

That new immutable record becomes the comparison basis for subsequent review reads. The original completion remains available alongside the later review record. Hashes provide content-integrity checks, not digital signatures or external certification.

Review decisions are ordered by their recorded predecessor IDs and hashes, so equal timestamps or different application/database clocks do not reorder the history. References to earlier completion generations must identify a valid completion for the same organisation and task. Invalid or ambiguous history stops new decisions. The reader validates at most 200 review/follow-up events for a task and shows the newest 25 verification summaries; exceeding the verification window is reported explicitly.

## Independent assessment renewal

Renewal is restricted to an accepted assessment with unchanged valid supporting context. Expiry is the only condition the renewal check may bypass; the ordinary current-assessment check continues to reject expired reviews.

The reviewer must be a current eligible administrator or owner, independent of the assessment author and every relied-on uploader. Source review, source freshness, business context, evidence manifest, result integrity, passage verification and superseding adverse assessments remain relevant. The action checks the original stored bytes and revalidates after file access.

The existing versioned assessment receives the explicit new review decision and a date within the existing 90-day review window. The renewal audit retains the previous and new review metadata. The original completion receipt still contains the older assessment version and review period. Renewal therefore permits a fresh work review; it does not silently update historical completed-work proof.

## Verification and boundaries

Focused service tests cover changed proof, exact-task and tenant isolation, permissions, record integrity, duplicate confirmations and concurrent changes. HTTP tests cover the private boundaries. Desktop and mobile journeys exercise the workflow and stale responses. The private-services journey uses actual disposable Supabase Auth, email links, private Storage, PostgreSQL and ClamAV.

In that private journey, a controlled database fixture first returns an already approved file to pending review. Recovery then uses the normal authenticated UI: preview an owned follow-up, confirm it, repeat the exact confirmation to check deduplication, independently reapprove the original document and explicitly save a fresh work review. The assertions compare the original completion before and after, verify the new audit and exported record, check reload persistence and keep the open follow-up visible.

Read the exact commit's CI and acceptance results in PR #10 before treating these checks as passed. Browser fixtures, injected storage tests and disposable local services are different evidence levels; none is hosted customer-provider acceptance or an independent human usability study.

Local verification before the feature commit:

- All **448 unit/API tests** passed: 199 JavaScript and 249 TypeScript tests, with no failures or skipped tests.
- All five relevant PostgreSQL integration cases passed: existing assessment, completion and work hub; new assessment renewal; and new completed-work review. The final review case uses the actual renewal service between expiry and fresh verification. Subsequent strict receipt/linkage changes were rechecked against completion and review integrations.
- The production build and TypeScript checks passed. The new review route rendered successfully; the 35-page/private-API smoke and packaged PDF/Word extraction checks passed.
- All **14 general browser scenarios** and **four work-hub/review journeys** passed. New review journeys exercise 106 completed-task fixtures on desktop and mobile. Renewal journeys cover explicit passage/original/scope checks, stale decisions, a saved result with a lost response, read-only recovery and unavailable-organisation isolation. New screens had no horizontal page overflow or client exceptions.
- Desktop and mobile screenshots of the review and renewal forms/records were inspected. The separate actual Auth/private Storage/ClamAV journey is an additional remote gate, not inferred from browser fixtures.

This increment adds no application dependency or database migration, does not activate a provider, and does not merge or deploy the draft branch. Existing release gates and the separately reported official-source availability gap remain in force.
