BEGIN;
-- CreateTable
CREATE TABLE "RiskLossScenario" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "riskVersion" INTEGER NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "authorId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "assumptions" VARCHAR(1600) NOT NULL,
    "inputs" JSONB NOT NULL,
    "method" VARCHAR(40) NOT NULL,
    "results" JSONB NOT NULL,
    "evidenceId" UUID,
    "evidenceBasis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskLossScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskLossScenario_organizationId_riskId_createdAt_idx" ON "RiskLossScenario"("organizationId", "riskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskLossScenario_riskId_requestKey_key" ON "RiskLossScenario"("riskId", "requestKey");

-- AddForeignKey
ALTER TABLE "RiskLossScenario" ADD CONSTRAINT "RiskLossScenario_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLossScenario" ADD CONSTRAINT "RiskLossScenario_riskId_organizationId_fkey" FOREIGN KEY ("riskId", "organizationId") REFERENCES "RiskRecord"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLossScenario" ADD CONSTRAINT "RiskLossScenario_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskLossScenario" ADD CONSTRAINT "RiskLossScenario_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId", "organizationId") REFERENCES "Evidence"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


DO $private$
DECLARE tab text; api_role text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['RiskLossScenario'] LOOP
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
