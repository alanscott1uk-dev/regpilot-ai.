# RegPilot Customer API

Implemented contract: **2026-11-20**, major route **`/api/v1`**. The machine-readable OpenAPI 3.1 document is served at **`GET /api/v1/openapi`**. It contains no credentials or company records and remains readable when the data API is inactive.

This surface connects an approved customer system to the same control and task records used in RegPilot. It provides scoped reads and typed customer-reported observations. An administrator can acknowledge a reported pass, reject a submission, or create an owned open follow-up. Machine submissions cannot approve files, declare compliance, complete tasks or change control configuration.

## Activation and administration

The existing private workspace configuration and `REGPILOT_CUSTOMER_API_ENABLED=true` must both be present. The example configuration keeps this flag **false**. This feature does not require an AI model, a paid-service reservation, outgoing webhooks or another service dependency. The flag governs machine access; administrators can prepare and revoke credentials while it is inactive.

Owners and administrators use **`/team/developers?organizationId=…`**. Every administrative operation rechecks current company membership and the existing invitation eligibility policy inside the database transaction. A copied context object or previously valid login does not substitute for current authority.

Create a credential with:

- A recognisable integration name, 3–100 characters.
- One or more explicit scopes from the table below.
- Up to 50 current accepted control grants. Every scope other than `regulatory:read` requires at least one control.
- An expiry no more than 90 days away. A company can have up to 20 unrevoked, unexpired credentials; old history does not consume this allowance.

| Scope | Supported access |
| --- | --- |
| `controls:read` | Granted control configuration, owner identifier, schedule and recorded version. Paused controls remain readable. |
| `tasks:read` | Recorded task metadata for granted controls, including the assigned user identifier and current workflow status. |
| `regulatory:read` | Company-reviewed regulatory snapshot metadata. Historical versions may be returned. |
| `evidence:read` | Clean, recorded-approved file metadata attached to tasks for granted controls. |
| `observations:read` | Only this credential's submissions for its granted controls, including stale historical records and review results. |
| `observations:write` | Typed observations for current enabled accepted controls within the grants. |

The generated bearer has the form `rpk_<credential UUID>_<32-byte random base64url secret>`. Store the entire value in the integration's server-side secret manager. It must not be embedded in browser code, committed, placed in URLs or logged. RegPilot stores a SHA-256 hash and an eight-character display hint, not the plaintext bearer.

The plaintext is returned **once** on successful creation or rotation. Operation receipts, history, audits and recovery reads never contain it. A retried creation or rotation returns metadata with `secret: null` and `secretUnavailable: true`. If the first response was lost, an administrator must explicitly rotate; recovery never silently mints another secret. The UI labels the exact credential and prevents switching company or credential while the one-time display remains open.

Rotation immediately invalidates the previous bearer and its pagination cursors. It preserves the issuer, control grants, scopes and expiry. Previously submitted observations can remain current under the continuing credential. Revocation or expiry blocks further reads, submissions and replay and marks its retained observations non-current. Existing follow-up tasks remain recorded. Changing scopes or control access requires a separate credential; the current surface does not mutate permissions in place.

The issuer must remain an eligible **OWNER or ADMIN** of the same company. Downgrading or removing them, withdrawing their invitation eligibility, rotating the secret, expiring it or revoking it is checked again inside every business operation. An administrator rotating another administrator's key does not become its issuer.

## Requests and reads

Send `Authorization: Bearer <the entire generated credential>` to the same RegPilot environment that issued it. The API derives company identity from that credential. There is no tenant selector in a public API request; `organizationId` and other unknown or repeated query parameters are rejected.

| Endpoint | Filters | Returned information |
| --- | --- | --- |
| `GET /api/v1/controls` | `limit`, `cursor` | Explicitly granted controls. |
| `GET /api/v1/tasks` | `limit`, `cursor`, optional `controlId` | Tasks attached to those controls. |
| `GET /api/v1/regulatory-sources` | `limit`, `cursor` | Reviewed snapshot identity, URL, hash, version and capture/review times. |
| `GET /api/v1/evidence` | `limit`, `cursor`, optional `controlId` | File identity, task, name, media type, byte size, content hash and recorded review version/time. |
| `GET /api/v1/observations` | `limit`, `cursor`, optional `controlId`, optional `requestKey` | This credential's original submissions and administrator decisions. |

All pages return `apiVersion`, `data` and `pagination`. The page limit defaults to 25 and is bounded at 100. Follow `pagination.nextCursor` while `hasMore` is true. Cursors are bound to the credential, company, credential version, resource and filters and expire after 60 minutes. Keep all filters unchanged between pages. Cursors are integrity checked but are **not** an authorisation boundary; current company and grant checks apply independently to every page.

