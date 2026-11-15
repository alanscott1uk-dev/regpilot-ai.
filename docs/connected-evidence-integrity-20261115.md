# Connected evidence continuity — 15 November 2026

A passing collection used to lose checks silently if a later adapter response omitted them. The health dashboard also allowed two extra hours after the evidence-selection deadline. This batch closes those gaps on the existing development branch.

- Same-engine missing signals are retained as UNKNOWN, including across repeated partial collections, until actually returned. They cause the existing durable, deduplicated follow-up for every currently linked control owner. Provider recovery does not approve or close human work.
- New checks and collector-engine changes are visible changes. Checks are not compared across incompatible engine versions; owners must review the new method's scope.
- Collector output must have bounded, uniquely identified checks with recognised statuses and an HTTPS source. Invalid output fails collection without replacing the last good observation. The existing failure queue and retry policy apply.
- Stored evidence must pass shape, content hash, signal hash and derived-outcome checks. Health, Operations freshness, new control links, response evidence selection, exports and automation validate these consistently.
- Observations expire at the configured 24/168-hour boundary, with no grace period. Future and invalid database capture timestamps cannot be current evidence.
- The coverage screen lists active controls depending on each connection so operators can identify the scope of an unhealthy observation. This is technical dependency context, not a control effectiveness or legal compliance verdict.

Verification includes lost-coverage persistence/recovery, new/removed signals, engine changes, duplicate identifiers, invalid records, freshness boundaries, affected-control scope and the existing PostgreSQL shared-evidence workflow. The latter checks tenant isolation, independent ownership, deduplication, future captures and corrupt signal hashes.

No database migration or new service activation is required. Automatic deployment is explicitly disabled for this feature branch; the ignored-build command also prevents its builds until an approved release changes that configuration.

Release blockers remain: real multi-account Auth/Storage/scanner acceptance, dedicated customer provider credentials and end-to-end collector verification, independent nontechnical usability/accessibility testing, recovery/retention/security acceptance and qualified review of legally significant UK/pharmaceutical interpretations. Automated fixtures do not establish those results or competitor parity.
