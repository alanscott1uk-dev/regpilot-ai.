#!/usr/bin/env bash
# Rebuild the deterministic, bundled policy with a pinned local OPA compiler.
set -euo pipefail
cd "$(dirname "$0")/.."
compiler=${OPA_BIN:-opa}
version=$("$compiler" version | awk '$1=="Version:" {print $2}')
[[ "$version" == "1.22.4" ]] || { echo "This policy uses OPA 1.22.4" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"$compiler" check --strict lib/policies/connected-control.rego
"$compiler" build -t wasm -e regpilot/control/decision -o "$work/bundle.tar.gz" lib/policies/connected-control.rego
tar -xOzf "$work/bundle.tar.gz" /policy.wasm > "$work/policy.wasm"
node --input-type=module - "$work/policy.wasm" <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const base='lib/policies/connected-control',hash=value=>createHash('sha256').update(value).digest('hex');
const wasm=readFileSync(process.argv[2]);
writeFileSync(base+'.wasm',wasm);
writeFileSync(base+'.json',JSON.stringify({id:'connected-control-v1',compiler:'OPA 1.22.4',sourceSha256:hash(readFileSync(base+'.rego')),wasmSha256:hash(wasm)},null,2)+'\n');
JS
