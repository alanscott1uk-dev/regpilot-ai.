-- Company product catalogue and deliberate evidence applicability. Existing answers stay unscoped.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS "Evidence_id_organizationId_key" ON "Evidence"("id","organizationId");
CREATE TABLE "CompanyProduct" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createKey" UUID NOT NULL,
 "code" VARCHAR(24) NOT NULL,
 "name" VARCHAR(100) NOT NULL,
 "description" VARCHAR(1200) NOT NULL DEFAULT '',
 "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CompanyProduct_status_check" CHECK ("status" IN ('ACTIVE','ARCHIVED')),
 CONSTRAINT "CompanyProduct_version_check" CHECK ("version">0),
 CONSTRAINT "CompanyProduct_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9-]{1,23}$')
);
CREATE UNIQUE INDEX "CompanyProduct_id_organizationId_key" ON "CompanyProduct"("id","organizationId");
CREATE UNIQUE INDEX "CompanyProduct_organizationId_code_key" ON "CompanyProduct"("organizationId","code");
CREATE UNIQUE INDEX "CompanyProduct_organizationId_createKey_key" ON "CompanyProduct"("organizationId","createKey");
CREATE INDEX "CompanyProduct_organizationId_status_name_idx" ON "CompanyProduct"("organizationId","status","name");
CREATE TABLE "EvidenceApplicability" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "evidenceId" UUID NOT NULL,
 "mode" VARCHAR(16) NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EvidenceApplicability_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId","organizationId") REFERENCES "Evidence"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EvidenceApplicability_mode_check" CHECK ("mode" IN ('GLOBAL','PRODUCT')),
 CONSTRAINT "EvidenceApplicability_version_check" CHECK ("version">0)
);
CREATE UNIQUE INDEX "EvidenceApplicability_evidenceId_organizationId_key" ON "EvidenceApplicability"("evidenceId","organizationId");
CREATE INDEX "EvidenceApplicability_organizationId_mode_idx" ON "EvidenceApplicability"("organizationId","mode");
CREATE TABLE "EvidenceProductLink" (
 "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "evidenceId" UUID NOT NULL,
 "productId" UUID NOT NULL,
 CONSTRAINT "EvidenceProductLink_pkey" PRIMARY KEY ("evidenceId","productId"),
 CONSTRAINT "EvidenceProductLink_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId","organizationId") REFERENCES "EvidenceApplicability"("evidenceId","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EvidenceProductLink_productId_organizationId_fkey" FOREIGN KEY ("productId","organizationId") REFERENCES "CompanyProduct"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EvidenceProductLink_organizationId_productId_evidenceId_idx" ON "EvidenceProductLink"("organizationId","productId","evidenceId");
ALTER TABLE "AssuranceAnswer" ADD COLUMN "productId" UUID, ADD COLUMN "productContext" JSONB;
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_productId_organizationId_fkey" FOREIGN KEY ("productId","organizationId") REFERENCES "CompanyProduct"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AssuranceAnswer_organizationId_productId_status_idx" ON "AssuranceAnswer"("organizationId","productId","status");
ALTER TABLE "AssuranceQuestionnaire" ADD COLUMN "productContext" JSONB;
ALTER TABLE "CompanyProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceApplicability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvidenceProductLink" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "CompanyProduct","EvidenceApplicability","EvidenceProductLink" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['CompanyProduct','EvidenceApplicability','EvidenceProductLink'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO regpilot_staging_runtime',table_name);
   EXECUTE format('CREATE POLICY regpilot_staging_runtime_private ON public.%I FOR ALL TO regpilot_staging_runtime USING (current_user = ''regpilot_staging_runtime'') WITH CHECK (current_user = ''regpilot_staging_runtime'')',table_name);
  END IF;
 END LOOP;
END
$private$;
COMMIT;
