BEGIN;
-- CreateTable
CREATE TABLE "MyCsfConnection" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "configuredById" UUID NOT NULL,
    "subscriberId" INTEGER NOT NULL,
    "assessmentId" INTEGER NOT NULL,
    "tier" VARCHAR(2) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scopeHash" VARCHAR(64) NOT NULL,
    "requirements" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "nextSyncAt" TIMESTAMP(3) NOT NULL,
    "failure" VARCHAR(60),
    "leaseId" UUID,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "MyCsfConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyCsfMapping" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "buid" VARCHAR(100) NOT NULL,
    "requirementHash" VARCHAR(64) NOT NULL,
    "evidenceId" UUID NOT NULL,
    "evidenceVersion" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "levels" TEXT[],
    "reason" VARCHAR(1000) NOT NULL,
    "mappedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "exportedAt" TIMESTAMP(3),
    "remoteDocumentId" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MyCsfMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MyCsfConnection_nextSyncAt_idx" ON "MyCsfConnection"("nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "MyCsfConnection_id_organizationId_key" ON "MyCsfConnection"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MyCsfConnection_organizationId_subscriberId_assessmentId_key" ON "MyCsfConnection"("organizationId", "subscriberId", "assessmentId");

-- CreateIndex
CREATE INDEX "MyCsfMapping_organizationId_connectionId_idx" ON "MyCsfMapping"("organizationId", "connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "MyCsfMapping_connectionId_buid_evidenceId_key" ON "MyCsfMapping"("connectionId", "buid", "evidenceId");

-- AddForeignKey
ALTER TABLE "MyCsfConnection" ADD CONSTRAINT "MyCsfConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyCsfConnection" ADD CONSTRAINT "MyCsfConnection_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyCsfMapping" ADD CONSTRAINT "MyCsfMapping_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "MyCsfConnection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyCsfMapping" ADD CONSTRAINT "MyCsfMapping_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId", "organizationId") REFERENCES "Evidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "MyCsfConnection" ADD CONSTRAINT "MyCsfConnection_valid_scope" CHECK (tier IN ('e1','i1','r2') AND "subscriberId">0 AND "assessmentId">0 AND jsonb_typeof(requirements)='array' AND "scopeHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "MyCsfMapping" ADD CONSTRAINT "MyCsfMapping_review" CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "requirementHash" ~ '^[0-9a-f]{64}$' AND cardinality(levels)>0 AND ("approvedBy" IS NULL OR "approvedBy"<>"mappedBy") AND ("exportedAt" IS NULL OR ("approvedBy" IS NOT NULL AND "remoteDocumentId" IS NOT NULL)));
ALTER TABLE "MyCsfConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MyCsfMapping" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "MyCsfConnection", "MyCsfMapping" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "MyCsfConnection", "MyCsfMapping" FROM authenticated; END IF;
END $$;
COMMIT;
