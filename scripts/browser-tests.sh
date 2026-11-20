#!/usr/bin/env bash
# Run the working tree in an isolated build directory. See docs/browser-tests.md.
set -euo pipefail
mode=${1:-}
case "$mode" in public|private) ;; *) echo 'Choose public or private.' >&2; exit 2 ;; esac
root=$(git rev-parse --show-toplevel)
cd "$root"
if [[ "$mode" == private ]]; then
  for bin in docker supabase psql curl; do
    command -v "$bin" >/dev/null || { echo "Private browser tests require $bin." >&2; exit 2; }
  done
  docker info >/dev/null
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/regpilot-browser-XXXXXXXX")
src="$work/source"
output="$root/artifacts/browser-runs/${work##*/}"
if [[ ${GITHUB_ACTIONS:-} == true ]]; then output="$root/artifacts"; fi
mkdir -p "$src"
cleanup() {
  code=$?
  trap - EXIT
  if [[ -d "$src/artifacts/usability" ]]; then
    mkdir -p "$output"
    cp -R "$src/artifacts/usability" "$output/" || code=1
    echo "Browser reports: $output/usability"
  fi
  rm -rf -- "$work"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Copy working files, including uncommitted changes, without local env or ignored outputs.
git ls-files --cached --others --exclude-standard -z | python3 -c '
import os, shutil, sys
from pathlib import Path
dest = Path(sys.argv[1])
for name in sys.stdin.buffer.read().split(b"\0"):
    if not name: continue
    p = Path(os.fsdecode(name))
    if p.name.startswith(".env") or not p.is_file(): continue
    if p.is_symlink(): raise SystemExit(f"Cannot snapshot linked source file: {p}")
    (dest / p).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, dest / p)
' "$src"
cd "$src"
# Keep development tooling settings. Application credentials come from fixtures.
settings=("HOME=$HOME" "PATH=$PATH" "NEXT_TELEMETRY_DISABLED=1")
for key in TMPDIR CI HTTPS_PROXY HTTP_PROXY ALL_PROXY NO_PROXY https_proxy http_proxy no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE PLAYWRIGHT_BROWSERS_PATH PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH REGPILOT_BROWSER_INSTALL_DEPS DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG; do
  if [[ -n ${!key:-} ]]; then settings+=("$key=${!key}"); fi
done
env -i "${settings[@]}" bash scripts/browser-test-stack.sh "$mode" "$work"
