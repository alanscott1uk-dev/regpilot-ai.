BEGIN;
-- CreateTable
CREATE TABLE "EvaluationCase" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewedById" UUID,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "state" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "specification" JSONB NOT NULL,
    "specificationHash" VARCHAR(64) NOT NULL,
    "referenceContext" JSONB NOT NULL,
    "referenceHash" VARCHAR(64) NOT NULL,
    "reviewNotes" VARCHAR(2000),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "searchRequestKey" UUID NOT NULL,
    "searchRunId" UUID,
    "retryOfId" UUID,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
    "method" VARCHAR(16) NOT NULL,
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "failureCode" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationAnswerReview" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "draftRunId" UUID NOT NULL,
    "reviewedById" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "method" VARCHAR(24) NOT NULL,
    "model" VARCHAR(200),
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "rubric" JSONB NOT NULL,
    "rubricHash" VARCHAR(64) NOT NULL,
    "rationale" VARCHAR(3000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationAnswerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "caseId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvaluationCase_organizationId_state_createdAt_idx" ON "EvaluationCase"("organizationId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCase_id_organizationId_key" ON "EvaluationCase"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCase_organizationId_requestKey_key" ON "EvaluationCase"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRun_searchRequestKey_key" ON "EvaluationRun"("searchRequestKey");

-- CreateIndex
CREATE INDEX "EvaluationRun_organizationId_caseId_createdAt_idx" ON "EvaluationRun"("organizationId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "EvaluationRun_organizationId_status_createdAt_idx" ON "EvaluationRun"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRun_id_organizationId_key" ON "EvaluationRun"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRun_organizationId_requestKey_key" ON "EvaluationRun"("organizationId", "requestKey");

-- CreateIndex
CREATE INDEX "EvaluationAnswerReview_organizationId_createdAt_idx" ON "EvaluationAnswerReview"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAnswerReview_id_organizationId_key" ON "EvaluationAnswerReview"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAnswerReview_organizationId_requestKey_key" ON "EvaluationAnswerReview"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationAnswerReview_organizationId_caseId_draftRunId_key" ON "EvaluationAnswerReview"("organizationId", "caseId", "draftRunId");

-- CreateIndex
CREATE INDEX "EvaluationOperation_organizationId_createdAt_idx" ON "EvaluationOperation"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationOperation_organizationId_requestKey_key" ON "EvaluationOperation"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSearchRun_id_organizationId_key" ON "KnowledgeSearchRun"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "EvaluationCase"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_searchRunId_organizationId_fkey" FOREIGN KEY ("searchRunId", "organizationId") REFERENCES "KnowledgeSearchRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_retryOfId_organizationId_fkey" FOREIGN KEY ("retryOfId", "organizationId") REFERENCES "EvaluationRun"("id", "organizationId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAnswerReview" ADD CONSTRAINT "EvaluationAnswerReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAnswerReview" ADD CONSTRAINT "EvaluationAnswerReview_caseId_organizationId_fkey" FOREIGN KEY ("caseId", "organizationId") REFERENCES "EvaluationCase"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAnswerReview" ADD CONSTRAINT "EvaluationAnswerReview_draftRunId_organizationId_fkey" FOREIGN KEY ("draftRunId", "organizationId") REFERENCES "QuestionnaireDraftRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationAnswerReview" ADD CONSTRAINT "EvaluationAnswerReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationOperation" ADD CONSTRAINT "EvaluationOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationOperation" ADD CONSTRAINT "EvaluationOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- The reference and human assessment are immutable records; replacement is explicit.
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_state_check" CHECK ("state" IN ('DRAFT','APPROVED','REJECTED','RETIRED') AND "version">0 AND ("state"<>'APPROVED' OR ("reviewedById" IS NOT NULL AND "reviewedById"<>"createdById" AND "reviewedAt" IS NOT NULL)));
ALTER TABLE "EvaluationRun" ADD CONSTRAINT "EvaluationRun_state_check" CHECK ("status" IN ('PROCESSING','COMPLETED','FAILED') AND "method" IN ('CONTENT','SEMANTIC') AND "attempt" BETWEEN 1 AND 2 AND ("status"<>'COMPLETED' OR ("result" IS NOT NULL AND "resultHash" IS NOT NULL AND "searchRunId" IS NOT NULL AND "finishedAt" IS NOT NULL)));
ALTER TABLE "EvaluationAnswerReview" ADD CONSTRAINT "EvaluationAnswerReview_method_check" CHECK ("method" IN ('CONTENT_SEARCH','AI'));
CREATE FUNCTION regpilot_evaluation_case_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW."organizationId",NEW."createdById",NEW."requestKey",NEW."requestHash",NEW."specification",NEW."specificationHash",NEW."referenceContext",NEW."referenceHash",NEW."createdAt") IS DISTINCT FROM (OLD."organizationId",OLD."createdById",OLD."requestKey",OLD."requestHash",OLD."specification",OLD."specificationHash",OLD."referenceContext",OLD."referenceHash",OLD."createdAt") THEN RAISE EXCEPTION 'Evaluation reference is immutable; create a replacement'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regpilot_evaluation_case_immutable BEFORE UPDATE ON "EvaluationCase" FOR EACH ROW EXECUTE FUNCTION regpilot_evaluation_case_immutable();
CREATE FUNCTION regpilot_evaluation_answer_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Independent answer assessments are immutable'; END $$;
CREATE TRIGGER regpilot_evaluation_answer_immutable BEFORE UPDATE ON "EvaluationAnswerReview" FOR EACH ROW EXECUTE FUNCTION regpilot_evaluation_answer_immutable();
CREATE FUNCTION regpilot_evaluation_run_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW."organizationId",NEW."caseId",NEW."createdById",NEW."requestKey",NEW."requestHash",NEW."searchRequestKey",NEW."retryOfId",NEW."attempt",NEW."method",NEW."context",NEW."contextHash",NEW."createdAt") IS DISTINCT FROM (OLD."organizationId",OLD."caseId",OLD."createdById",OLD."requestKey",OLD."requestHash",OLD."searchRequestKey",OLD."retryOfId",OLD."attempt",OLD."method",OLD."context",OLD."contextHash",OLD."createdAt") OR (OLD."status"<>'PROCESSING' AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'Recorded evaluation context and terminal results are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER regpilot_evaluation_run_immutable BEFORE UPDATE ON "EvaluationRun" FOR EACH ROW EXECUTE FUNCTION regpilot_evaluation_run_immutable();

ALTER TABLE "EvaluationCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationAnswerReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationOperation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "EvaluationCase","EvaluationRun","EvaluationAnswerReview","EvaluationOperation" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['EvaluationCase','EvaluationRun','EvaluationAnswerReview','EvaluationOperation'] LOOP
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
