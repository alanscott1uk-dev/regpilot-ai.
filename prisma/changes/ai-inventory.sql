BEGIN;
-- CreateTable
CREATE TABLE "AiSystem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "ownerId" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "profile" JSONB,
    "controlId" UUID,
    "vendorId" UUID,
    "originKey" VARCHAR(76) NOT NULL,
    "bomSerial" VARCHAR(45),
    "bomDocumentHash" VARCHAR(64),
    "bomReference" VARCHAR(240),
    "bomVersion" INTEGER,
    "componentVersion" VARCHAR(120),
    "componentHash" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSystemDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "systemId" UUID NOT NULL,
    "systemVersion" INTEGER NOT NULL,
    "verdict" VARCHAR(12) NOT NULL,
    "rationale" VARCHAR(1600) NOT NULL,
    "validUntil" DATE NOT NULL,
    "reviewerId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSystemDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSystem_id_organizationId_key" ON "AiSystem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSystem_organizationId_originKey_key" ON "AiSystem"("organizationId", "originKey");

-- CreateIndex
CREATE INDEX "AiSystemDecision_organizationId_systemId_createdAt_idx" ON "AiSystemDecision"("organizationId", "systemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiSystemDecision_systemId_systemVersion_key" ON "AiSystemDecision"("systemId", "systemVersion");

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystem" ADD CONSTRAINT "AiSystem_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemDecision" ADD CONSTRAINT "AiSystemDecision_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId", "organizationId") REFERENCES "Evidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemDecision" ADD CONSTRAINT "AiSystemDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemDecision" ADD CONSTRAINT "AiSystemDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSystemDecision" ADD CONSTRAINT "AiSystemDecision_systemId_organizationId_fkey" FOREIGN KEY ("systemId", "organizationId") REFERENCES "AiSystem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $private$
DECLARE tab text; api_role text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['AiSystem','AiSystemDecision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC',tab);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I',tab,api_role);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO regpilot_staging_runtime',tab);
      EXECUTE format('CREATE POLICY regpilot_staging_runtime_private ON %I FOR ALL TO regpilot_staging_runtime USING (current_user=''regpilot_staging_runtime'') WITH CHECK (current_user=''regpilot_staging_runtime'')',tab);
    END IF;
  END LOOP;
END
$private$;
COMMIT;
