# RegPilot product completion

This is the active completion standard for the development branch. Earlier dated feature notes are implementation history. The current code, its acceptance artifacts and [draft PR #10](https://github.com/alanscott1uk-dev/regpilot-ai./pull/10) are the source of truth for what has actually been verified.

## The customer outcome

A new user must be able to sign in, create their organisation, describe its business, select relevant official publications, inspect changes, record an independent applicability decision, assign work, attach and independently review evidence, complete the task and produce a scoped report. The organisation, source, owner and evidence must remain connected throughout. Errors must explain recovery without inventing success or charging for repeated automatic requests.

The platform is not ready for release merely because its modules exist or its automated checks pass. Release requires the live-service, independent usability, security and domain acceptance below. Do not merge or deploy while those gates remain open.

## Connected customer journey — 18 November 2026

The existing Today, Setup, Regulatory updates, Tasks, Evidence and Reports screens form the customer journey. This work adds no new customer module, database schema, dependency, hosted deployment or paid provider activation.

| Customer outcome | Implementation and acceptance evidence |
| --- | --- |
| Enter a real workspace | Today leads a newly verified user to Setup. Setup creates the first organisation through the authenticated API and records the owner membership. The actual private-services acceptance begins without an application organisation or membership. |
| Keep the right organisation | Setup, source history, intelligence and Reports share an account/organisation boundary. Explicit unavailable links never silently open another organisation. Stale responses and old displayed data are rejected after scope changes. Navigation, sign-in return and report links preserve bounded context. |
| Understand the next action | Today has one next action, six factual stages, organisation-wide work totals and one bounded attention queue. Programme, controls and connections open their own content. Milestones describe saved records; they do not calculate a compliance percentage. |
| Configure meaningful source work | Activities and UK nations are saved with reviewed publication schedules. A saved schedule, a successful capture, independent source review and an active background runtime are distinct states. Dedicated-worker and cron configuration are both recognised. |
| Create work that someone owns | Independent applicability acceptance can assign a current eligible member in the same transaction as task, decision and audit creation. The saved owner comes from membership, not an arbitrary label. Foreign, removed, viewer and non-allowlisted assignees are rejected. Existing legacy API callers may still supply an owner label; Today identifies work lacking an eligible assignee. |
| Reach evidence and a recorded outcome | The exact accepted task opens in the work hub. The private-services journey uploads scanned files, obtains independent file and content review, and explicitly completes a source-linked task with a frozen receipt. Existing completed-work follow-up and fresh-review acceptance remains part of the same test run. |
| Produce a useful report | Reports is a primary navigation destination. Its seven-day view combines source issues, pending decisions, due work and validated completion records. JSON includes the frozen receipts; CSV includes record identifiers and proof hashes; print has a readable layout. The acceptance script compares exported receipts with actual persisted decisions. |

## Observed monitoring and recovery — 18 November 2026

The next completed development path is **failed check → visible incident → administrator recovery request → guarded collection → independently reviewed source work**. It uses the existing Source health, Sources and Regulatory updates screens. No scheduler, hosted service or paid model is activated by this change.

- Source health retains the exact requested organisation, rejects unavailable links, discards old account/workspace responses and keeps downloads and review links in scope. A lost recovery response leads to a read-only status check; it does not automatically submit another write.
- Recovery is an explicit version-checked administrator action. Concurrent requests enqueue one attempt. Active leases cannot be stolen, and the shared publisher cooldown remains in force. The failure and previous successful-check time remain recorded until a successful guarded check. Saving Setup, frequency or a source portfolio cannot erase that incident.
- Each source exposes its last attempt, next eligible check and latest five safe activity records, with truncation disclosed. Repeated identical publisher deferrals do not flood the audit trail. A queued request is not an executed check.
- Runtime status distinguishes inactive, configured without observed execution, running, recently completed, degraded and stale operation. Every configured worker slot and scheduler needs its own observation. The dedicated worker's expected cadence is 30 minutes with a 90-minute stale threshold; the existing cron remains daily at 06:00 UTC with a 27-hour stale threshold. The customer projection excludes global record payloads, other organisations' counts, credentials and invocation identifiers.
- Cron now shares the dedicated worker's leases, maintenance and persistent run records. An empty sweep still reports unresolved paused source failures. A recent completed runtime is separate from each publication's successful retrieval, freshness and independent review.
- The SEPA waste-duty source uses its directly verified official destination after the publisher moved it. A curated address change creates a new review-required baseline, even if the text is identical or the old capture was recent. The old approved snapshot and completed-work receipt retain their original address. Relocation alone does not invent a legal text change or a text-change task.
- Discovery failures now retain predefined diagnostic reasons while discarding incomplete new results and preserving older observations at their original timestamps. The earlier HMRC failure was not reproduced during investigation; richer diagnosis is not a claim that the feed can no longer fail.

Development acceptance covers the failure-to-recovery database workflow, scheduler overlap/replay and stale execution, desktop/mobile recovery and uncertain responses, and the actual authenticated customer request against disposable private services. That private-services journey injects an explicitly fictional paused-check fault, proves that recovery preserves the incident through refresh/reload, and leaves inactive execution visible. Actual worker collection is exercised separately against controlled publication input. These are not observations of an activated hosted customer scheduler.

The exact final commit, passed runs, screenshots, exported reports and any live-source failures are recorded in PR #10. Runtime configuration, a successful test run and sustained hosted operation remain different evidence levels.

## Connected team review and task completion — 19 November 2026

The customer outcome is **invite a colleague → join the intended company → open the assigned task → review files and their content → record completion and report it**. The task must remain visible to the person who can move it forward through every required review.

- Team & access uses the same account and organisation boundary as the connected workspace. A company link never silently selects another membership. Accepting an invitation selects its actual company even when the recipient already has another workspace. Manually copied invitation links retain a bounded company, invitation and optional task context; the verified recipient must still choose to join. No invitation email is sent automatically, and the pilot allowlist and current inviter/role checks remain in force.
- An uncertain invitation or access-change response offers a read-only check of saved invitation, membership and team state. A repeated acceptance is not used as recovery. The acceptance record and current membership remain distinct: an old accepted invitation does not restore access after removal.
- Tasks now derives its next action from the saved workflow stage, rather than the existence of a source link. Pending file review and draft content assessment both appear in **Reviews to finish**, with independent creator/uploader exclusions. Filtered totals and pagination use the full organisation scope. Pending review on a completed task remains visible without rewriting its original completion record.
- Task progress stays visible in the task, file and assessment screens. The next action identifies the required person and opens the exact task or assessment. An assessment link outside the ten latest records is retrieved explicitly within its company and task; an unavailable link never substitutes a different review. The source-linked path distinguishes file approval from a content-level evidence decision and explicit task completion.
- Inbox stages are navigation projections. Task detail applies the existing source, evidence, membership and assessment metadata checks before offering completion; original file bytes are verified by the explicit completion operation. A stage indicator is not a compliance score or a new approval mechanism.
- If assessment preparation or review returns an unconfirmed result, further mutation controls pause until the saved assessments are checked. This recovery issues only a GET; it does not repeat a paid request or review decision. A failed reconciliation removes the unconfirmed displayed assessment.

The actual private-services customer acceptance now obtains the preparer's company membership through the invitation UI rather than inserting it into the database. It starts with the preparer already owning a different fictional company, verifies the exact invited task handoff, and then follows the existing source-to-evidence-to-report journey. Source content, a monitoring fault and a large test task population remain clearly controlled fixtures. Auth, invitation creation/acceptance, company membership, file storage/scanning, review and completion use the real application endpoints. Desktop/mobile fixtures separately exercise uncertain responses, exact record selection, account changes and unavailable links.

Final execution results and artifacts for this revision belong in PR #10. These development checks do not activate hosted services or replace the release gates below.

## Find and reuse company evidence — 19 November 2026

The competitor-derived customer outcome is **find an existing file without remembering its original task → inspect its provenance and recorded assessment uses → select a source-linked task → deliberately assess the same original for that task**. Drata's [Controls and Evidence](https://drata.com/products/compliance/controls-and-evidence) page describes a central evidence library and reuse across audits/frameworks. This is the capability benchmark; no comparative performance advantage is claimed.

- The primary Evidence destination offers a company-wide library. Filename/original-task search, recorded review state, document format and uploader filters operate over the company population with server-side counts and pagination. Exact-file links are independent of the current page or search filter.
- The file retains its original task, uploader, hash and review history. Library reads are metadata only. Download uses the existing private-original verification. A recorded file approval does not establish that the file satisfies another requirement.
- The selected file shows its recorded source-task assessments and their existing currentness checks, with exact task/assessment links. The view states its coverage and bounds; it must not imply it inventories every downstream policy, customer disclosure or external copy.
- Reuse chooses an open source-linked task and preserves company, task and canonical evidence ID through navigation and sign-in. It selects the existing file for inspection; the customer still explicitly consents to and prepares an assessment. The existing independent evidence and assessment review rules remain authoritative.
- Reuse does not upload another copy, move the original file to a different task, create a storage object or change the original completion record. Missing, quarantined, foreign or ambiguous file links cannot select a replacement silently. Account/company changes clear the selected file and discard earlier responses and downloads.

Acceptance requires desktop/mobile library search, filters, pagination, exact-file access, account replacement and unavailable links. The actual private-services journey must find a previously uploaded original from another task, carry its canonical ID into a new source-task assessment, verify unchanged file/storage metadata and report the new recorded use after independent review. Execution results belong in PR #10 against the final revision.

### What the guided status means

- **Not started:** the relevant record is absent.
- **Needs attention:** saved records show work requiring review or action.
- **Needs support:** a permission, independent reviewer, runtime or disclosed data limit prevents the next assurance step.
- **Recorded:** the stated saved milestone exists. It is not a claim of continuing compliance or current file integrity.
- **Available:** a report can be opened, including its gaps. This does not claim that the report was exported, approved or audited.

Task totals are not inferred from the first page. Membership verification is bounded at 100 people; selected-source projection at 120 watches; frozen completion inspection at 200 task records. Reaching a bound is disclosed and cannot create a healthy default. Invalid completion records are withheld and their count is visible in Reports. Approved-file counts describe metadata and currently eligible independent people; completion and file retrieval perform actual stored-byte verification separately.

## Evidence required before calling a development change complete

1. **Code and data:** type checking, meaningful unit/API coverage, relevant PostgreSQL workflows and the required migration/private-table gates pass on the final source revision.
2. **Browser:** desktop and mobile journeys prove navigation, saved state, failure recovery, exact organisation handoffs, account changes, keyboard controls and layout. Fictional API fixtures must be identified as fixtures.
3. **Actual private services:** disposable Supabase Auth, mailbox, private Storage, PostgreSQL and ClamAV exercise the complete application path. `scripts/evidence-journey.mjs` invokes `scripts/customer-journey.mjs` from first organisation creation through source-to-task-to-report acceptance.
4. **Report consistency:** the downloaded completion record and customer report match the same database event, source fingerprint, assessment, assignee and file hashes. Neither export discloses object storage keys.
5. **Durable evidence:** PR #10 records the exact commit, workflow runs, artifacts, remaining failures and release boundaries. New feature work must not reset this completion standard.

The expanded private-services journey uses one clearly labelled fictional publication body, a controlled paused-monitoring fault and a controlled task population in its isolated database. Application endpoints, authentication, invitation acceptance, membership, recovery requests, uploads, scanning, document extraction, review, task completion and reporting are real. That test does **not** establish publisher delivery, production operation, legal accuracy or independent human usability. No paid model is required for the tested rule analysis and passage retrieval path.

## Release gates that remain separate

| Gate | Required evidence before release |
| --- | --- |
| Hosted service operation | Approved staging sign-in and multi-organisation acceptance against the actual hosted database, storage, scanner, redirects and recovery configuration. Disposable CI services are development evidence. |
| Continuous automation | Observed source and connector runs at their promised intervals, stale-worker detection, actionable failures, accountable notifications and tested recovery. Enabled configuration alone is not successful operation. |
| Provider integrations | Dedicated sandbox/customer-provider tests for each advertised integration, including scope, identity binding, pagination, revocation, freshness and rotation. Unconfigured providers remain unavailable. |
| Usability and accessibility | External UK SME participants complete the defined tasks without coaching; report measured success, time, confusion, keyboard/mobile access and comprehension. See `live-service-and-usability-acceptance.md`. |
| Security, retention and recovery | Independent review, access isolation, backup/restore, deletion/retention and incident handling evidence for the release environment. |
| UK regulatory accuracy | Qualified review of source coverage, applicability, territorial scope, dates and recommendations. Selected publication captures are not comprehensive UK coverage. |
| Pharmaceutical scope | Separate specialist benchmark and intended-use/quality review. General SME workflow acceptance does not establish pharmaceutical system validation, recognition or certification. |

Known external constraints must remain visible. Publisher challenges, redirects, transport failures and moving discovery indexes can interrupt collection; their latest observed state belongs in the official-source workflow and PR evidence. Dedicated hosted Vercel/Supabase customer-provider contracts remain unconfigured. Neither historical success nor retained publication records establish that the latest upstream collection succeeded.

Continue against these customer outcomes. Record any failed boundary, repair it, and rerun the relevant acceptance before claiming it works. Keep production deployment and paid-provider activation outside this development increment.
