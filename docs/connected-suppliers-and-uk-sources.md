# Connected suppliers and broader UK sources

This batch adds three read-only collectors, brings public register observations into supplier review, and makes source coverage easier to inspect. It preserves the existing Next.js, Prisma and Supabase architecture. All provider flags default off; no paid call, confidential record, deployment or hosted migration was used.

## Collector scope

| Provider | Implemented collection | Explicit limits |
| --- | --- | --- |
| GitLab.com | Exact project/branch identity, returned matching branch protections, force push, direct push grants, pipeline and discussion merge settings | Up to five protection pages; all returned wildcard rules considered. Incomplete pages reject; unavailable rules remain unknown. No source code collected. Group rules absent from the endpoint, approval policies and operating effectiveness need separate review. |
| Cloudflare | Exact account and zone identity, SSL mode, minimum TLS, HTTPS redirect and TLS 1.3 settings | Four individual settings endpoints. Unavailable settings remain unknown. No DNS records or traffic retained. Per-host overrides, certificates and actual security effectiveness are not verified. |
| Companies House | Exact company number, registered name, status/detail, current next-accounts overdue indicator, confirmation overdue indicator, insolvency-history indicator | Selected public indicators only. Missing optional fields remain unknown. No officers, addresses or filing documents retained. Not credit, sanctions, ownership or insolvency prediction. |

Together with GitHub, Microsoft 365 and Google Workspace, the code contains six provider collectors. This is a count of implemented adapters, not six verified live integrations. External provider acceptance remains pending. The inherited pilot has 20 connection configurations per organisation, two jobs per worker batch, daily/weekly intervals, encrypted credentials, versioned leases and permission checks before and after collection.

The three new collectors share bounded response reading: 25-second overall fetch deadline, 12 requests, 256 KiB per response and 1 MiB overall; fixed HTTPS origins and no redirects. Provider credentials and raw responses never enter the retained observation. Only explicitly typed values can pass a check.

## Supplier workflow

1. In Operations, prepare a Companies House connection against an owned control. It remains unavailable until separately authorised activation.
2. In Suppliers, record the supplier and link the exact company number with a rationale and legal-entity confirmation. This increments the supplier version and invalidates previous reviews.
3. A successful collection creates an owned register review task if the signal has no current accepted baseline. Changed observations or collection failures create deduplicated follow-up for the supplier owner. Failed, expired, paused or superseded observations cannot sustain a current review. Mere clock expiry invalidates review currentness. An administrator can assign follow-up directly while collection is paused; reads never create work. Existing open follow-up is reused, concurrent requests deduplicate, and prematurely closed manual follow-up reopens with its earlier completion retained in the audit trail. Independent sign-off closes the review task while conditional remediation remains separate.
4. Prepare a supplier review with current independently reviewed documents, the exact observation and explicit acknowledgement. The draft freezes the register observation. Warnings or unknowns prohibit an unconditional approval recommendation.
5. A different administrator verifies the evidence and current context before and after retrieving file bytes. Accepted register review tasks close with a reference to that decision. Conditional register findings generate a separate owned remediation task; rejection and criterion gaps retain their existing follow-up. Task completion does not upgrade the recorded recommendation.
6. Renewed identical signals preserve the reviewed baseline. Changed target/configuration, supplier scope, ownership, evidence, signals or availability make dependent reviews stale. Later observations do not rewrite frozen review history. Handover transfers outstanding work and invalidates the prior supplier context.

Public register signals are prompts for investigation. Exact-number binding prevents response substitution, but a human must verify that this legal entity is the actual supplier. Automatic vendor discovery, credit feeds and threat intelligence are not implemented by this collector.

## UK source discovery and coverage

Eight curated references are added to the previous 17: two Acas codes, NCSC small-organisation cyber guidance, Food Standards Scotland start-up checklist, SEPA waste duty, Scottish fire guidance, HSENI risk assessment and Natural Resources Wales waste duty. [Retrieval evidence](official-source-retrieval-20261107.json) records exact URL/status/size/hash without retaining full publication HTML. All eight were publicly retrieved and passed the existing strict semantic-main/heading extraction checks on 7 November 2026.

Source History now filters by UK nation, business activity and text. These are discovery tags, not applicability determinations. Earlier and organisation-registered references without territory metadata remain visible and explicitly unclassified. The NCSC collection and Scottish publication page are selected overview pages; linked chapters/attachments are not recursively captured.

The private coverage read model finds the latest snapshot for every catalogue source independently of the 60-version history page. It displays baseline gaps, independent-review status, last check and schedule state. Selecting a source retrieves its own bounded history, including older baselines. Links lead to the existing applicability and independently reviewed requirement/control workflows. A reviewed source is never displayed as validated control coverage or legal compliance. No expert validation is claimed for these new references.

## Verification and release

New fixtures exercise all three provider configuration/encryption/tenant/rotation boundaries and disabled-provider cancellation; supplier linking, cross-tenant foreign keys, explicit observation acknowledgement, frozen history, same-signal renewal, changed-context races during evidence retrieval, independent decisions, conditional remediation, deduplication, collection failure, handover and expiry. Source fixtures cover territory filters, missing classifications, exact curated URLs and old-baseline coverage independent of pagination.

Apply `prisma/changes/connected-supplier-signals.sql` after `assurance-operations.sql` only during the reviewed release process. `fixtures/schema-0a1da08.prisma` preserves the previous schema. The migration adds nullable supplier/connection links, a frozen signal JSON column, indexes and composite tenant foreign keys. No new tables or Data API grants; 48 private tables remain.

Keep `REGPILOT_GITLAB_ENABLED`, `REGPILOT_CLOUDFLARE_ENABLED`, `REGPILOT_COMPANIES_HOUSE_ENABLED`, the master connector flag and all paid-service flags false. Feature preview deployments stay disabled.

Before activation, use dedicated fictional test targets with restricted read-only credentials. Verify GitLab `read_api` and target scoping; Cloudflare Zone Read + Zone Settings Read limited to one zone; Companies House Public Data API key/number binding. Exercise provider permission loss, rate limits, rotation and missing fields in staged Auth/Storage sessions. Test mobile and desktop forms and independent review. Local/CI fixtures are not verified provider operation; authenticated browser QA remains outstanding because the managed preview runner supplied incompatible Vite flags to Next.js.

Primary API references: [GitLab protected branches](https://docs.gitlab.com/api/protected_branches/), [GitLab authentication](https://docs.gitlab.com/api/rest/authentication/), [Cloudflare individual zone settings](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/get/), [Companies House profile](https://developer-specs.company-information.service.gov.uk/companies-house-public-data-api/resources/companyprofile?v=latest), [Companies House authentication](https://developer.company-information.service.gov.uk/authentication).

## Supplier attention workflow

The supplier screen defaults to actionable reviews, prioritising high-impact suppliers and review dates. Conditional and rejected decisions remain visible even when their review context is current. Archived suppliers remain in the unfiltered history. The detail screen compares latest recorded checks with the frozen accepted review, including newly reported and missing checks, and labels stale observations as historical. This comparison is against the accepted baseline, not merely the previous collection. Manual follow-up is version-checked, administrator-only, tenant-scoped and assigned to the current active owner; it does not fetch a provider or approve a supplier.

Current supplier reviews can be downloaded as JSON dossiers containing findings, evidence manifests, the frozen register observation and current follow-up task status. The service verifies actual stored file bytes and then rechecks administrator access, evidence, supplier context and the accepted review before release. Stale or replaced reviews cannot export as current. Files are not embedded, storage paths are withheld, and the integrity hash is not a digital signature. Export is audit logged.
