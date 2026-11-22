#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested staging monitoring preview.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Verify all five logger outcomes and publish the participant pilot" ] &&
     [ "$(git rev-parse HEAD^)" = "038ae85f8034718facd722ef9a35e4983599f337" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
