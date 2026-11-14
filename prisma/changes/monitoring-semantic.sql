-- Additive migration from db6e5e0, after obligation-intelligence.sql. Not applied to live databases.
BEGIN;
-- CreateTable
CREATE TABLE "WatchSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "configuredById" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastOutcome" VARCHAR(40),
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "modelId" VARCHAR(160) NOT NULL,
    "createdById" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SemanticRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchSchedule_enabled_nextCheckAt_idx" ON "WatchSchedule"("enabled", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchSchedule_organizationId_sourceId_key" ON "WatchSchedule"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "SemanticRequest_organizationId_createdAt_idx" ON "SemanticRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticRequest_organizationId_snapshotId_profileVersion_en_key" ON "SemanticRequest"("organizationId", "snapshotId", "profileVersion", "engineVersion");

-- AddForeignKey
ALTER TABLE "WatchSchedule" ADD CONSTRAINT "WatchSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSchedule" ADD CONSTRAINT "WatchSchedule_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest'
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
