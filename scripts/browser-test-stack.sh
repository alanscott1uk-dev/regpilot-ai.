#!/usr/bin/env bash
# Called inside the source snapshot by browser-tests.sh.
set -euo pipefail
mode=$1
work=$2
npm ci --include=dev --no-audit --no-fund
if [[ -z ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-} ]]; then
  install_flags=()
  if [[ ${REGPILOT_BROWSER_INSTALL_DEPS:-} == 1 ]]; then install_flags+=(--with-deps); fi
  ./node_modules/.bin/playwright install ${install_flags[@]+"${install_flags[@]}"} chromium
fi
export REGPILOT_AI_ENABLED=false
if [[ "$mode" == public ]]; then
  export NEXT_PUBLIC_SUPABASE_URL=https://auth-fixture.example.invalid
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=fictional-browser-acceptance-only
  export REGPILOT_WORKSPACE_ENABLED=false
  npm run build
  node scripts/usability-browser-acceptance.mjs
  node scripts/work-hub-browser-acceptance.mjs
  exit
fi

# Each project gets a unique ID so cleanup can touch only this run's containers.
project="$work/${work##*/}-supabase"
scanner="${work##*/}-clamd"
mkdir "$project"
app_pid=''
ocr_pid=''
cleanup_stack() {
  code=$?
  trap - EXIT
  [[ -z "$app_pid" ]] || kill "$app_pid" 2>/dev/null || true
  [[ -z "$ocr_pid" ]] || kill "$ocr_pid" 2>/dev/null || true
  if docker inspect "$scanner" >/dev/null 2>&1; then docker rm -fv "$scanner" >/dev/null || code=1; fi
  if [[ -f "$project/supabase/config.toml" ]]; then (cd "$project" && supabase stop --no-backup) || code=1; fi
  exit "$code"
}
trap cleanup_stack EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node --input-type=module <<'JS'
import {createServer} from 'node:net';
for (const port of [3000, 4029, 3310, 54321, 54322, 54324]) {
  await new Promise((resolve,reject) => {
    const server=createServer().once('error',()=>reject(Error('Private journey needs free local port '+port)));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
}
JS
(
  cd "$project"
  supabase init --yes
  python3 - <<'PY'
from pathlib import Path
import re
p = Path('supabase/config.toml')
s, changes = re.subn(r'^additional_redirect_urls =.*$', 'additional_redirect_urls = ["http://127.0.0.1:3000/team/work", "http://127.0.0.1:3000/team/setup", "http://127.0.0.1:3000/team/settings", "http://127.0.0.1:3000/auditor"]', p.read_text(), flags=re.M)
if changes != 1: raise SystemExit("Unsupported Supabase redirect configuration")
p.write_text(s)
PY
  for attempt in 1 2; do
    if supabase start -x realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor > "$work/supabase-start.log" 2>&1; then break; fi
    docker ps -a --format '{{.Names}} {{.Status}}'
    # Print diagnostic classes only. Service logs can include disposable credentials.
    python - "$work/supabase-start.log" <<'PYCODE'
import re, sys
log = open(sys.argv[1]).read().lower()
for category, pattern in [("registry throttling", r"toomanyrequests|rate limit|429"), ("registry access", r"denied|unauthorized|403"), ("network", r"timeout|connection reset|eof"), ("image retrieval", r"failed to pull|manifest unknown"), ("service health", r"unhealthy|health check"), ("storage", r"no space")]:
    if re.search(pattern, log): print("Supabase startup:", category)
PYCODE
    if [[ $attempt == 2 ]]; then exit 1; fi
    # Hosted runners can exhaust one public registry. Retry the same pinned images from Supabase's other registry.
    if [[ ${GITHUB_ACTIONS:-} == true ]] && grep -Eqi 'toomanyrequests|rate limit|429|failed to pull' "$work/supabase-start.log"; then
      case ${SUPABASE_INTERNAL_IMAGE_REGISTRY:-} in
        public.ecr.aws) export SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io ;;
        ghcr.io) export SUPABASE_INTERNAL_IMAGE_REGISTRY=public.ecr.aws ;;
      esac
    fi
    sleep 3
  done
  supabase status -o json > "$work/keys.json"
)
read_key() {
  node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]))[process.argv[2]]; if(!v)process.exit(1); process.stdout.write(v)' "$work/keys.json" "$1"
}
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$(read_key ANON_KEY)
SUPABASE_SECRET_KEY=$(read_key SERVICE_ROLE_KEY)
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/regpilot_journey
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE regpilot_journey'
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export REGPILOT_WORKSPACE_ENABLED=true REGPILOT_EVIDENCE_ENABLED=true REGPILOT_ASSURANCE_ENABLED=true REGPILOT_PROGRAMME_ENABLED=true
export REGPILOT_CONNECTORS_ENABLED=true REGPILOT_AWS_ENABLED=true REGPILOT_GLEIF_ENABLED=true
export REGPILOT_AWS_BROKER_ROLE_ARN=arn:aws:iam::111111111111:role/fixture-regpilot-broker
export REGPILOT_AUDITOR_API_ENABLED=true
export REGPILOT_CUSTOMER_API_ENABLED=true REGPILOT_OUTBOUND_INTEGRATIONS_ENABLED=true
export REGPILOT_CONNECTOR_ENCRYPTION_KEY=1111111111111111111111111111111111111111111111111111111111111111
export REGPILOT_OCR_ENABLED=true REGPILOT_PAID_SERVICES_ENABLED=true REGPILOT_PAID_SAFEGUARDS_VERIFIED=true
export REGPILOT_OCR_RESERVE_MICROS=1000 REGPILOT_PAID_PLATFORM_MONTHLY_MICROS=1000000 REGPILOT_PAID_ORG_MONTHLY_MICROS=100000
export REGPILOT_APP_ORIGIN=https://regpilot.example.invalid
export AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://fixture.cognitiveservices.azure.com AZURE_DOCUMENT_INTELLIGENCE_KEY=fictional-ocr-contract-key
export REGPILOT_OCR_FIXTURE_URL=http://127.0.0.1:4029
export REGPILOT_AI_ALLOWED_EMAILS=editor@example.test,reviewer@example.test,auditor@example.test
export REGPILOT_EVIDENCE_BUCKET=journey-files REGPILOT_CLAMD_HOST=127.0.0.1

