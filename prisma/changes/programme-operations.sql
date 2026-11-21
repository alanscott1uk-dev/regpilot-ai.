-- Additive development migration from fff3015. Review against a backup before hosted application.
BEGIN;
-- AlterTable
ALTER TABLE "Obligation" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "automationKey" VARCHAR(64),
ADD COLUMN     "connectorId" UUID,
ADD COLUMN     "controlId" UUID;

-- CreateTable
CREATE TABLE "ProgrammeImport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "inputHash" VARCHAR(64) NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProgrammeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedControl" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "proposalKey" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1600) NOT NULL,
    "testProcedure" VARCHAR(1600) NOT NULL,
    "theme" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "scheduledById" UUID NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextReviewAt" DATE NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "mappedById" UUID NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceConnector" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "configuredById" UUID NOT NULL,
    "provider" VARCHAR(24) NOT NULL DEFAULT 'GITHUB',
    "repository" VARCHAR(220) NOT NULL,
    "branch" VARCHAR(120) NOT NULL,
    "encryptedSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "leaseToken" UUID NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "signalHash" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgrammeImport_organizationId_createdAt_idx" ON "ProgrammeImport"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeImport_id_organizationId_key" ON "ProgrammeImport"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeImport_organizationId_inputHash_method_key" ON "ProgrammeImport"("organizationId", "inputHash", "method");

-- CreateIndex
CREATE INDEX "ManagedControl_organizationId_enabled_nextReviewAt_idx" ON "ManagedControl"("organizationId", "enabled", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedControl_id_organizationId_key" ON "ManagedControl"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedControl_importId_proposalKey_key" ON "ManagedControl"("importId", "proposalKey");

-- CreateIndex
CREATE INDEX "ControlLink_organizationId_obligationId_idx" ON "ControlLink"("organizationId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlLink_controlId_obligationId_key" ON "ControlLink"("controlId", "obligationId");

-- CreateIndex
CREATE INDEX "EvidenceConnector_enabled_nextRunAt_idx" ON "EvidenceConnector"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConnector_id_organizationId_key" ON "EvidenceConnector"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConnector_organizationId_repository_branch_key" ON "EvidenceConnector"("organizationId", "repository", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorRun_leaseToken_key" ON "ConnectorRun"("leaseToken");

-- CreateIndex
CREATE INDEX "ConnectorRun_organizationId_connectorId_capturedAt_idx" ON "ConnectorRun"("organizationId", "connectorId", "capturedAt");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_controlId_status_idx" ON "Obligation"("organizationId", "controlId", "status");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_connectorId_status_idx" ON "Obligation"("organizationId", "connectorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_organizationId_automationKey_key" ON "Obligation"("organizationId", "automationKey");

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "ProgrammeImport"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorRun" ADD CONSTRAINT "ConnectorRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorRun" ADD CONSTRAINT "ConnectorRun_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun'
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
