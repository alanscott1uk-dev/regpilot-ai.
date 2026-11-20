# Signed integration deliveries

## Implemented scope

The private **Integration deliveries** workspace at `/team/integrations` connects real RegPilot observations and administrator decisions to an authorised customer receiver. It includes company-scoped endpoint configuration, an encrypted signing-secret lifecycle, receiver verification, a durable transactional outbox, bounded network delivery, persisted attempt history, automatic retries, dead letters, and explicit administrator replay.

This extends the scoped customer API. A customer system can submit an attributed control observation; an administrator can create an owned follow-up; the receiver then receives separately typed events for the submission and the human decision. Connector observations and collection failures also produce events. A successful receiver response never approves evidence, certifies compliance, changes a report into independently verified evidence, or completes a task.

Vanta's published webhook product documents administrator configuration, HTTPS receivers, selected events, signed requests, attempt logs, retry/replay and at-least-once delivery. Those capabilities motivated this implementation boundary. This does not claim Vanta's event breadth, integrations, five-day retry window, operating scale or reliability history. Source: [Configure and Use Webhooks in Vanta](https://help.vanta.com/en/articles/13909210-configure-and-use-webhooks-in-vanta), published 12 May 2026.

## Activation and authority

`REGPILOT_OUTBOUND_INTEGRATIONS_ENABLED` defaults to `false`. Existing workspace configuration and allowed-user gates also apply. Dispatch additionally requires `REGPILOT_AUTOMATION_ENABLED=true` and an enabled private worker or cron environment. The scheduled worker owns dispatch; a workspace button only queues work. No new hosted activation, paid provider, outbound message or public receiver was enabled by the implementation.

Administrators and owners can prepare, inspect, pause, resume, rotate or revoke endpoints. Creation requires a current accepted control programme and eligible control owners. The endpoint remains tied to its original issuing administrator. Revocation or loss of that administrator's authority prevents new network admission. Each request rechecks the active company; composite foreign keys bind endpoint, control, event, delivery and attempt records to that company. The seven tables are private: the additive migration enables RLS, removes public/Supabase browser-role privileges, and grants only the established private runtime role where it exists.

Each endpoint has immutable URL, event permissions, control grants and expiry. Create another endpoint to change those values. Maximums are ten non-revoked, unexpired configurations per company, fifty controls per endpoint, and a ninety-day credential lifetime. Historical configurations do not exhaust active capacity.

## Configuration and signing-secret lifecycle

1. Create an endpoint with a public HTTPS URL and explicit controls and event types.
2. Save the masked one-time `rpd_…` secret in the receiver's secret manager. The sender retains an AES-256-GCM encrypted copy using the existing connector encryption key and a distinct endpoint-specific authenticated context. Plaintext secrets are not stored in operation receipts, audit JSON or logs.
3. Queue the verification challenge. A real successful delivery with the exact echoed challenge is required to change `DRAFT` to `ACTIVE`.
4. Inspect actual attempts and acknowledgements. An untested endpoint is never presented as successfully connected.

Rotation generates a new secret, increments both the endpoint and secret version, cancels existing queued work and returns the endpoint to `DRAFT`. A new challenge must succeed. Revocation removes the encrypted secret and cancels pending or leased work. An already transmitted request cannot be unsent; settlement is fenced against a concurrent revocation or configuration change. Pause/resume preserves the original grants and expiry. Pausing cancels already queued work, and resuming does not invent replacements for events missed while inactive.

Every administrator mutation carries a UUID request key and an input hash. Repeating that exact request returns the saved receipt. A different actor or payload cannot reuse it. `GET /api/workspace/integrations?organizationId=…&requestKey=…` recovers a lost acknowledgement without creating another endpoint, rotating again or replaying again. Secret plaintext is returned only by the first successful create/rotate response. Recovery never returns it; a lost secret requires explicit rotation.

## Events and minimum data

All envelopes carry `apiVersion: "2026-11-20"`, a stable event `id`, `type`, `organizationId`, `occurredAt`, a versioned `source`, the recipient's granted `controlIds`, and typed `data`.

| Type | Payload and meaning |
| --- | --- |
| `endpoint.probe` | Endpoint ID and a random challenge. No control records. |
| `customer.observation.received` | Observation ID, originating credential ID, reported outcome and expiry. The report remains unverified. |
| `customer.observation.reviewed` | Observation ID, originating credential ID, reported outcome, administrator decision, optional follow-up task ID and expiry. This records an explicit human decision. |
| `connector.observation.recorded` | Connector and run IDs, verified stored result hash and collection outcome (`OBSERVED`, `FOLLOW_UP` or `INCOMPLETE`). The event does not assert that a control is compliant. |
| `connector.collection.failed` | Connector ID and a bounded failure code tied to the actual recorded failure audit event. |

There are no evidence bytes, storage paths, filenames, quoted document passages, customer report summaries, human review notes, raw provider responses or target credentials in these envelopes. A shared connector can map to several controls. Each recipient's body contains only the intersection of those controls and its own explicit grants.

The outbox insert is in the same PostgreSQL transaction as the source mutation. Exact customer submission/review recovery cannot create another event. Dispatch rechecks the envelope hash and source record, current source issuer/reviewer permissions, current control owners, endpoint grants, source expiry and unchanged source configuration. A stale or unavailable source cancels delivery with a visible code. Consumers should use the scoped customer API to obtain current state before acting on a recorded event.

## Receiver protocol

The sender uses these headers:

| Header | Contract |
| --- | --- |
| `RegPilot-Event-Id` | Stable event ID. |
| `RegPilot-Delivery-Id` | Stable delivery ID for this endpoint. Use as the durable deduplication key. |
| `RegPilot-Attempt-Id` | New UUID for every persisted network attempt. |
| `RegPilot-Timestamp` | Decimal Unix timestamp in seconds. |
| `RegPilot-Signature` | `v1=` followed by hexadecimal HMAC-SHA256. |

Calculate the HMAC using the base64url-decoded bytes after the secret's `rpd_` prefix, over the exact string `deliveryId.timestamp.rawBody`. Verify the timestamp within five minutes and compare equal-length signatures in constant time **before** parsing JSON. The reference implementation is `verifyDeliverySignature` in `lib/server/integration-delivery-transport.ts`; the controlled receiver independently implements the same contract. Never verify a re-serialized JSON body.

For a probe, return a 2xx JSON body containing the exact `data.challenge`, for example `{"challenge":"<received challenge>"}`. Ordinary events require a 2xx acknowledgement. The receiver should persist the stable delivery ID and its intended work atomically before responding. If the ID is already accepted, acknowledge it without repeating its effects. No receiver-supplied response content is retained beyond the bounded challenge and response metadata.

Delivery is **at least once**. A receiver may accept a request just before the sender loses its database lease or acknowledgement. Recovery resends the same event/delivery IDs with a new attempt ID. Replays have the same duplicate risk. There is no exactly-once delivery claim.

## Network policy

The production transport accepts only HTTPS DNS hostnames on port 443, with no credentials, query string or fragment. It rejects IP literal URLs and local/special host suffixes. Every attempt resolves DNS, rejects private/reserved IPv4 answers, and pins a validated public IPv4 address in the connection lookup while retaining the original hostname and TLS server-name/certificate verification. The implementation is IPv4-only; an IPv6-only receiver is unsupported. Redirect responses are terminal and never followed.

The transport has a two-second DNS bound within an eight-second total request deadline, 16 KB maximum request body, 8 KB maximum response headers and 4 KB maximum response body. It uses a fresh socket and fixed headers; arbitrary customer headers and HTTP proxy configuration are unsupported. It rechecks current delivery authority after DNS resolution immediately before network admission, then rechecks source and endpoint eligibility at settlement. Response bodies and raw destination IPs are not stored; attempt records retain a peer-address hash and bounded metadata.

The implementation uses [Node.js HTTPS](https://nodejs.org/api/https.html) request options and [Node.js DNS](https://nodejs.org/api/dns.html) resolution. A controlled receiver dependency injection exists only in test helpers. There is no runtime flag, environment allowlist or shipping route that permits localhost/private destinations.

## Retries, budgets and recovery

One endpoint has at most one live delivery lease. Workers select the least recently dispatched eligible endpoint with row locking and `SKIP LOCKED`. A thirty-second lease and token fence prevent an expired worker from acknowledging or releasing a replacement worker's job. An expired sending attempt is recorded as `INTERRUPTED` before replacement. Network calls occur outside database transactions.

Per-company transactions reserve all required budget units before each attempt: six per endpoint per minute, thirty per company per minute and 2,000 per company per UTC day. A blocked company reservation does not consume an endpoint unit. Deferral records its next eligible time and performs no network request. Default batches admit at most twelve deliveries, with at most two concurrent endpoint sends and a twenty-second admission deadline.

Network interruptions, HTTP 408/429 and 5xx responses retry with delays of 1 minute, 5 minutes, 15 minutes, 1 hour and 6 hours. A numeric `Retry-After` can extend the delay to at most one day. Six attempts exhaust one cycle. Other non-2xx responses, redirects, an invalid challenge, blocked destinations and terminal integrity/configuration errors do not silently retry forever. Events expire after at most 72 hours, sooner where the source expires. A retry beyond expiry becomes terminal.

An administrator may explicitly replay a current `DEAD` or ordinary `DELIVERED` event up to three times, while all source, secret-version and endpoint gates remain valid. Replay resets the cycle count while retaining every attempt and the stable event/delivery identity. A completed verification probe requires no replay; secret rotation creates a new verification version. Rotation, revoked sources and expired events cannot be bypassed through replay.

At 200 pending deliveries, the next matching source mutation persists a `QUEUE_CAPACITY` dead letter and pauses the endpoint. Later matching events increment an explicit skipped counter. The application does not block the source business mutation or claim those events were delivered. Pausing prevents admission of the old queue; reconcile current scoped API state before restoring the receiver. This is bounded backpressure, not an unbounded lossless event log.

## Monitoring and verification boundaries

The UI shows actual queued/sending/dead counts, oldest pending time, last acknowledgement/failure, skipped-event gaps, delivery expiry, HTTP codes, attempt durations and bounded response sizes. The twenty-four-hour acknowledgement count includes successful probes and duplicate/replayed attempts; the label states that scope. No uptime or success percentage is inferred from a small test sample. Worker health reports unresolved dead letters and queues older than ninety minutes. Independent policy-release evaluation is also wired into the primary worker slot, preserving its own signer/source/training gates.

History is cursor-paged in groups of fifty. The UI shows the latest hundred endpoint configurations plus all active ones; exact endpoint/delivery links can retrieve older retained records. Terminal delivery/attempt history is pruned after thirty days in bounded batches; pending work is preserved. Unreferenced old events and budget windows are also pruned. Administrator operation receipts remain durable for exact request recovery.

Verification includes strict domain and authentication tests, an actual local TLS transport test, seven PostgreSQL lifecycle/concurrency/scope cases, and a full private-service browser helper. The browser helper uses real authenticated UI/API operations and a real application-created control; it dispatches only to the controlled local TLS receiver, recovers a deliberately lost replay acknowledgement, and verifies that the human follow-up remains `OPEN`. Test routing is injected explicitly and does not weaken the production network policy. These checks establish bounded tested behaviour, not public-internet receiver availability, penetration-test certification or long-term delivery reliability.
