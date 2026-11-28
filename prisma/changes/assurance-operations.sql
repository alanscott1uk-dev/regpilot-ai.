-- Additive change from schema-984141b.prisma. Disposable CI first; no hosted migration.
BEGIN;
-- AlterTable
ALTER TABLE "AuditRequest" ADD COLUMN     "samplingPlan" JSONB;

-- CreateTable
CREATE TABLE "AccessInventory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "system" VARCHAR(120) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "records" JSONB NOT NULL,
    "recordsHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCampaign" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "closedById" UUID,
    "title" VARCHAR(160) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "closure" JSONB,
    "closureHash" VARCHAR(64),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "taskId" UUID,
    "submittedById" UUID,
    "verifiedById" UUID,
    "entry" JSONB NOT NULL,
    "entryHash" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "stage" VARCHAR(16) NOT NULL DEFAULT 'DECIDE',
    "targetPermission" VARCHAR(160),
    "rationale" VARCHAR(1600) NOT NULL DEFAULT '',
    "proof" JSONB,
    "proofHash" VARCHAR(64),
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceAnswer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "question" VARCHAR(1200) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "answer" VARCHAR(6000) NOT NULL,
    "files" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceQuestionnaire" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "title" VARCHAR(160) NOT NULL,
    "recipient" VARCHAR(160) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "questions" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedSnapshot" JSONB,
    "approvedHash" VARCHAR(64),
    "approvedAt" TIMESTAMP(3),
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceQuestionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessInventory_organizationId_system_createdAt_idx" ON "AccessInventory"("organizationId", "system", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessInventory_id_organizationId_key" ON "AccessInventory"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AccessCampaign_organizationId_status_createdAt_idx" ON "AccessCampaign"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCampaign_id_organizationId_key" ON "AccessCampaign"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCampaign_organizationId_inventoryId_key" ON "AccessCampaign"("organizationId", "inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_taskId_key" ON "AccessReviewItem"("taskId");

-- CreateIndex
CREATE INDEX "AccessReviewItem_organizationId_reviewerId_stage_idx" ON "AccessReviewItem"("organizationId", "reviewerId", "stage");

-- CreateIndex
CREATE INDEX "AccessReviewItem_campaignId_stage_idx" ON "AccessReviewItem"("campaignId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_id_organizationId_key" ON "AccessReviewItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_taskId_organizationId_key" ON "AccessReviewItem"("taskId", "organizationId");

-- CreateIndex
CREATE INDEX "AssuranceAnswer_organizationId_status_scope_idx" ON "AssuranceAnswer"("organizationId", "status", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceAnswer_id_organizationId_key" ON "AssuranceAnswer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AssuranceQuestionnaire_organizationId_status_createdAt_idx" ON "AssuranceQuestionnaire"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceQuestionnaire_id_organizationId_key" ON "AssuranceQuestionnaire"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "AccessInventory" ADD CONSTRAINT "AccessInventory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessInventory" ADD CONSTRAINT "AccessInventory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_inventoryId_organizationId_fkey" FOREIGN KEY ("inventoryId", "organizationId") REFERENCES "AccessInventory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "AccessCampaign"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion','Policy','PolicyRevision','PolicyAssignment','Vendor','VendorReview','AuditRequest','ChangeResponse','ChangeAction','AccessInventory','AccessCampaign','AccessReviewItem','AssuranceAnswer','AssuranceQuestionnaire'
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
