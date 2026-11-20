-- Persistent evidence-grounded questionnaire preparation. Apply with its reviewed application release.
BEGIN;
-- CreateTable
CREATE TABLE "QuestionnaireDraftRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "questionnaireId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "method" VARCHAR(24) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "evidenceManifest" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "answerId" UUID,
    "saveHash" VARCHAR(64),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionnaireDraftRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionnaireDraftRun_organizationId_questionnaireId_create_idx" ON "QuestionnaireDraftRun"("organizationId", "questionnaireId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireDraftRun_organizationId_requestKey_key" ON "QuestionnaireDraftRun"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionnaireDraftRun_organizationId_inputHash_method_key" ON "QuestionnaireDraftRun"("organizationId", "inputHash", "method");

-- AddForeignKey
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_questionnaireId_organizationId_fkey" FOREIGN KEY ("questionnaireId", "organizationId") REFERENCES "AssuranceQuestionnaire"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_answerId_organizationId_fkey" FOREIGN KEY ("answerId", "organizationId") REFERENCES "AssuranceAnswer"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_method_check" CHECK ("method" IN ('CONTENT_SEARCH','AI'));
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_status_check" CHECK ("status" IN ('PROCESSING','DRAFT','SAVED','FAILED'));
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_version_check" CHECK ("version">0);
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_result_check" CHECK (("status" IN ('DRAFT','SAVED') AND "result" IS NOT NULL AND "resultHash" IS NOT NULL) OR "status" IN ('PROCESSING','FAILED'));
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_save_check" CHECK (("status"='SAVED' AND "answerId" IS NOT NULL AND "saveHash" IS NOT NULL) OR ("status"<>'SAVED' AND "answerId" IS NULL AND "saveHash" IS NULL));
ALTER TABLE "QuestionnaireDraftRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "QuestionnaireDraftRun" FROM PUBLIC;
DO $private$
DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."QuestionnaireDraftRun" FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."QuestionnaireDraftRun" TO regpilot_staging_runtime;
  CREATE POLICY regpilot_staging_runtime_private ON public."QuestionnaireDraftRun" FOR ALL TO regpilot_staging_runtime USING (true) WITH CHECK (true);
 END IF;
END
$private$;
COMMIT;
