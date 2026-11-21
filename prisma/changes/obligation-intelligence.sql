-- Additive change from the b857436 schema. Do not apply to an unknown live schema.
BEGIN;
-- AlterTable
ALTER TABLE "Obligation" ADD COLUMN     "originKey" VARCHAR(64);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "organizationId" UUID NOT NULL,
    "activities" JSONB NOT NULL,
    "jurisdictions" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "IntelligenceRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "candidateKey" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "rationale" VARCHAR(800) NOT NULL,
    "reviewerId" UUID NOT NULL,
    "obligationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntelligenceRun_organizationId_createdAt_idx" ON "IntelligenceRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceRun_id_organizationId_key" ON "IntelligenceRun"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceRun_organizationId_snapshotId_profileVersion_en_key" ON "IntelligenceRun"("organizationId", "snapshotId", "profileVersion", "engineVersion");

-- CreateIndex
CREATE INDEX "IntelligenceDecision_organizationId_createdAt_idx" ON "IntelligenceDecision"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceDecision_runId_candidateKey_key" ON "IntelligenceDecision"("runId", "candidateKey");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_id_organizationId_key" ON "Obligation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_organizationId_originKey_key" ON "Obligation"("organizationId", "originKey");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySnapshot_id_organizationId_key" ON "RegulatorySnapshot"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_runId_organizationId_fkey" FOREIGN KEY ("runId", "organizationId") REFERENCES "IntelligenceRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RegPilot private-data hardening for tables managed by the server-side Prisma application.
-- Apply ONLY AFTER the matching Prisma tables exist and ONLY using a reviewed direct
-- database administrator connection. Supabase Auth does not use these Prisma tables.
--
-- This is an additional API-facing default-deny safety layer, not a complete tenant RLS
-- policy for the privileged direct-DB connection. Every server query must independently
-- enforce authenticated organisation membership. Never expose DATABASE_URL to browsers.
--
-- The SQL fails closed if any expected table is absent; it can be run repeatedly.

DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision'
  ] LOOP
    relation_name := format('public.%I',name);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'RegPilot private table % is missing; apply schema first',relation_name;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC',relation_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',relation_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$private$;


COMMIT;
