# Browser tests

Run these commands from a RegPilot checkout on Linux or macOS with Bash, Git, Python 3, Node 22 and npm.

| Command | What it exercises |
| --- | --- |
| `npm run test:browser` | Production build, desktop and mobile navigation, public screens and simulated workspace journeys |
| `npm run test:browser:private` | Production build with disposable local Supabase Auth, email, PostgreSQL and private Storage, plus a ClamAV scanner with a test signature and a local OCR fixture |

Both commands test the current working files, including new non-ignored files, in a temporary directory. Each run installs locked dependencies, builds its own copy of the app and saves its reports and screenshots under `artifacts/browser-runs/<run>/usability`. The path is printed on exit. GitHub Actions uses the same commands and uploads the reports as workflow artifacts.

The public suite runs axe-core against the signed-out workspace at desktop and mobile sizes. The private suite also checks the expanded product coverage controls after an authenticated spreadsheet import. Reports identify affected selectors and rules, alongside results that need manual review. Automated violations fail the journey.

Install operating-system dependencies for Chromium on Linux by setting `REGPILOT_BROWSER_INSTALL_DEPS=1` for the run. To use an existing Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its absolute executable path. CI uses Playwright's bundled Chromium.

The private suite also needs a local Docker daemon, Supabase CLI 2.83.0, psql and curl. It reserves localhost ports 3000, 3310, 4029 and the default Supabase stack ports. Stop any service using those ports before running. The runner generates fresh local keys, creates its own Supabase project and scanner, and removes them on exit. First use downloads the required container images.