`pagination.asOf` fixes the upper creation-time boundary, and records are ordered by creation time and ID. This is not a multi-request database snapshot: changes to records, reviews and permissions are evaluated live. Start another listing to include newly created rows.

Responses are `Cache-Control: no-store` and include `X-RegPilot-API-Version` and `X-Request-Id`. Error bodies have `{ "error": { "code": "…", "message": "…" }, "requestId": "…" }`. Preserve the request ID for investigation without logging secrets or private payloads.

Evidence reads expose **metadata only**. They do not download or reverify original bytes and never expose a storage key, object URL or signed download URL. The review field is a recorded approval status, not a fresh independent byte review. Task status is the stored workflow status, not a compliance certification. Reviewed regulatory metadata may describe historical snapshots and does not determine current legal applicability or complete UK regulatory coverage.

## Submit and recover an observation

`POST /api/v1/observations` requires `observations:write`, JSON, no query parameters and a UUID **`Idempotency-Key`** header. Retain the exact key and body in your integration's own durable delivery record **before** sending. Use a distinct `externalId` for each new observation of a control.

```json
{
  "controlId": "123e4567-e89b-42d3-a456-426614174000",
  "externalId": "inventory/run-20261120-001",
  "observedAt": "2026-11-20T12:00:00.000Z",
  "validUntil": "2026-11-21T12:00:00.000Z",
  "summary": "The customer inventory reported incomplete encryption coverage in the selected control scope.",
  "checks": [
    {
      "key": "device-encryption",
      "label": "Reported device encryption",
      "status": "FAIL",
      "observed": "Two inventoried devices did not report encryption.",
      "detail": "This inventory result requires independent review of the source system and exceptions."
    }
  ]
}
```

Replace the illustrative identifier and dates with the actual granted control and observation period. `observedAt` and `validUntil` are UTC ISO timestamps. The observation must have occurred in the last seven days, with five minutes of forward clock tolerance. Expiry must be in the future, after observation, and within seven days of it.

Payloads support 1–20 checks with unique lowercase keys; status is exactly `PASS`, `FAIL` or `UNKNOWN`. Observed values are bounded strings, not arbitrary JSON or numbers. The summary is 20–1,200 characters; check label is 3–160, observed value up to 400 and detail up to 600. Requests are limited to 32 KiB. Unknown fields are rejected. The OpenAPI schema contains every field constraint.

The first successful request returns **201** with `reused: false`; an identical replay returns **201** with the original ID and `reused: true`. Replay compares the parsed and normalised payload hash before moving time-window and intake-budget checks, so an existing report can be recovered after it becomes stale. Current credential authority is still required. Changing data under the same key returns **409 `idempotency_conflict`**. Reusing the same external reference for the same credential/control with a new key returns **409 `external_reference_exists`**.

When an acknowledgement is lost:

1. With `observations:read`, call `GET /api/v1/observations?requestKey=<the original UUID>`. A found record is in `data`; no match returns an empty array.
2. If necessary, resend the **identical body with the original key**. Do not generate another UUID for a retry.
3. Treat `current: false` and `reason` as stale or invalid context, not as a failed delivery that needs a duplicate observation. Submit a new observation with a new reference and key only after collecting a genuinely new result.

The stored record identifies `source.kind = CUSTOMER_API_CLIENT`, its credential ID and version. It retains the original payload and control context hashes, observation/receipt/expiry times and review state. There is no fabricated human audit action on machine ingestion. An administrator's later review has their real user identity in the audit record.

## Human review and connected work

The developer workspace shows pending observations in pages of 50 and supports historical pages and exact linked records. It rechecks payload/context integrity, current issuer permission, the credential's write scope and control grant, control owner eligibility, current control configuration and programme state, expiry and any recorded reviewer's current administrator authority.

`current: true` means those provenance and currency checks passed. It does not verify that the customer-reported values are accurate. A changed control, withdrawn scope, ineligible participant, revoked or expired credential, rejected report or expired observation produces `current: false` with a reason. Historical records remain accessible to currently authorised administrators; corrupted payloads are withheld.

An administrator can:

- **Acknowledge a reported pass**, retaining it as a customer report. Failure or unknown outcomes cannot use this path.
- **Create an owned follow-up** for a current observation. A current writer and a due date from today to one year ahead are required. RegPilot creates one ordinary **OPEN** task linked to the control and observation, visible in the existing work hub and in scoped task reads.
- **Reject a submission**, including a stale one, with a review rationale.

