-- Draft migration for PostgreSQL. Review against the live schema before applying.
-- Existing Evidence remains the canonical document record.
ALTER TABLE "Evidence"
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'Other',
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "expiresOn" DATE,
  ADD COLUMN IF NOT EXISTS "reviewOn" DATE,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" UUID;
ALTER TYPE "ReviewStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
CREATE UNIQUE INDEX IF NOT EXISTS "Evidence_id_organizationId_key" ON "Evidence" ("id", "organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Obligation_id_organizationId_key" ON "Obligation" ("id", "organizationId");
CREATE TABLE IF NOT EXISTS "DocumentActionLink" (
  "id" UUID PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "evidenceId" UUID NOT NULL,
  "obligationId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentActionLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT,
  CONSTRAINT "DocumentActionLink_evidence_org_fkey" FOREIGN KEY ("evidenceId","organizationId") REFERENCES "Evidence"("id","organizationId") ON DELETE RESTRICT,
  CONSTRAINT "DocumentActionLink_obligation_org_fkey" FOREIGN KEY ("obligationId","organizationId") REFERENCES "Obligation"("id","organizationId") ON DELETE RESTRICT,
  CONSTRAINT "DocumentActionLink_evidence_obligation_key" UNIQUE ("evidenceId","obligationId")
);
CREATE INDEX IF NOT EXISTS "DocumentActionLink_org_action_idx" ON "DocumentActionLink" ("organizationId","obligationId");
CREATE INDEX IF NOT EXISTS "Evidence_org_expiry_idx" ON "Evidence" ("organizationId","expiresOn");
