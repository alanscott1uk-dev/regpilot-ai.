#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Permit the explicitly requested source research release in preview only.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Publish verified RegPilot source research preview 20261120" ] &&
     [ "$(git rev-parse HEAD^)" = "afdce76e07eb64adec65347c1e11c6e3bfc4c3f4" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
