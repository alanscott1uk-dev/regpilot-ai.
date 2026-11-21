# Connected workspace setup — 12 November 2026

The existing private modules required users to connect business scope, source schedules, first captures, evidence and ownership across separate screens. `/team/setup` now provides a single entry point for this work and is linked from Operations.

## Implemented

- Business activities and UK nations produce explainable discovery suggestions from the existing publication catalogue. Users can search all sources and select up to 30; suggestions do not decide legal applicability.
- A reviewed save writes the business profile and selected monitoring schedules in one serializable transaction. Profile and schedule versions reject conflicting changes. Current database membership and the pilot allowlist determine permission. Unselected schedules and existing business facts are preserved.
- A separate explicit action captures one to five selected official publications through the existing bounded source retrieval service. Results remain visible individually; failures are not automatically retried. New text requires review through the regulatory inbox.
- Readiness uses stored captures, reviewed latest versions, clean approved evidence, eligible reviewers and integrity/freshness-checked connector observations. Configured providers and enabled schedules are distinct from successful observations and runtime activation.
- Owners and administrators can change setup; other members can inspect it. Signed-in users without an organisation receive a create-organisation path.
- Shared email sign-in controls prevent rapid duplicate requests across routes/reloads and explain provider rate limits. The callback handler waits for the SDK's single PKCE exchange, verifies the user remotely, removes authentication URL material and routes a same-origin demo landing back to a private page. The home redirect preserves bounded PKCE return parameters.

## Verification

Local verification before publication: 343 unit/API tests, TypeScript, production build and smoke checks covering 33 existing pages passed. New database integration tests cover atomic writes, conflicting versions, preservation, revoked/forged roles and tenant isolation. CI also runs desktop/mobile setup journeys with explicitly fictional browser sessions and API fixtures; these test UI behaviour, not live authentication or source/provider availability.

No schema change is required. Existing private-table grants and tenant checks apply to the new API. New route request bodies are limited to 8 KB and strict input validation. Provider calls are absent from setup save/read operations.

## Remaining acceptance and competitive gaps

This batch improves onboarding and connects existing workflows; it does not establish parity with Vanta, Drata, Sprinto or CUBE. The major remaining gaps are production-proven integration breadth, continuously operated regulatory coverage and automation, and independent human usability evidence.

Paid providers and background jobs remain inactive under existing configuration. Email delivery limits and cross-origin provider redirect settings are not repaired by a client cooldown; Supabase settings and a fresh real sign-in still need verification. A same-origin callback recovery cannot reconstruct a PKCE verifier stored at a different deployment origin. Staging remains a fictional/non-sensitive pilot until service acceptance is complete.
