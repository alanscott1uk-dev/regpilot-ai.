-- Additive request workflow; no hosted migration performed.
BEGIN;
-- CreateTable
CREATE TABLE "AuditRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "controlSnapshot" JSONB NOT NULL,
    "controlHash" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instructions" VARCHAR(1600) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "submission" JSONB,
    "submissionHash" VARCHAR(64),
    "submittedById" UUID,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AuditRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditRequest_taskId_key" ON "AuditRequest"("taskId");

-- CreateIndex
CREATE INDEX "AuditRequest_organizationId_roomId_status_idx" ON "AuditRequest"("organizationId", "roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRequest_taskId_organizationId_key" ON "AuditRequest"("taskId", "organizationId");

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion','Policy','PolicyRevision','PolicyAssignment','Vendor','VendorReview','AuditRequest'
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
