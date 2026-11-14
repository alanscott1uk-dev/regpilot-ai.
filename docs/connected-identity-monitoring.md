# Connected identity monitoring — development batch, 7 November 2026

The existing Operations workbench now accepts a Microsoft 365 identity connection as well as GitHub. This is implemented integration code, not an activated customer service. Tests use fictional responses and isolated PostgreSQL data; they do not demonstrate live Microsoft availability or competitor parity.

## What the business owner receives

Choose an accepted control and its responsible owner, then ask a Microsoft administrator to configure the connection. Once the service and worker are activated, daily or weekly collections retain dated aggregate observations. Operations shows each signal, its reason, suggested next step, recent history and before/after changes. A failed collection preserves the previous observation and marks it no longer current.

Missing/failing signals, changed values or statuses, and collection failures create an in-app task for the control owner. There is at most one open task per connector; repeated failures do not flood the queue. A later successful observation does not silently complete that task. These are operational review targets, not statutory deadlines. The behaviour applies to both connector providers.

Observations become stale after the configured interval, after a configuration change, on disconnection or collection failure. Expiry is surfaced on reading the workspace/export; a stopped worker does not itself generate a fresh follow-up task. External notification delivery is not included. Downloads contain dated observations and an integrity hash, not a digital signature or compliance certification.

## Microsoft checks and interpretation

| Signal | Recorded scope | Important limit |
| --- | --- | --- |
| Security defaults | Boolean returned by Microsoft | Disabled defaults are UNKNOWN because alternative conditional-access policies may exist |
| Member MFA registration | Registered/not-registered aggregate for returned member accounts | Registration does not establish MFA enforcement at sign-in |
| Member MFA capability | Aggregate capability according to the report | Does not test sign-in policy or actual authentication |
| Administrator MFA capability | Capability among member accounts marked as administrators | Emergency-access exceptions need human review |
| Report coverage | Returned records/pages, account types and record freshness | Disabled users are excluded by the upstream report; guests are counted separately and not assessed for MFA |

Missing permissions, unavailable/licensed reports, incomplete pagination, unknown fields, no accounts, missing dates or records older than 48 hours cannot become an all-account pass. The 48-hour rule is a conservative local freshness threshold, not a Microsoft freshness guarantee. Known gaps in a fresh partial response can still produce a scoped follow-up. Successful observations never prove policy effectiveness or legal compliance.

## Credentials, requests and data minimisation

- A dedicated global-cloud Microsoft application uses application permissions `Organization.Read.All`, `Policy.Read.All` and `AuditLog.Read.All`, with administrator consent. Verify current licensing and supported report availability in the official documentation. Do not grant write, mail or document permissions.
- The user supplies the directory UUID, application UUID and client secret in the authenticated Operations form and explicitly consents to collection for an approved test tenant. Never put the secret in chat, source control or a support ticket.
- The client-credentials token exchange is the only POST. It goes to the configured tenant's fixed Microsoft login host. The adapter first reads the organisation ID and refuses a mismatch before reading settings/report data. All Graph operations are GETs against fixed endpoints.
- Redirects are refused. Pagination must remain on `https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails`, without embedded credentials or a fragment. Duplicate identifiers and pagination loops are rejected. The complete collection shares a 25-second timeout and is capped at 10 pages, 2,000 records, 1 MB per report response and 2 MB of re-encoded aggregate response bytes. Caps are not a licence to claim complete tenant coverage.
- API responses may include identifiers in transient server memory. The persisted result contains aggregates, settings, coverage, tenant ID and limitations; no individual names, email addresses, account identifiers, raw responses, secrets or access tokens. Proxy/APM configuration must also avoid request/response-body capture.
- Client secrets reuse AES-256-GCM encryption with organisation/connector-bound authenticated data. The form clears the credential field on submission; workspace responses and audit events do not return it. Rotation, disconnection, configuration changes and revoked membership fence in-flight results. Master-key rotation and customer offboarding still require the existing controlled procedures.

## Architecture and activation

No database migration is needed. Existing `EvidenceConnector.provider` selects the adapter. To maintain compatibility with the current schema, the `repository` column stores `microsoft365:<tenant UUID>` and `branch` stores the application UUID; UI labels are provider-specific. The namespace cannot collide with a valid GitHub repository target. Changing provider requires a separate connection. Changing tenant/application requires a fresh credential.

`REGPILOT_MICROSOFT365_ENABLED=false` is the default, in addition to the workspace, connector and encryption-key gates. Workers skip disabled Microsoft providers and recheck the flag before saving an in-flight observation. The existing authenticated automation trigger, leases, organisation transaction locks, retries and permission checks are reused. No additional hosting, scheduler, model call or subscription is created.

Before enabling real customer collection:

1. Finish authentication, tenant isolation, privacy/retention, secret handling and billing acceptance for the private workspace. Configure a synthetic Microsoft test tenant and dedicated application outside source control.
2. Verify successful reads, admin-consent removal, expired credentials, wrong tenant, disabled security defaults, empty/partial reports, licensing errors, throttling and report freshness against actual Microsoft responses. Check that no identifiers appear in retained observations or infrastructure logs.
3. Exercise browser setup, repeat collection, before/after history, owned task deduplication, stale exports, credential rotation, disconnection and member revocation in two staged RegPilot organisations. Repeat on mobile.
4. Confirm the external worker invokes the automation endpoint reliably, test retry recovery and capacity, and document incident/retention/offboarding procedures. Staging acceptance remains outstanding until recorded against actual services.

## Verification

`tests/microsoft365.test.ts` covers scoped requests, tenant mismatch, permissions, incomplete data, unsafe/looping pagination, response caps, dates, data minimisation and change comparison using an injected HTTP fixture. `tests/microsoft365.integration.test.ts` exercises persisted configuration, consent, permissions, encrypted credentials, concurrent claims, changed-signal tasks, failures, history, tenant boundaries and in-flight fencing in disposable PostgreSQL. The existing GitHub and programme suites remain required.

Official contracts consulted for this implementation:

- [Client credentials flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)
- [Read organisation](https://learn.microsoft.com/en-us/graph/api/organization-get?view=graph-rest-1.0)
- [Read security defaults](https://learn.microsoft.com/en-us/graph/api/identitysecuritydefaultsenforcementpolicy-get?view=graph-rest-1.0)
- [List user registration details](https://learn.microsoft.com/en-us/graph/api/authenticationmethodsroot-list-userregistrationdetails?view=graph-rest-1.0)
- [Registration detail semantics](https://learn.microsoft.com/en-us/graph/api/resources/userregistrationdetails?view=graph-rest-1.0)
