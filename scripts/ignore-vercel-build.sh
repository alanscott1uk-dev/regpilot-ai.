#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested staging monitoring preview.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Publish RegPilot daily pharmaceutical benchmark staging 20261122" ] &&
     [ "$(git rev-parse HEAD^)" = "ca8f43eef4edc59160f85f4a61bd3890b3b8846d" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
