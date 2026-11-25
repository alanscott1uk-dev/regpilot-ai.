#!/usr/bin/env bash
set -euo pipefail
# Only rebuild a disposable PostgreSQL database.
node -e "const u=new URL(process.env.DATABASE_URL); if (!['localhost','127.0.0.1'].includes(u.hostname) || !['/regpilot','/postgres'].includes(u.pathname)) process.exit(1);"
prisma=./node_modules/.bin/prisma
"$prisma" db push --schema fixtures/schema-b857436.prisma --skip-generate
while IFS= read -r migration; do
  "$prisma" db execute --file "prisma/changes/$migration.sql" --schema prisma/schema.prisma
done <<'MIGRATIONS'
obligation-intelligence
monitoring-semantic
evidence-assurance
programme-operations
obligation-library
team-access
paid-services
auditor-workspace
people-vendor-assurance
audit-evidence-requests
change-response
assurance-operations
connected-supplier-signals
worker-runtime
fair-dispatch
worker-capacity
integration-runtime
shared-source-fetch
automation-outbox
shared-connector-evidence
risk-register
questionnaire-drafts
product-scope
company-knowledge
capa
quality-handovers
quality-training-links
quality-stock-reconciliation
questionnaire-retries
training
customer-api
questionnaire-ocr
policy-effectivity
integration-delivery
quality-evaluations
horizon-watchlists
ai-inventory
risk-loss-scenarios
auditor-sync
vendor-site-authorisation
workspace-account-shortcuts
partner-and-trust
group-observation-follow-up
MIGRATIONS
