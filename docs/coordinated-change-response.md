# Coordinated change response

This batch adds `/team/changes` to the existing Next.js/Prisma/Supabase application. A reviewed publication change can become a single operational response across recorded requirements, controls, evidence and downstream uses. It calls no AI or paid provider. The existing private-workspace and library gates control access and mutations.

## Outcome and acceptance criteria

The earlier library impact function generated one follow-up per accepted mapping. The new response groups affected mappings by shared control and retains all requirement identities. Its deterministic benchmark supplies 100 links across four collections and five shared controls: the expected result is five actions containing all 100 requirements, independent of input order and without duplicate work from repeated rows. This is a benchmark against our prior workflow, not a measured performance advantage over competitors.

Completion requires more than marking the underlying task complete. The response must still match the latest reviewed source, every action must have current replacement mappings or a current not-applicable decision, selected files must remain independently approved, and an administrator independent of the submitters must accept the evidence and close the response. Stored bytes are verified during action acceptance and again before closure, with authorisation and context rechecked after retrieval.

## User workflow

1. An administrator selects a changed source and previews the recorded text differences, affected requirement/control relationships, responsible owners, evidence and linked policy revisions, supplier reviews and audit rooms. No work or third-party setting changes during preview. Independent source approval, a successful check within seven days, exact source identity and integrity are required before creating work.
2. The administrator confirms the exact plan and an operational target date. One task per shared control is created atomically. Concurrent or repeated requests for the same source snapshot reuse one response. A changed preview fingerprint requires a fresh preview.
3. Each responsible colleague sees only their assigned actions. They follow links to the library and Evidence Vault, update requirements and applicability, obtain independent mapping approval and select reviewed supporting files. They explain the resolution and limitations, then submit. Reusing the same file across actions does not create another upload.
4. An independent administrator verifies the submission. Returning an action reopens its preparation task and preserves the earlier submission and review notes. Changed source, mapping, file or permissions prevent stale acceptance. Dismissing a newer mapping proposal no longer hides an earlier accepted relationship; explicit withdrawal still does.
5. Once all action checks pass, an administrator inspects the downstream uses and records the overall outcome. Policies, supplier decisions and audit disclosures are not changed automatically. Closure binds the recorded source, mappings, action versions, selected evidence and dependency fingerprints. A dependency changed after the closure screen was loaded invalidates that closure request.
6. An administrator downloads an internal JSON response record containing the frozen plan, selected evidence descriptors, mapping/not-applicable decisions, action reviews and closure record. Later changes cause `currentAtExport=false`; historical acceptance is not rewritten as current approval. This is not a signature, legal opinion, certification or a complete regulatory inventory.

If another source change arrives while a response is active, its new preview lists the older responses that will be superseded. Applying the replacement plan preserves earlier decisions and retires unfinished old tasks explicitly as exceptions. The new plan carries the currently recorded affected relationships; old tasks are never reported as successfully remediated merely because they were superseded.

## Scope and security

- Every API authenticates before parsing input and returns private, uncached responses. Current database membership, the existing pilot allowlist, organisation locking, serializable retries and expected versions protect mutations.
- A colleague can list/read only responses containing their assigned action, and receives only those actions. Administrator dependency inventories, other owners, the wider evidence list in the saved plan and closure fingerprints are withheld. Exports and impact previews require administrator access. External audit guests gain no access to this workspace.
- The source, frozen plan, action scope, submission and resolution have integrity checks. Composite foreign keys scope source, response, control and task links to the same organisation. Role handover uses the existing task assignment mechanism.
- A current not-applicable decision can resolve a requirement in this response, but still requires supporting evidence, a stated rationale and independent action/response approval. A withdrawn requirement without a reviewed replacement disposition remains blocked; the product does not infer that a duty disappeared.
- Dependency lists are recorded links, not proof every listed document must change. They include active downstream uses and the originally observed records so replacements or withdrawal remain reviewable. The closure attestation is a human decision about these uses.
- Creating a plan never operates a connector, sends a message, changes access, publishes an audit room or activates a paid service.

Bounds: 100 responses per organisation, 100 affected requirement identities, 500 accepted/withdrawn mapping decisions inspected, 30 controls, 150 linked source/programme evidence files, 100 dependencies per type, 1,000 source snapshots, ten evidence files and ten prior submissions per action, and 50 distinct evidence files at closure. Exceeding a planning bound blocks application of a partial plan. Lists show up to 50 latest sources and 100 approved selectable files. These are pilot bounds, not whole-business coverage guarantees or a production capacity benchmark.

The source pipeline retains bounded publication excerpts. The response does not expand that into a full legal corpus, validate interpretation semantically or determine statutory deadlines. Mapping quality and actual user task completion still need domain and usability evaluation. Retention/deletion of these records is separate from source/evidence redaction; this is not a complete erasure workflow.

## Migration and verification

Apply `prisma/changes/change-response.sql` after `audit-evidence-requests.sql` through the reviewed database release process. The baseline is `fixtures/schema-bae1015.prisma`. Two new tables, `ChangeResponse` and `ChangeAction`, bring the server-owned private-table set to 43. The migration installs default-deny Data API protection in the same transaction; CI verifies the full chain and zero drift.

Automated tests use fictional publications, records and accounts. They cover shared-control grouping, preserved scope, API gates, organisation boundaries, colleague visibility, concurrent creation/review, independent review, revoked permissions during storage retrieval, task completion not bypassing closure, changed dependency fingerprints, historical export freshness, not-applicable dispositions, supersession and composite database constraints.

For release acceptance, add `/team/changes` to staging Auth redirects and run the complete workflow in two real staged organisations on desktop and mobile, with an owner, independent administrator and two colleagues. Check changed source text, stale page submissions, role handover, returned evidence and a later source version. Validate source and object-store behaviour with fictional material. Record timings and operator errors against a written task script before claiming better usability or superiority over competitors.

No production migration, paid activation or deployment is part of this batch. The managed preview runner is incompatible with the current Next.js dev command; signed-in browser acceptance remains a separate, unverified release requirement.
