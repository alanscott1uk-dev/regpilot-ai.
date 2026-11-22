#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested staging monitoring preview.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Publish RegPilot verified customer connections staging 20261122" ] &&
     [ "$(git rev-parse HEAD^)" = "3592f02b0f8e602ec6309c35e2c187e3801082e0" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
