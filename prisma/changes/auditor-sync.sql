BEGIN;
ALTER TABLE "AuditGrant"
  ADD COLUMN "apiKeyHash" VARCHAR(64),
  ADD COLUMN "apiIssuerId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "apiExpiresAt" TIMESTAMP(3),
  ADD COLUMN "apiLastUsedAt" TIMESTAMP(3),
  ADD CONSTRAINT "AuditGrant_api_key_complete" CHECK (
    ("apiKeyHash" IS NULL AND "apiIssuerId" IS NULL AND "apiExpiresAt" IS NULL)
    OR ("apiKeyHash" IS NOT NULL AND "apiKeyHash" ~ '^[a-f0-9]{64}$' AND "apiIssuerId" IS NOT NULL AND "apiExpiresAt" IS NOT NULL)
  );
ALTER TABLE "CustomerApiBudget"
  DROP CONSTRAINT "CustomerApiBudget_fields_check",
  ADD CONSTRAINT "CustomerApiBudget_fields_check" CHECK (
    "count" >= 0 AND "minute" = date_trunc('minute',"minute") AND (
      "bucket" IN ('company','auditor-company') OR "bucket" ~ '^(key|auditor):[a-f0-9-]{36}$'
    )
  );
COMMIT;
