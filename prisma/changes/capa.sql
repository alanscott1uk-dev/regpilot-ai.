-- Dedicated internal deviations, CAPA actions and independently reviewed effectiveness.
-- This change does not assert GMP validation or certification.
BEGIN;
CREATE TABLE "QualityCase" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "createKey" UUID NOT NULL,
 "createdById" UUID NOT NULL, "ownerId" UUID NOT NULL,
 "title" VARCHAR(160) NOT NULL, "kind" VARCHAR(20) NOT NULL, "classification" VARCHAR(20) NOT NULL,
 "description" VARCHAR(2000) NOT NULL, "impact" VARCHAR(1600) NOT NULL, "containment" VARCHAR(1600) NOT NULL,
 "occurredAt" DATE NOT NULL, "investigationNotes" VARCHAR(3000) NOT NULL DEFAULT '',
 "rootCause" VARCHAR(2000) NOT NULL DEFAULT '', "effectivenessCriteria" VARCHAR(2000) NOT NULL DEFAULT '',
 "effectivenessDueAt" DATE, "status" VARCHAR(32) NOT NULL DEFAULT 'INVESTIGATING',
 "version" INTEGER NOT NULL DEFAULT 1, "cycle" INTEGER NOT NULL DEFAULT 1,
 "recurrenceCount" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "QualityCase_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "QualityCase_kind_check" CHECK ("kind" IN ('DEVIATION','CAPA')),
 CONSTRAINT "QualityCase_classification_check" CHECK ("classification" IN ('MINOR','MAJOR','CRITICAL')),
 CONSTRAINT "QualityCase_status_check" CHECK ("status" IN ('INVESTIGATING','ACTIONS_OPEN','EFFECTIVENESS_DUE','CLOSED','REOPENED')),
 CONSTRAINT "QualityCase_version_check" CHECK ("version">0 AND "cycle">0 AND "recurrenceCount">=0)
);
CREATE TABLE "QualityAction" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "caseId" UUID NOT NULL, "cycle" INTEGER NOT NULL,
 "obligationId" UUID NOT NULL, "requestKey" UUID NOT NULL, "kind" VARCHAR(20) NOT NULL,
 "purpose" VARCHAR(1200) NOT NULL, "createdById" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "QualityAction_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "QualityAction_kind_check" CHECK ("kind" IN ('CONTAINMENT','CORRECTIVE','PREVENTIVE')),
 CONSTRAINT "QualityAction_cycle_check" CHECK ("cycle">0)
);
CREATE TABLE "QualityEffectiveness" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "caseId" UUID NOT NULL, "cycle" INTEGER NOT NULL,
 "requestKey" UUID NOT NULL, "authorId" UUID NOT NULL, "reviewerId" UUID,
 "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING', "version" INTEGER NOT NULL DEFAULT 1,
 "observedAt" DATE NOT NULL, "notes" VARCHAR(2000) NOT NULL, "evidenceManifest" JSONB NOT NULL,
 "context" JSONB NOT NULL, "contextHash" VARCHAR(64) NOT NULL, "proposalHash" VARCHAR(64) NOT NULL,
 "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '', "reviewedAt" TIMESTAMP(3), "decisionHash" VARCHAR(64),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "QualityEffectiveness_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "QualityEffectiveness_status_check" CHECK ("status" IN ('PENDING','PASSED','FAILED','SUPERSEDED')),
 CONSTRAINT "QualityEffectiveness_version_check" CHECK ("version">0 AND "cycle">0),
 CONSTRAINT "QualityEffectiveness_independent_check" CHECK ("reviewerId" IS NULL OR "reviewerId"<>"authorId")
);
CREATE TABLE "QualityOperation" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "actorId" UUID NOT NULL, "requestKey" UUID NOT NULL,
 "action" VARCHAR(32) NOT NULL, "caseId" UUID NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
 "result" JSONB NOT NULL, "resultHash" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "QualityOperation_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "QualityOperation_action_check" CHECK ("action" IN ('CREATE','INVESTIGATE','ADD_ACTION','PREPARE_EFFECTIVENESS','DECIDE_EFFECTIVENESS','REOPEN'))
);
CREATE UNIQUE INDEX "QualityCase_id_organizationId_key" ON "QualityCase"("id","organizationId");
CREATE UNIQUE INDEX "QualityCase_organizationId_createKey_key" ON "QualityCase"("organizationId","createKey");
CREATE INDEX "QualityCase_organizationId_status_effectivenessDueAt_idx" ON "QualityCase"("organizationId","status","effectivenessDueAt");
CREATE UNIQUE INDEX "QualityAction_caseId_requestKey_key" ON "QualityAction"("caseId","requestKey");
CREATE UNIQUE INDEX "QualityAction_caseId_cycle_obligationId_key" ON "QualityAction"("caseId","cycle","obligationId");
CREATE INDEX "QualityAction_organizationId_obligationId_idx" ON "QualityAction"("organizationId","obligationId");
CREATE UNIQUE INDEX "QualityEffectiveness_caseId_requestKey_key" ON "QualityEffectiveness"("caseId","requestKey");
CREATE INDEX "QualityEffectiveness_organizationId_caseId_createdAt_idx" ON "QualityEffectiveness"("organizationId","caseId","createdAt");
CREATE UNIQUE INDEX "QualityOperation_organizationId_requestKey_key" ON "QualityOperation"("organizationId","requestKey");
CREATE INDEX "QualityOperation_organizationId_caseId_createdAt_idx" ON "QualityOperation"("organizationId","caseId","createdAt");
ALTER TABLE "QualityCase" ADD CONSTRAINT "QualityCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityCase" ADD CONSTRAINT "QualityCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityCase" ADD CONSTRAINT "QualityCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_caseId_organizationId_fkey" FOREIGN KEY ("caseId","organizationId") REFERENCES "QualityCase"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId","organizationId") REFERENCES "Obligation"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEffectiveness" ADD CONSTRAINT "QualityEffectiveness_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEffectiveness" ADD CONSTRAINT "QualityEffectiveness_caseId_organizationId_fkey" FOREIGN KEY ("caseId","organizationId") REFERENCES "QualityCase"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QualityEffectiveness" ADD CONSTRAINT "QualityEffectiveness_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityEffectiveness" ADD CONSTRAINT "QualityEffectiveness_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityOperation" ADD CONSTRAINT "QualityOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityOperation" ADD CONSTRAINT "QualityOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualityOperation" ADD CONSTRAINT "QualityOperation_caseId_organizationId_fkey" FOREIGN KEY ("caseId","organizationId") REFERENCES "QualityCase"("id","organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

DO $private$
DECLARE name text; role_name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['QualityCase','QualityAction','QualityEffectiveness','QualityOperation'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END
$private$;
COMMIT;
