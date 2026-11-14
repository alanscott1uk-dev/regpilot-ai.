-- Apply after audit-evidence-requests.sql through the reviewed release process.
BEGIN;
-- CreateTable
CREATE TABLE "ChangeResponse" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolution" JSONB,
    "resolutionHash" VARCHAR(64),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeAction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "requirements" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "submission" JSONB,
    "submissionHash" VARCHAR(64),
    "submittedById" UUID,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeResponse_organizationId_status_createdAt_idx" ON "ChangeResponse"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeResponse_id_organizationId_key" ON "ChangeResponse"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeResponse_organizationId_snapshotId_key" ON "ChangeResponse"("organizationId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_taskId_key" ON "ChangeAction"("taskId");

-- CreateIndex
CREATE INDEX "ChangeAction_organizationId_responseId_status_idx" ON "ChangeAction"("organizationId", "responseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_responseId_controlId_key" ON "ChangeAction"("responseId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_taskId_organizationId_key" ON "ChangeAction"("taskId", "organizationId");

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_responseId_organizationId_fkey" FOREIGN KEY ("responseId", "organizationId") REFERENCES "ChangeResponse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion','Policy','PolicyRevision','PolicyAssignment','Vendor','VendorReview','AuditRequest','ChangeResponse','ChangeAction'
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
