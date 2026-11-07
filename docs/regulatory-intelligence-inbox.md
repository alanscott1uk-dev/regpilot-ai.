# Regulatory intelligence inbox — development batch

This batch extends the existing Next.js / Prisma / Supabase architecture. It is private-pilot code. It is not activated in production and does not start a scheduler or billable model calls.

## User journey

1. An administrator saves the organisation's activities and UK nations.
2. A permitted operator captures an allowlisted GOV.UK publication through Official sources.
3. Analyse source creates an immutable, versioned analysis of that saved excerpt. Repeating the request with the same source, profile and engine reuses it.
4. The inbox shows exact source passages and character offsets, mandatory/advisory/prohibitory wording, changed passages, relevance reasons, conditions to check and suggested shared control themes.
5. A different administrator records acceptance or dismissal with a rationale. Acceptance additionally requires independent source review, a current source check, an owner, an explicit task title and a chosen target date.
6. Acceptance atomically creates one open task, the decision and its audit event. Evidence attached through the existing vault appears as missing, awaiting review or independently reviewed files available. File metadata does not establish adequacy.

## Implemented boundaries

- All APIs verify Supabase identity and current organisation membership. Viewer access is read-only. Only administrators edit context or decide candidates.
- New relational links include organisation IDs in foreign keys, preventing a run or decision from linking another organisation's snapshot or task.
- Private database tables have RLS enabled and Data API privileges revoked, matching the existing server-only architecture. The direct Prisma database role still requires application-level tenant filtering; this is not tenant RLS for that privileged role.
- Source and result hashes are rechecked before acceptance. JSON keys are canonicalised before hashing to survive JSONB storage.
- Changed profile/source versions invalidate pending decisions. Checks over seven days old must be refreshed before acceptance.
- Serialisable transactions, organisation advisory locks and unique task origin keys prevent duplicate actions, including concurrent acceptance. Conflicts retry at most twice.
- Request bodies are limited while streaming to 4 KB. Analysis is capped at 30 runs per organisation in 24 hours, 30 candidates per run, and 20 runs per inbox response. This is a bounded pilot inbox, not full-history pagination.
- Dates in source text are displayed as mentions. The operator chooses the task target; no legal deadline is inferred.
- New UK-wide business references cover personal information and workplace fire safety. Territorial applicability is explicitly unresolved and must be assessed.

## AI review improvement

Existing AI Gateway generation remains gated. Findings now carry a machine-calculated grounding classification, matched quotation coordinates, duplicate-quotation ambiguity and specific review checks. The UI reports dual source/document matches and unsupported findings. PDF quotations now use bounded server text extraction with page anchors; visual layout and meaning remain unverified. See [evidence assurance](evidence-assurance.md). Text matching does not verify the model's reasoning, and no generated claim becomes an approval.

## Important limits

The default inbox engine is deterministic language-pattern and token matching. A separately gated semantic interpretation path and durable monitoring worker are implemented in the subsequent batch; see [monitoring and semantic analysis](monitoring-and-semantic-analysis.md). Neither has been activated. It can miss implicit duties, cross-references, table content and exceptions, and can surface non-binding language. It analyses the existing bounded GOV.UK excerpt, not every page or linked legal instrument. Source checks can be manual; saved schedules await worker and scheduler activation. Eight reusable control themes are suggestions, not licensed mappings to ISO, SOC 2 or other frameworks.

Live Supabase inspection returned hibernation/connection errors during this session. No hosted schema or data was changed. Real Supabase Auth/Storage, antivirus, end-to-end browser flow, privacy/data handling and AI billing gates remain release requirements. The local browser-preview launcher supplies Vite flags to Next.js and could not start; visual browser QA remains unverified.

## Schema and release

The dependency audit initially reported six vulnerable dependency entries (including transitive entries). This batch upgrades Next.js to 15.5.29, React to 19.3.1 and Zod to 4.6.7, pins the installed Prisma 6.19.3 pair, and overrides the vulnerable PostCSS/deepmerge-ts versions with patched releases. Route parameters now use Next.js's asynchronous contract. The resulting full `npm audit` returned zero known advisories. CI uses the committed lockfile with `npm ci` and blocks high/critical audit findings. This is a dependency check, not a penetration test.

`prisma/changes/obligation-intelligence.sql` is an additive, transactional delta from the exact `b857436` schema, including private-table hardening before commit. CI applies it to `fixtures/schema-b857436.prisma`, checks for schema drift, then exercises permissions, isolation, concurrency and task creation. It is not a live migration instruction for an unknown database. Establish the hosted baseline and backup/recovery plan before any future release.

Vercel previews remain disabled. `vercel.json` additionally disables Git deployments for feature branches. PR #10 stays draft and unmerged. Never enable paid AI or confidential-data processing on the strength of offline tests.
