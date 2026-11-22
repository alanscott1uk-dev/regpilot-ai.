#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Build the requested staging preview for custom source tests and resource findings.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ] &&
     [ "$(git log -1 --format=%s)" = "Release custom monitoring tests and resource findings to staging" ] &&
     [ "$(git rev-parse HEAD^)" = "21f0f9f96a2c09358a0a271b17689de660aaae1d" ]; then
    exit 1
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
