# RegPilot — Review Centre / Evidence Preparation (demo)

## What this release adds

The Review Centre turns the existing browser-stored task register, document catalogue, manual regulatory decisions and local activity notes into one reviewable preparation pack. It complements the Vanta-style control-centre dashboard, the Sprinto-style task flow and the CUBE-inspired source-to-action inbox.

A user can:
1. Open **Review Centre** from the sidebar.
2. See priority follow-ups (overdue tasks, unsupported completions), review items (expired or unconfirmed evidence, superseded source versions, unfinished source decisions) and organisation gaps (documents not mapped to an action).
3. Open the specific task or document from a flagged finding.
4. Switch to the action-to-evidence matrix, document review register, manual source decisions and local activity history.
5. Export a printable HTML report or structured JSON snapshot.

### What the scores mean

The displayed percentage is **the share of recorded work items with linked current Approved document metadata marked as having an attached file**, not the share of legislation complied with. An Approved status is a user-entered label. A recorded file flag does not guarantee that a file is accessible, authentic, the right evidence, malware-free or legally sufficient.

A review finding is a record-completeness signal, not a legal risk score, regulatory determination or proof of noncompliance. A zero-finding report is not an inspection pass.

### Export integrity and limitations

- All user-entered text is HTML-escaped before printable export.
- The printable HTML has no embedded scripts and is intentionally standalone.
- JSON is a review snapshot, not a restore mechanism.
- Neither export includes PDF/PNG/JPEG attachments, access rights, server-side approvals or real audit signatures.
- The app stores its work items and reviews in localStorage and actual demo files in IndexedDB on the same browser. This is not multi-user, backed up or secure.
- Only fictional or non-sensitive data should be entered.

### Regression tests
- Overdue task, missing evidence, expired document and unsupported completion are flagged.
- A changed source version causes review to be revisited, but *unavailable* sources do not trigger a false supersession claim.
- Printed HTML escapes potentially executable user-supplied markup.
- An empty workspace does not falsely show 100% coverage.
- A review cannot be changed from action-required to not-applicable after it has a linked action without considering that task.

## Next serious engineering milestone

The most valuable next step is a **secure multi-tenant system of record**: trusted user sessions, organisation permissions, PostgreSQL persistence, secure object storage, evidence hashes, review/sign-off controls and end-to-end tests. The existing Supabase staging database was hibernated/unavailable when last checked. No live data was migrated in this release.

Only after that foundation is verified should RegPilot offer customer uploads, scheduled regulatory change monitoring, source-linked AI document comparisons or claims of audit-grade traceability.

## Shared controls

The control library at `/controls` allows one recorded control to link to multiple tasks and documents. Its metadata-coverage states and review-date alerts are now included in the Review Centre, the HTML snapshot and JSON export. No control is represented as tested or effective. A document linked to a control is not automatically an obligation match; all conclusions still require qualified review.
