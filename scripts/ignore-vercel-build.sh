#!/bin/sh
# Git automatic deployment remains disabled for the development branch.
# Permit only the recorded staging release commits on the development branch.
if [ "$VERCEL_GIT_COMMIT_REF" = "feature/traceability-benchmark-batch-20261106" ]; then
  if [ "$VERCEL_ENV" = "preview" ]; then
    case "$(git log -1 --format='%s|%P')" in
      'Release custom monitoring tests and resource findings to staging|21f0f9f96a2c09358a0a271b17689de660aaae1d'|'Release competitive gap improvements to RegPilot staging|eea0b63108246ccf2b68bcef68b99cb4d1fa00b0'|'Release the verified questionnaire handoff to RegPilot staging|27c50df9a9591763b29bf072ada23c17f420ab2f') exit 1 ;;
    esac
  fi
  exit 0
fi

# Preserve the existing operational-commit guard for other branches.
git log -1 --format=%s | grep -Ex 'Activate pinned RegPilot public source watch|Activate RegPilot private automation worker'
