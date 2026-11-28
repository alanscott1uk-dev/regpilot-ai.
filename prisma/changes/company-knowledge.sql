-- Private persistent company knowledge. Apply with the corresponding reviewed application release.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS "Evidence_id_organizationId_key" ON "Evidence"("id","organizationId");
CREATE TABLE "KnowledgeIndexRun" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL,
 "evidenceId" UUID NOT NULL,
 "createdById" UUID NOT NULL,
 "requestKey" UUID NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "inputHash" VARCHAR(64) NOT NULL,
 "engineVersion" VARCHAR(80) NOT NULL,
 "method" VARCHAR(16) NOT NULL,
 "model" VARCHAR(160),
 "status" VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
 "context" JSONB NOT NULL,
 "usage" JSONB,
 "chunkCount" INTEGER NOT NULL DEFAULT 0,
 "chunksHash" VARCHAR(64),
 "dimensions" INTEGER,
 "failureCode" VARCHAR(80),
 "retryOfId" UUID,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "KnowledgeIndexRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeIndexRun_evidenceId_organizationId_fkey" FOREIGN KEY ("evidenceId","organizationId") REFERENCES "Evidence"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeIndexRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeIndexRun_method_check" CHECK ("method" IN ('CONTENT','SEMANTIC')),
 CONSTRAINT "KnowledgeIndexRun_status_check" CHECK ("status" IN ('PROCESSING','READY','FAILED','RETIRED')),
 CONSTRAINT "KnowledgeIndexRun_chunks_check" CHECK ("chunkCount" BETWEEN 0 AND 40 AND ("dimensions" IS NULL OR "dimensions" BETWEEN 1 AND 1536)),
 CONSTRAINT "KnowledgeIndexRun_ready_check" CHECK ("status" <> 'READY' OR ("chunkCount">0 AND "chunksHash" IS NOT NULL AND (("method"='CONTENT' AND "model" IS NULL AND "dimensions" IS NULL) OR ("method"='SEMANTIC' AND "model" IS NOT NULL AND "dimensions" IS NOT NULL))))
);
CREATE UNIQUE INDEX "KnowledgeIndexRun_id_organizationId_key" ON "KnowledgeIndexRun"("id","organizationId");
CREATE UNIQUE INDEX "KnowledgeIndexRun_organizationId_requestKey_key" ON "KnowledgeIndexRun"("organizationId","requestKey");
CREATE INDEX "KnowledgeIndexRun_organizationId_evidenceId_createdAt_idx" ON "KnowledgeIndexRun"("organizationId","evidenceId","createdAt");
CREATE INDEX "KnowledgeIndexRun_organizationId_inputHash_status_idx" ON "KnowledgeIndexRun"("organizationId","inputHash","status");
CREATE TABLE "KnowledgeChunk" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL,
 "indexRunId" UUID NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "unit" INTEGER NOT NULL,
 "unitKind" VARCHAR(8) NOT NULL,
 "start" INTEGER NOT NULL,
 "end" INTEGER NOT NULL,
 "text" TEXT NOT NULL,
 "textHash" VARCHAR(64) NOT NULL,
 "vector" JSONB,
 CONSTRAINT "KnowledgeChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeChunk_indexRunId_organizationId_fkey" FOREIGN KEY ("indexRunId","organizationId") REFERENCES "KnowledgeIndexRun"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeChunk_location_check" CHECK ("ordinal" BETWEEN 0 AND 39 AND "unit">0 AND "unitKind" IN ('page','block') AND "start">=0 AND "end">"start" AND char_length("text") BETWEEN 1 AND 1200),
 CONSTRAINT "KnowledgeChunk_vector_check" CHECK ("vector" IS NULL OR (jsonb_typeof("vector")='array' AND jsonb_array_length("vector") BETWEEN 1 AND 1536))
);
CREATE UNIQUE INDEX "KnowledgeChunk_organizationId_indexRunId_ordinal_key" ON "KnowledgeChunk"("organizationId","indexRunId","ordinal");
CREATE TABLE "KnowledgeSearchRun" (
 "id" UUID NOT NULL PRIMARY KEY,
 "organizationId" UUID NOT NULL,
 "createdById" UUID NOT NULL,
 "requestKey" UUID NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "inputHash" VARCHAR(64) NOT NULL,
 "queryHash" VARCHAR(64) NOT NULL,
 "method" VARCHAR(16) NOT NULL,
 "model" VARCHAR(160),
 "status" VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
 "context" JSONB NOT NULL,
 "usage" JSONB,
 "vector" JSONB,
 "vectorHash" VARCHAR(64),
 "result" JSONB,
 "resultHash" VARCHAR(64),
 "failureCode" VARCHAR(80),
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "KnowledgeSearchRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeSearchRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "KnowledgeSearchRun_method_check" CHECK ("method" IN ('CONTENT','SEMANTIC')),
 CONSTRAINT "KnowledgeSearchRun_status_check" CHECK ("status" IN ('PROCESSING','READY','FAILED')),
 CONSTRAINT "KnowledgeSearchRun_ready_check" CHECK ("status" <> 'READY' OR ("result" IS NOT NULL AND "resultHash" IS NOT NULL AND jsonb_typeof("result")='array' AND jsonb_array_length("result")<=10 AND (("method"='CONTENT' AND "model" IS NULL AND "vector" IS NULL AND "vectorHash" IS NULL) OR ("method"='SEMANTIC' AND "model" IS NOT NULL AND "vector" IS NOT NULL AND "vectorHash" IS NOT NULL)))),
 CONSTRAINT "KnowledgeSearchRun_vector_check" CHECK ("vector" IS NULL OR (jsonb_typeof("vector")='array' AND jsonb_array_length("vector") BETWEEN 1 AND 1536))
);
CREATE UNIQUE INDEX "KnowledgeSearchRun_organizationId_requestKey_key" ON "KnowledgeSearchRun"("organizationId","requestKey");
CREATE INDEX "KnowledgeSearchRun_organizationId_inputHash_status_idx" ON "KnowledgeSearchRun"("organizationId","inputHash","status");
CREATE INDEX "KnowledgeSearchRun_organizationId_queryHash_model_status_idx" ON "KnowledgeSearchRun"("organizationId","queryHash","model","status");
CREATE INDEX "KnowledgeSearchRun_organizationId_createdAt_idx" ON "KnowledgeSearchRun"("organizationId","createdAt");
ALTER TABLE "KnowledgeIndexRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeSearchRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "KnowledgeIndexRun","KnowledgeChunk","KnowledgeSearchRun" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['KnowledgeIndexRun','KnowledgeChunk','KnowledgeSearchRun'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',table_name,role_name);
   END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO regpilot_staging_runtime',table_name);
   -- Only the dedicated server runtime can access these tables; HTTP identity/tenant checks remain mandatory.
   EXECUTE format('CREATE POLICY regpilot_staging_runtime_private ON public.%I FOR ALL TO regpilot_staging_runtime USING (current_user = ''regpilot_staging_runtime'') WITH CHECK (current_user = ''regpilot_staging_runtime'')',table_name);
  END IF;
 END LOOP;
END
$private$;
COMMIT;
