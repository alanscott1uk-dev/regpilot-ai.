# Paid service integrations — prepared, not activated

Development batch, 7 November 2026. All new runtime switches are false and allocation defaults are zero. No subscriptions, keys, paid API calls, emails, hosted migrations or deployments were created during implementation. The code extends the existing Next.js, Prisma, Supabase and AI Gateway architecture.

## Implemented service stack

| Service | Integration behaviour | Activation still required |
| --- | --- | --- |
| Vercel AI Gateway | Existing grounded AI workflows now require the paid master gate and a spending reservation, alongside their existing consent/request limits | Approved model/provider privacy, pricing, enforced provider budgets and live quality acceptance |
| Azure AI Document Intelligence | Explicit OCR request for a clean, independently approved PDF; fixed prebuilt-read model; asynchronous result polling; page-specific draft text | Dedicated resource/key, region and DPA review, representative scans and actual API acceptance |
| Resend | Approved task-owner email requests and optional owner-prepared daily overdue-reminder policy; idempotent submission; minimal content | Verified sending domain/key, delivery/bounce handling and suppression procedures, permission/privacy acceptance |
| Supabase SAML SSO | Company-domain sign-in through the existing PKCE client, exact operator domain allowlist and fixed return URL | Paid-plan eligibility, configured IdP, domain ownership, redirect/account linking and real multi-user acceptance |
| Stripe | Owner-only hosted subscription checkout and customer portal; server-selected price; verified, deduplicated webhook status | Test-mode merchant setup, recurring price and portal configuration, tax/cancellation terms and webhook acceptance |

PayPal direct subscriptions, licensed regulatory feeds, SCIM, mandatory organisation-specific SSO enforcement, full auditor portals and independent competitor performance validation are not included. Provider contracts, licences and hosting upgrades cannot be supplied by adding SDK code. No partnership with any provider is implied.

## Services & spending

`/team/services` shows provider activation state, monthly allocations, drafts and outcomes. Administrators can prepare OCR/reminder drafts without activating their providers. Only owners can prepare billing or change the spending/reminder policy. Setting an allocation or preparing a daily reminder policy does not turn on the master/provider flags.

Queueing requires an explicit approval and enabled provider, then reserves allocation before external work. Each new request starts DRAFT. A configured external `POST /api/internal/services` trigger uses the existing monitor bearer secret and automation flag, processes at most three queued/polling requests per invocation, and prepares overdue reminders for at most five policies and 20 tasks per policy. No scheduler was provisioned. Capacity and cadence must be measured before live use.

Prepared daily reminders exclude completed/unassigned work and existing same-day reminder targets. The worker verifies the policy owner, current assignment, recipient membership and pilot allowlist. A revoked policy owner pauses the policy. Recipients receive a generic sign-in link without task titles or document contents. Provider acceptance is labelled separately from actual inbox delivery; delivery webhooks and suppression management are still a release requirement.

## Spending reservations

The application records integer micro-USD allocations (1 USD = 1,000,000 micros). Every AI call, OCR page, reminder and checkout/portal request uses an operator-configured per-unit reserve. Monthly organisation and platform allocations are checked under a shared PostgreSQL advisory lock before a reservation is saved. Per-operation keys prevent duplicate reservations. Owner-entered organisation allocations can only reduce the operator's effective cap. Zero/missing limits block new reservations.

These are **reserved allocations, not measured provider spend or guaranteed maximum invoices**. Configure conservative reserves from verified prices and enforce monetary budgets at the providers. Taxes, FX, model/token differences, fixed subscriptions, hosting, payment-processing fees, authentication and polling traffic are not reconciled by this ledger. Ambiguous or failed requests keep their reservation; automatic refunds could enable repeated spend. The UI states these limits.

Existing AI daily user/organisation request allowances remain. All AI endpoints now also require `REGPILOT_PAID_SERVICES_ENABLED` and `REGPILOT_PAID_SAFEGUARDS_VERIFIED`; fixture tests explicitly set fictional allowances. A switch or attestation is not evidence of production readiness.

## OCR safety and scope

