-- Additive migration after paid-services.sql. No hosted database was changed.
BEGIN;
-- CreateTable
CREATE TABLE "AuditRoom" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "purpose" VARCHAR(1200) NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditGrant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "userId" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditQuestion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "evidenceId" UUID,
    "question" VARCHAR(2000) NOT NULL,
    "response" VARCHAR(4000) NOT NULL DEFAULT '',
    "responses" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "answeredById" UUID,
    "answeredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditRoom_organizationId_createdAt_idx" ON "AuditRoom"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRoom_id_organizationId_key" ON "AuditRoom"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AuditGrant_email_status_expiresAt_idx" ON "AuditGrant"("email", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditGrant_roomId_email_key" ON "AuditGrant"("roomId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "AuditGrant_id_roomId_organizationId_key" ON "AuditGrant"("id", "roomId", "organizationId");

-- CreateIndex
CREATE INDEX "AuditQuestion_organizationId_roomId_createdAt_idx" ON "AuditQuestion"("organizationId", "roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditRoom" ADD CONSTRAINT "AuditRoom_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoom" ADD CONSTRAINT "AuditRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_grantId_roomId_organizationId_fkey" FOREIGN KEY ("grantId", "roomId", "organizationId") REFERENCES "AuditGrant"("id", "roomId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion'
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