docker run --detach --name "$scanner" --publish 127.0.0.1:3310:3310 --entrypoint sh clamav/clamav:1.4_base -ec '
  mkdir -p /tmp/journey-db
  echo "RegPilot.Journey.Fixture:0:*:52454750494c4f545f5343414e5f46495854555245" > /tmp/journey-db/fixture.ndb
  printf "Foreground yes\nTCPSocket 3310\nTCPAddr 0.0.0.0\nDatabaseDirectory /tmp/journey-db\n" > /tmp/journey-clamd.conf
  exec clamd --config-file=/tmp/journey-clamd.conf
' >/dev/null
node --input-type=module <<'JS'
import {scanWithClamd} from './lib/evidence/file-guard.mjs';
import {fixturePdf} from './tests/helpers/pdf-fixture.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const scanner={host:'127.0.0.1',port:3310};
for(let attempt=0;;attempt++){
  try { assert.equal((await scanWithClamd(fixturePdf([['Fictional cold-chain record.']]),scanner)).status,'CLEAN'); break; }
  catch(error){ if(attempt>=29) throw error; await delay(1000); }
}
await assert.rejects(()=>scanWithClamd(fixturePdf([['REGPILOT_SCAN_FIXTURE']]),scanner),e=>e.status===422);
JS
npm run db:generate
node --import tsx --test tests/evidence-http.test.ts
./node_modules/.bin/prisma db push --skip-generate
npm run build
node scripts/ocr-provider-fixture.mjs > "$work/ocr.log" 2>&1 &
ocr_pid=$!
curl --noproxy '*' -fsS --retry 15 --retry-delay 1 --retry-connrefused http://127.0.0.1:4029/health >/dev/null
node --import "$PWD/scripts/ocr-provider-preload.mjs" node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000 > "$work/next.log" 2>&1 &
app_pid=$!
curl --noproxy '*' -fsS --retry 25 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/api/health >/dev/null
node scripts/evidence-journey.mjs
