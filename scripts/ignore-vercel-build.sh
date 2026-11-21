#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested AI inventory and financial exposure preview.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Publish RegPilot AI inventory and GBP exposure preview 20261120" ] &&
     [ "$(git rev-parse HEAD^)" = "fbd4c774ab81fd897ce933811371bcaa9e32c08d" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
