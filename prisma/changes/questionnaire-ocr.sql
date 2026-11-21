-- Private, bounded OCR originals and immutable transcription review versions.
BEGIN;
CREATE TABLE "OcrRun" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestKey" UUID NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "filename" VARCHAR(180) NOT NULL,
 "format" VARCHAR(8) NOT NULL,
 "contentType" VARCHAR(100) NOT NULL,
 "storageKey" VARCHAR(240) NOT NULL,
 "sha256" VARCHAR(64) NOT NULL,
 "sizeBytes" INTEGER NOT NULL,
 "pageCount" INTEGER NOT NULL,
 "sourceMeta" JSONB NOT NULL,
 "scanEngine" VARCHAR(80) NOT NULL,
 "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
 "version" INTEGER NOT NULL DEFAULT 1,
 "operationUrl" TEXT,
 "rawResult" JSONB,
 "rawHash" VARCHAR(64),
 "currentReviewId" UUID,
 "leaseToken" UUID,
 "leaseUntil" TIMESTAMP(3),
 "pollAfter" TIMESTAMP(3),
 "pollCount" INTEGER NOT NULL DEFAULT 0,
 "failureCode" VARCHAR(80),
 "startedById" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "startedAt" TIMESTAMP(3),
 "completedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OcrRun_bounds_check" CHECK ("version">0 AND "sizeBytes">0 AND "sizeBytes"<=3145728 AND "pageCount">=1 AND "pageCount"<=40 AND "pollCount">=0 AND "pollCount"<=80),
 CONSTRAINT "OcrRun_format_check" CHECK ("format" IN ('PDF','PNG','JPEG')),
 CONSTRAINT "OcrRun_status_check" CHECK ("status" IN ('DRAFT','STARTING','POLLING','EXTRACTED','REVIEW_PENDING','REVIEWED','ATTENTION','WITHDRAWN')),
 CONSTRAINT "OcrRun_hash_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "OcrRun_storageKey_key" ON "OcrRun"("storageKey");
CREATE UNIQUE INDEX "OcrRun_currentReviewId_key" ON "OcrRun"("currentReviewId");
CREATE UNIQUE INDEX "OcrRun_currentReviewId_organizationId_key" ON "OcrRun"("currentReviewId","organizationId");
CREATE UNIQUE INDEX "OcrRun_id_organizationId_key" ON "OcrRun"("id","organizationId");
CREATE UNIQUE INDEX "OcrRun_organizationId_requestKey_key" ON "OcrRun"("organizationId","requestKey");
CREATE INDEX "OcrRun_organizationId_createdAt_idx" ON "OcrRun"("organizationId","createdAt");
CREATE TABLE "OcrReview" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "runId" UUID NOT NULL,
 "requestKey" UUID NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "preparedById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reviewedById" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "version" INTEGER NOT NULL DEFAULT 1,
 "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
 "sourceHash" VARCHAR(64) NOT NULL,
 "rawHash" VARCHAR(64) NOT NULL,
 "result" JSONB NOT NULL,
 "resultHash" VARCHAR(64) NOT NULL,
 "notes" VARCHAR(1600) NOT NULL DEFAULT '',
 "approvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OcrReview_runId_organizationId_fkey" FOREIGN KEY ("runId","organizationId") REFERENCES "OcrRun"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "OcrReview_status_check" CHECK ("status" IN ('DRAFT','APPROVED')),
 CONSTRAINT "OcrReview_version_check" CHECK ("version">0),
 CONSTRAINT "OcrReview_independent_check" CHECK ("status"<>'APPROVED' OR ("reviewedById" IS NOT NULL AND "reviewedById"<>"preparedById" AND "approvedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "OcrReview_id_organizationId_key" ON "OcrReview"("id","organizationId");
CREATE UNIQUE INDEX "OcrReview_organizationId_requestKey_key" ON "OcrReview"("organizationId","requestKey");
CREATE INDEX "OcrReview_organizationId_runId_createdAt_idx" ON "OcrReview"("organizationId","runId","createdAt");
ALTER TABLE "OcrRun" ADD CONSTRAINT "OcrRun_currentReviewId_organizationId_fkey" FOREIGN KEY ("currentReviewId","organizationId") REFERENCES "OcrReview"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OcrRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OcrReview" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "OcrRun","OcrReview" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['OcrRun','OcrReview'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',table_name,role_name); END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO regpilot_staging_runtime',table_name);
   EXECUTE format('CREATE POLICY regpilot_staging_runtime_private ON public.%I FOR ALL TO regpilot_staging_runtime USING (current_user = ''regpilot_staging_runtime'') WITH CHECK (current_user = ''regpilot_staging_runtime'')',table_name);
  END IF;
 END LOOP;
END
$private$;
COMMIT;