All decisions require explicit confirmation, at least 20 characters of rationale, the current observation version and a UUID operation key. Exact retries reuse the prior decision/task. Lost acknowledgements recover the saved receipt. None of these operations closes another task, approves evidence or marks a control effective.

## Persistent limits and recovery

| Limit | Enforcement |
| --- | --- |
| 60 requests per credential per UTC calendar minute | PostgreSQL persisted rate admission. |
| 300 requests per company per UTC calendar minute | Reserved atomically with the credential unit. |
| 200 new observations per company per rolling 24 hours | Checked inside the ingestion transaction; existing replay does not add an observation. |
| 500 observations awaiting administrator review | Requires the company to review or reject its pending reports before accepting more. |
| 20 active credentials, 50 controls per credential | Expired and revoked credential history does not block creation. |

Authenticated admissions consume a rate unit, including scope rejection, malformed business requests and idempotent retries. Invalid or inactive credentials do not enter the per-company ledger. A request rejected because a rate budget is full reserves neither unit: the transaction rolls both reservations back. Old rate windows are pruned after 24 hours. This provides distributed correctness across application instances; it is not an edge denial-of-service defence or a throughput benchmark.

Successful admitted responses expose `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix seconds). Remaining is the smaller remaining client/company allowance. **429 `rate_limited`** includes `Retry-After`. Other 429 codes (`observation_allowance`, `review_queue_full`) describe the intake condition that must clear. There is no automatic outgoing delivery or webhook retry service in this release.

## Administrative endpoint reference

These are the existing private workspace auth boundary, not machine-key APIs. They require a verified workspace bearer, current OWNER/ADMIN membership and `organizationId` in the URL.

- `GET /api/workspace/developers`: safe credentials, explicit current controls (first 200), writer members (first 100), review page and activation/limit metadata. Optional `requestKey` returns only the caller's exact operation receipt or null. Optional `credentialId`/`observationId` recover exact same-company historical records. `all=true` includes reviewed history; `beforeId` advances a bounded observation page.
- `POST /api/workspace/developers`: `{name, scopes, controlIds, expiresAt, requestKey, confirm:true}`. Returns a one-time secret only for the original operation.
- `PATCH /api/workspace/developers/credentials/{id}`: `{action:"ROTATE"|"REVOKE", version, requestKey, confirm:true}`.
- `POST /api/workspace/developers/observations/{id}/review`: `{decision:"ACKNOWLEDGE"|"FOLLOW_UP"|"REJECT", version, notes, requestKey, confirm:true}` and, only for follow-up, `ownerId` and `dueDate`.

## Verification and practical boundary

The implementation adds five private PostgreSQL tables with company-bound composite foreign keys, restrictive Data API permissions, explicit grants, exact-operation uniqueness and rate-budget uniqueness. The SQL migration is `prisma/changes/customer-api.sql`.

The focused test suite covers real PostgreSQL credential lifecycle/recovery, tenant and control isolation, current issuer authority, rotation/expiry/revocation, cursor boundaries, private metadata, machine attribution, concurrent idempotent ingestion, explicit follow-up, stale context, atomic rate limits, actual route-handler bodies and historical pagination. Domain/HTTP tests cover schemas, cursor binding, OpenAPI and authentication before body parsing. `scripts/customer-api-customer-journey.mjs` exercises the actual application, authenticated browser, private programme document, API and persisted task; it never exports a bearer secret.

This is a supported bounded integration surface with an explicit versioned contract. It is not a library of hundreds of native connectors, arbitrary schema-based evidence ingestion, a custom join/rule engine, OAuth delegated applications, MCP, outbound signed webhooks or an uptime SLA. Compatibility within `/api/v1` permits additive response fields; clients should ignore unknown response fields. Incompatible semantics require a new major path.

## Competitive rationale

Vendor sources establish that customer extensibility is a substantive competitive capability: [Vanta API](https://www.vanta.com/products/vanta-api) advertises private integrations and granular access; [Drata custom connections](https://developers.drata.com/openapi/reference/v2/tag/Custom-Connections/) documents custom evidence schemas and connection types; [CUBE RegConnect](https://www.cube.global/products/regplatform/regconnect) connects regulatory data to downstream workflows; [Sprinto's developer API documentation](https://developer.sprinto.com/docs/sprinto-developer-api-documentation) describes administrator-managed credentials and API access. These are vendor descriptions, not independent demonstrations of quality or a claim that RegPilot has matched their entire integration platforms.

The implemented advantage is concrete: a customer can connect an otherwise unsupported internal system to its own controls, keep the machine's claim distinguishable from human review, and route an accepted investigation into the existing owned task system with exact retry recovery.

## Versioned partner connector

Download the Node.js connector from the developer workspace. Configure your own HTTPS RegPilot origin and server-side customer token. With an authorised source and a granted control, save a JSON envelope containing a UUID `requestKey` and an `observation` conforming to the OpenAPI contract. Run `node partner-connector.mjs envelope.json`. Retain the same envelope for retries and store the returned receipt hash with the source record.

For the first revision use `schemaVersion: 1`, `revision: 1` and a stable `recordId`. For a correction use the next revision, a fresh external ID and the previous receipt as `previousHash`. A credential rotation preserves the series. A dispute or withdrawal makes the previous version ineligible. Supplier relationships require a consent reference and expiry. The specialist attestation contains only scope and decision references. Keep names, allegations and case files in the originating system. A source link is optional. RegPilot displays its location and does not fetch it.

### Serialised shipment comparison

In Company integrations, open **Reconcile serialised packs from EPCIS files**. Select separate shipping and receiving GS1 EPCIS 2.0 JSON documents, choose the control and identify the source and decision owner. The comparison runs locally. Submit the downloaded observation with the authorised server-side partner connector to retain the source events and their receipt for review. The comparison date is distinct from the event dates. A correction uses the existing record ID, next revision and predecessor receipt hash.

Each document must use the standard GS1 EPCIS context and one OBSERVE ObjectEvent, one dispatch advice (`desadv`), an event UUID, a read point (SGLN) and 1–80 distinct SGTIN pack identities. Files with extensions, error declarations, mixed quantities, multiple events or unsupported identifiers require a different importer. For this profile, a changed dispatch advice, repeated event identity, identical read points or receipt predating dispatch yields an unknown comparison. Otherwise the server compares exact serials and reports missing and unexpected packs. The result describes the two submitted events. Batch release, recall scope and trading-partner authentication require their own evidence.

### Hosted integrations and customer AI accounts

In Company integrations, refresh the provider catalogue and enabled integrations separately. The catalogue comes from Nango. A catalogue entry is discoverable before the workspace has credentials or a monitored source. Administrators can enable eligible API-key integrations for their own organisation when self-service is active. OAuth and other preconfigured integrations use operator-published IDs prefixed with `regpilot-`. Hosted authorisation tags each grant with its organisation and integration. Renewal targets the same grant. The browser receives only a short-lived authorisation link.

Configure `REGPILOT_MARKETPLACE_ENABLED=true` and a server-side `REGPILOT_NANGO_API_KEY` for the intended broker environment. Optional self-service uses `REGPILOT_MARKETPLACE_SELF_SERVICE_ENABLED=true` and the broker integration-create permission. Set `REGPILOT_SYNC_MODELS` to a JSON object mapping enabled integration IDs to deployed sync model names. A manual collection records counts, modification times and a sample digest. A Managed provider sync in Operations runs the same check against a control on its configured schedule. Reads stop after 200 records and identify a partial sample. Cached metadata is separate from upstream control effectiveness. The native evidence connector pilot retains its existing 20-target limit per organisation.

For customer AI, publish an OpenAI or Anthropic integration or use hosted API-key setup. Set the comma-separated `REGPILOT_CUSTOMER_OPENAI_MODELS` or `REGPILOT_CUSTOMER_ANTHROPIC_MODELS` to exact provider model IDs. An administrator verifies the model using their linked account and an AI Studio user explicitly selects that account. The existing governance checks, daily allowances and independent review still apply. Customer routing sends extracted text for document review. Keys stay with the broker. Unlinking removes the model from RegPilot generation. Provider-side revocation is available in the provider account.

For use inside ChatGPT, import the read-only Action schema from `/api/v1/chatgpt` into a private GPT and configure a dedicated RegPilot Bearer credential. Grant only the required read scopes and controls, restrict GPT access to authorised workspace users and revoke the credential in Company integrations when access ends. This route reads granted controls, linked tasks and reviewed source metadata.

### Operational verification

Operations → Connections offers a verification history for each saved target. It lists integrity-checked read receipts, outcomes and configuration versions. It checks whether two reads span the configured sampling interval and links a credential replacement to reads on its immediately preceding and following configurations. Supplying the same secret again does not create a replacement. The download examines the latest 100 runs and 50 configuration records and marks a truncated history.

For UbiBot, enter the channel and physical serial, certificate file and approved revision, valid dates, Celsius limits and maximum sample age. A second administrator downloads the approved certificate in Operations, checks the instrument and settings, and confirms the match. Collection checks the current certificate and reviewer when saving the sample. The exported observation rechecks the same basis. Benchling reads the specified assay result and its associated notebook entry, checks the assigned independent decision-maker and current accepted review, and retains the source identifiers and outcome.
