-- Additive obligation library migration from e3abb39. Review and back up before live application.
BEGIN;
-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "facts" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "RegisteredSource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "path" VARCHAR(450) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "documentType" VARCHAR(120) NOT NULL,
    "registeredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisteredSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRequirement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "collection" VARCHAR(100) NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "provenance" JSONB NOT NULL,
    "provenanceHash" VARCHAR(64) NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryApplicability" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(30) NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "ownerId" UUID,
    "reviewerId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryApplicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    "context" JSONB NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "revisionId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredSource_organizationId_sourceId_key" ON "RegisteredSource"("organizationId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredSource_organizationId_path_key" ON "RegisteredSource"("organizationId", "path");

-- CreateIndex
CREATE INDEX "LibraryRequirement_organizationId_createdAt_id_idx" ON "LibraryRequirement"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRequirement_id_organizationId_key" ON "LibraryRequirement"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRequirement_organizationId_collection_reference_key" ON "LibraryRequirement"("organizationId", "collection", "reference");

-- CreateIndex
CREATE INDEX "LibraryRevision_organizationId_status_createdAt_idx" ON "LibraryRevision"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRevision_id_organizationId_key" ON "LibraryRevision"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRevision_requirementId_number_key" ON "LibraryRevision"("requirementId", "number");

-- CreateIndex
CREATE INDEX "LibraryApplicability_organizationId_profileVersion_idx" ON "LibraryApplicability"("organizationId", "profileVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryApplicability_revisionId_contextHash_key" ON "LibraryApplicability"("revisionId", "contextHash");

-- CreateIndex
CREATE INDEX "CoverageRun_organizationId_createdAt_idx" ON "CoverageRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRun_id_organizationId_key" ON "CoverageRun"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRun_organizationId_inputHash_method_key" ON "CoverageRun"("organizationId", "inputHash", "method");

-- CreateIndex
CREATE INDEX "CoverageDecision_organizationId_revisionId_controlId_create_idx" ON "CoverageDecision"("organizationId", "revisionId", "controlId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageDecision_runId_key_key" ON "CoverageDecision"("runId", "key");

-- AddForeignKey
ALTER TABLE "RegisteredSource" ADD CONSTRAINT "RegisteredSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredSource" ADD CONSTRAINT "RegisteredSource_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirement" ADD CONSTRAINT "LibraryRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_requirementId_organizationId_fkey" FOREIGN KEY ("requirementId", "organizationId") REFERENCES "LibraryRequirement"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "LibraryRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRun" ADD CONSTRAINT "CoverageRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRun" ADD CONSTRAINT "CoverageRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_runId_organizationId_fkey" FOREIGN KEY ("runId", "organizationId") REFERENCES "CoverageRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "LibraryRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default-deny all new private tables in the same transaction as creation.
DO $private$
DECLARE table_name text; role_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$private$;
COMMIT;