OCR preparation locally checks page count and verifies the stored file hash; the vault must already have an explicit CLEAN scan and independent approval. Sending requires separate approval. The adapter accepts private PDF bytes only (no caller-selected document URLs), uses the configured Azure resource with redirects refused, and limits documents to 5 MB/40 pages. Polling must remain on the same resource and exact prebuilt-read result path/API version. Responses are bounded to 2 MB and retained text to 80,000 characters, with matching page counts and ordinals.

A submission is never automatically repeated after an uncertain POST. A saved operation is polled without re-uploading. Interrupted submissions appear as needing attention; investigate provider history before creating another request. Pending operations expire after 20 hours. Hash, permission, gate, lease and version checks fence later result writes.

OCR text is a **machine draft** for inspecting the original. It does not authenticate handwriting, signatures, layout or legal meaning. It is deliberately not automatically substituted into grounded programme/assurance decisions; independently reviewed OCR-to-evidence incorporation remains outstanding. Removing retained content stops pending work and clears the local result, but does not delete the original vault file, provider-held data or required financial/security records.

## Billing and identity boundaries

Checkout uses a server-configured Stripe recurring price and fixed application return URLs. The browser cannot supply arbitrary amounts, customer IDs or redirects. Returning from checkout never grants membership, activates AI or changes provider gates. Signed events must match the server-created checkout and organisation; current subscription data is retrieved from Stripe, repeated events are deduplicated, and older events do not overwrite newer recorded state. Existing billing bindings are not silently replaced. Owners manage an existing account through Stripe's hosted portal, configured separately with cancellation/payment-method options.

Stripe webhook verification binds the exact raw body, timestamp (five-minute tolerance) and expected live/test mode. No card details are stored. Webhook subscription status is informational in this private pilot; commercial plan entitlement enforcement remains to be designed before selling accounts. No live price or customer charge was created.

SSO authenticates through the configured Supabase identity provider. It does not replace organisation membership or role checks. An SSO email/domain never grants a role automatically. Account identity/linking, domain verification, IdP logout/revocation and staged tenant isolation need real-service acceptance. Existing email sign-in remains available; mandatory SSO-only policies and SCIM are not claimed.

## Deployment and migration

Apply `prisma/changes/paid-services.sql` after `team-access.sql` on a backed-up reviewed database. It adds PaidBudget, PaidReservation, ServiceJob, BillingAccount and BillingEvent with scoped indexes and foreign keys, and applies default-deny Data API protection for all **32** private tables in the same transaction. `fixtures/schema-a41bb6d.prisma` records the preceding schema. CI applies the full additive chain on disposable PostgreSQL 17 and checks drift and anonymous/authenticated/service-role denial.

All credentials are server-only except existing Supabase publishable configuration. Keep keys out of source control/chat, prevent request/response-body capture in proxies/APM, and document rotation and provider retention. New schema has not been applied to hosted Supabase.

## Required acceptance

1. Run the complete CI chain, including resource bounds, signature replay, cross-organisation access, revoked users, assignment changes, redaction, duplicate jobs and concurrent allocation reservations.
2. Configure synthetic provider test accounts and verified sender/IdP resources outside source control. Verify terms, region, retention, spend enforcement, scanner/storage/authentication and backups.
3. Test end-to-end browser preparation → explicit approval → worker → actual provider → result, including failures and timeouts. Check desktop/mobile access and accessibility. Record actual duration, cost and output quality.
4. Complete Stripe test checkout/portal/cancellation and signed webhook replay/out-of-order tests. Confirm no paid processing becomes active solely due to a subscription event.
5. Complete OCR review and reminder delivery/suppression acceptance, load/recovery and provider-data erasure procedures. Then make activation a separate controlled change.

Official API contracts consulted:
- [Azure analyse](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0+(2024-11-30)) and [result polling](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/get-analyze-result?view=rest-aiservices-v4.0+(2024-11-30)).
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
- [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create) and [webhook handling](https://docs.stripe.com/events/manage-webhook-endpoints).
- [Supabase SSO](https://supabase.com/docs/reference/javascript/auth-signinwithsso).
