#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested staging monitoring preview.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Publish RegPilot customer source verification staging 20261122" ] &&
     [ "$(git rev-parse HEAD^)" = "cefa73a91abc14e0164a59a4eff1c34d6f3c32a9" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
