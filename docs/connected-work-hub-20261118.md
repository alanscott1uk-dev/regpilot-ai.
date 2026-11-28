# Connected work hub — 18 November 2026

## Product increment

The main Tasks navigation now opens `/team/work`: server-side search and pagination across all recorded tasks; six explicit work views; list/board presentations; assigned-task creation; context panel for linked control, recorded source decisions, evidence metadata, assessment history and recent activity; version-checked start; admin-only multi-task ownership/deadline preview and atomic apply with per-task audit records.

No arbitrary approval/status fields are accepted by planning. Completed records and specialist change-response, access-review and audit-request tasks must retain their own workflow. Background monitoring and evidence approvals are not enabled or changed by this batch. A task plan changes the operational task, not the owning managed control.

Search is title/category/owner text search, not semantic AI. Board columns contain the current results page, not the entire database. Counts cover all recorded tasks in this organisation. Task metadata is limited explicitly (50 files, 30 activity events and 10 source decisions/assessments); it is not a legal compliance verdict.

## Verification status at commit

- Local: `node --test tests/work-hub.test.mjs` passed all 10 tests.
- Full build, PostgreSQL integration, HTTP gates and desktop/mobile acceptance: wired into existing CI; results must be inspected for this exact commit. Not yet claimed as passed here.
- UI acceptance uses fictional authentication and mocked API responses. Database tests use disposable PostgreSQL with real application service functions. Neither constitutes real customer identity/provider acceptance or an independent human usability study.

## Acceptance checks

Pagination and search beyond 100 records; organisation isolation; no storage keys or provider secrets in task metadata; preview has no writes; stale versions/permissions/assignees rejected; concurrent previews cannot both apply; transaction failures leave all tasks unchanged; creation/start use fresh membership; evidence approval and completion are unaffected. Browser journeys cover pagination/search, context, start, preview/apply, stale-preview error recovery, organisation switching, task creation, board layout and view-only access at 1440px and 390px.

## Release boundary

Feature branch and draft PR only. Do not merge, deploy, activate paid providers or apply hosted database changes. No schema migration is added. Existing production readiness blockers remain; this is a connected workflow improvement, not evidence of competitor parity.

The new `/team/work` callback path must be explicitly allowed in the approved staging Auth redirect configuration before real email-sign-in acceptance. Existing auth handling is reused; service settings have not been changed.
