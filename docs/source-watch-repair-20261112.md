# Official text watch repair — 12 November 2026

The 21:02 scheduled run (43306256548) failed its text-retrieval step: 36/38 selected pages were retrieved; SEPA and Scottish Government were unavailable. Discovery, GitHub contract checking and publication succeeded. The public horizon remained current with 2,472 records and 12 available feeds at 21:03. A green horizon watchdog checks that discovery report, not the separate selected-text coverage.

SEPA's old `/topics/waste/duty-of-care` URL returns a genuine site 404. Its indexed trailing-slash variant also returns 404; search-index content was not accepted as a successful live capture. The current SEPA waste index (`https://beta.sepa.scot/regulation/waste/`) directly links to `https://beta.sepa.scot/regulation/waste/duty-of-care/`. Direct retrieval of that replacement returned HTTP 200, one H1 reading “Duty of care”, and bounded HTML. The curated URL/path is updated while retaining the stable source ID. Hash history treats the changed URL as a new baseline, not an unchanged document or legal continuity verdict.

Official HTML reads now use the existing fixed-origin bounded GET transport: at most three requests within 25 seconds, no redirects, no retry of ordinary permission denial/404, and no premature retry after a provider-requested wait. Extraction and identity checks remain unchanged. Safe reason codes and HTTP status are included in the failed-source manifest and job log; raw provider error text is excluded. Failed retrieval still fails the job rather than being suppressed.

The first repaired external probe (43312477451) retrieved 37/38 pages, including Scottish Government, and identified SEPA's 404 explicitly. This establishes recovery on that run but does not establish the exact cause of the earlier intermittent Scottish Government retrieval failure.

Final verification and schedule activation are recorded below after execution.
