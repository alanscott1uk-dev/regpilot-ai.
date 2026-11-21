# Official text watch repair — 12 November 2026

The 21:02 scheduled run (43306256548) failed its text-retrieval step: 36/38 selected pages were retrieved; SEPA and Scottish Government were unavailable. Discovery, GitHub contract checking and publication succeeded. The public horizon remained current with 2,472 records and 12 available feeds at 21:03. A green horizon watchdog checks that discovery report, not the separate selected-text coverage.

SEPA's old `/topics/waste/duty-of-care` URL returns a genuine site 404. Its indexed trailing-slash variant also returns 404; search-index content was not accepted as a successful live capture. The current SEPA waste index (`https://beta.sepa.scot/regulation/waste/`) directly links to `https://beta.sepa.scot/regulation/waste/duty-of-care/`. Direct retrieval of that replacement returned HTTP 200, one H1 reading “Duty of care”, and bounded HTML. The curated URL/path is updated while retaining the stable source ID. Hash history treats the changed URL as a new baseline, not an unchanged document or legal continuity verdict.

Official HTML reads now use the existing fixed-origin bounded GET transport: at most three requests within 25 seconds, no redirects, no retry of ordinary permission denial/404, and no shortened provider-requested wait within an invocation (long waits stop that invocation). Extraction and identity checks remain unchanged. Safe reason codes and HTTP status are included in the failed-source manifest and job log; raw provider error text is excluded. Failed retrieval still fails the job rather than being suppressed.

The first repaired external probe (43312477451) retrieved 37/38 pages, including Scottish Government, and identified SEPA's 404 explicitly. This establishes recovery on that run but does not establish the exact cause of the earlier intermittent Scottish Government retrieval failure.

## Verified repair and activation

- Application/source code: `54f4836f3fd13fbddb7cd8284bc3774d8d920bf5`.
- CI run [43312808493](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43312808493) passed: 411 tests (182 JavaScript, 190 TypeScript/API, 2 RLS and 37 PostgreSQL integration), audit, type checking, build, PDF runtime and 33-page smoke verification.
- Browser run [43312808537](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43312808537) passed all eight journeys.
- Independent external probe [43312808604](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43312808604) retrieved 38/38 text bodies with none unavailable.
- Staging deployment `dpl_Bny9RwVmydMW6YrHnCmvu5UKxhNh` reached READY with this application SHA.
- Main operational commit `861350bdc968b48dbdf7535ef929b05a534c1595` pins both collection and publication to the verified application SHA. The hourly schedule is active. Its production app deployment was intentionally canceled by the existing workflow-only deployment guard; this is not a promotion of the development application to production.
- Activated watch [43313400992](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/43313400992) passed both `probe` and `publish`. At 21:46 UTC it retrieved 38/38 text bodies, discovered 2,472 publications across 12 available feeds, and reported zero unavailable or limited feeds.
- Staging API verification confirmed both SEPA's replacement URL and Scottish Government as available. `/api/horizon/health` returned `current`, the 21:46 report and all 12 publishers available after publication.

These are observed successful runs, not a guarantee that external sources will never change or become unavailable. Optional Vercel and Supabase customer read contracts remain NOT_CONFIGURED; their absence is not represented as verified integration coverage.

## SEPA canonical-host migration and discovery diagnostics — 18 November 2026

The [11:52 source probe](https://github.com/alanscott1uk-dev/regpilot-ai./actions/runs/44298488871) retrieved 37/38 selected text bodies. SEPA failed with `PROVIDER_UNAVAILABLE`; HMRC discovery separately failed with `FETCH_OR_IDENTITY_FAILED` after learning that its window contained 1,151 results. Those earlier labels did not establish a publisher outage or identify the underlying failure.

A bounded direct inspection with redirect following disabled established the SEPA migration:

- `https://beta.sepa.scot/regulation/waste/duty-of-care/` returned **302** to `https://www.sepa.org.uk/regulation/waste/duty-of-care/`.
- The exact destination returned **200**, HTML and one H1 reading “Duty of care”.
- The official [waste index](https://www.sepa.org.uk/regulation/waste/) returned **200** and directly linked that same path as “Duty of care for businesses”.

The curated record now uses the verified `www.sepa.org.uk` URL, retaining source ID `sepa-waste-duty` and the same path. Arbitrary redirects remain rejected. The shared retrieval cache distinguishes the new URL. Tenant capture also now distinguishes the URL from the text hash: previously identical text could reuse an old approved record despite an address change. A recent check of the former address no longer suppresses capture of the current one. The new address receives a new baseline requiring independent review; the previous URL, approval and timestamps stay historical. An address-only migration is not labelled `CONTENT_CHANGED` and cannot create a text-change investigation. Concurrent captures produce one new record. Completed reports keep their frozen original source identity. The final development revision's source probe remains the evidence for application retrieval, distinct from this direct inspection.

An exact-window replay of HMRC's 1,151 search results found no invalid publisher identity, canonical path, missing field or duplicate. The earlier failure was not reproduced, so no recovery or root cause is claimed. The collector now reports bounded, predefined failure codes for HTTP status, response shape/JSON, publication path/timestamp/metadata, publisher identity and duplicate or conflicting pages. Failed feeds still reject partial staged results, retain older observations without changing their timestamps and keep the existing cooldown; provider bodies, raw parser errors and URLs are not copied into diagnostics. The report shape and unavailable/limited/available states are unchanged. These codes make a recurring failure diagnosable without weakening validation.

The [official GOV.UK Search API contract](https://docs.publishing.service.gov.uk/repos/search-api/using-the-search-api.html) remains the basis for the fixed publisher filter, timestamp ordering, bounded page size and offset pagination. No provider activation, scheduler change, production deployment or hosted data modification is included in this repair.
