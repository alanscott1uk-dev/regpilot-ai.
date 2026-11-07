-- Additive migration after monitoring-semantic.sql, from exact a5866b5 schema.
BEGIN;
-- CreateTable
CREATE TABLE "AssuranceAssessment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "failureCode" VARCHAR(40),
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "selectedPassages" JSONB NOT NULL DEFAULT '[]',
    "reviewedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssuranceAssessment_organizationId_obligationId_createdAt_idx" ON "AssuranceAssessment"("organizationId", "obligationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceAssessment_organizationId_inputHash_method_key" ON "AssuranceAssessment"("organizationId", "inputHash", "method");

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment'
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
