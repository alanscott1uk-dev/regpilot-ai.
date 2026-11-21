-- Additive migration; reviewed administrator execution only. No live application in this batch.
BEGIN;

CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "summary" VARCHAR(1200) NOT NULL,
    "file" JSONB NOT NULL,
    "fileHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedHash" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vendor" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "service" VARCHAR(1200) NOT NULL,
    "ownerId" UUID NOT NULL,
    "criticality" VARCHAR(12) NOT NULL,
    "dataAccess" VARCHAR(12) NOT NULL,
    "systemAccess" BOOLEAN NOT NULL DEFAULT false,
    "nextReviewAt" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorReview" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "vendorVersion" INTEGER NOT NULL,
    "baselineReviewId" UUID,
    "vendorSnapshot" JSONB NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "assessment" JSONB NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "recommendation" VARCHAR(16) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "followUpDue" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(2000) NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "followUpTasks" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Policy_id_organizationId_key" ON "Policy" ("id", "organizationId");

CREATE INDEX "Policy_organizationId_createdAt_idx" ON "Policy" ("organizationId", "createdAt");

CREATE UNIQUE INDEX "PolicyRevision_id_organizationId_key" ON "PolicyRevision" ("id", "organizationId");

CREATE UNIQUE INDEX "PolicyRevision_policyId_number_key" ON "PolicyRevision" ("policyId", "number");

CREATE UNIQUE INDEX "PolicyAssignment_revisionId_userId_key" ON "PolicyAssignment" ("revisionId", "userId");

CREATE INDEX "PolicyAssignment_organizationId_userId_status_dueDate_idx" ON "PolicyAssignment" ("organizationId", "userId", "status", "dueDate");

CREATE UNIQUE INDEX "Vendor_id_organizationId_key" ON "Vendor" ("id", "organizationId");

CREATE INDEX "Vendor_organizationId_active_nextReviewAt_idx" ON "Vendor" ("organizationId", "active", "nextReviewAt");

CREATE UNIQUE INDEX "VendorReview_id_organizationId_key" ON "VendorReview" ("id", "organizationId");

CREATE INDEX "VendorReview_organizationId_vendorId_createdAt_idx" ON "VendorReview" ("organizationId", "vendorId", "createdAt");

ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_policyId_organizationId_fkey" FOREIGN KEY ("policyId", "organizationId") REFERENCES "Policy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion','Policy','PolicyRevision','PolicyAssignment','Vendor','VendorReview'
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
