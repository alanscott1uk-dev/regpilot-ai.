-- Connected internal risk records. Apply only as part of a reviewed release.
BEGIN;
-- CreateTable
CREATE TABLE "RiskRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createKey" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "likelihood" INTEGER NOT NULL,
    "impact" INTEGER NOT NULL,
    "ratingRationale" VARCHAR(1200) NOT NULL,
    "strategy" VARCHAR(20) NOT NULL,
    "reviewDueAt" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskControl" (
    "organizationId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "RiskControl_pkey" PRIMARY KEY ("riskId","controlId")
);

-- CreateTable
CREATE TABLE "RiskTreatment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "purpose" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskTreatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskReview" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "riskId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "reviewerId" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "residualLikelihood" INTEGER NOT NULL,
    "residualImpact" INTEGER NOT NULL,
    "rationale" VARCHAR(1600) NOT NULL,
    "validUntil" DATE NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "proposalHash" VARCHAR(64) NOT NULL,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "decisionHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskRecord_organizationId_status_reviewDueAt_idx" ON "RiskRecord"("organizationId", "status", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRecord_id_organizationId_key" ON "RiskRecord"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskRecord_organizationId_createKey_key" ON "RiskRecord"("organizationId", "createKey");

-- CreateIndex
CREATE INDEX "RiskControl_organizationId_controlId_idx" ON "RiskControl"("organizationId", "controlId");

-- CreateIndex
CREATE INDEX "RiskTreatment_organizationId_obligationId_idx" ON "RiskTreatment"("organizationId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskTreatment_riskId_requestKey_key" ON "RiskTreatment"("riskId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "RiskTreatment_riskId_obligationId_key" ON "RiskTreatment"("riskId", "obligationId");

-- CreateIndex
CREATE INDEX "RiskReview_organizationId_riskId_createdAt_idx" ON "RiskReview"("organizationId", "riskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskReview_riskId_requestKey_key" ON "RiskReview"("riskId", "requestKey");

-- AddForeignKey
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_riskId_organizationId_fkey" FOREIGN KEY ("riskId", "organizationId") REFERENCES "RiskRecord"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTreatment" ADD CONSTRAINT "RiskTreatment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTreatment" ADD CONSTRAINT "RiskTreatment_riskId_organizationId_fkey" FOREIGN KEY ("riskId", "organizationId") REFERENCES "RiskRecord"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskTreatment" ADD CONSTRAINT "RiskTreatment_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_riskId_organizationId_fkey" FOREIGN KEY ("riskId", "organizationId") REFERENCES "RiskRecord"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Keep domain bounds in the database as well as in validated requests.
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_rating_check" CHECK ("likelihood" BETWEEN 1 AND 5 AND "impact" BETWEEN 1 AND 5);
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_status_check" CHECK ("status" IN ('OPEN','UNDER_REVIEW','ACCEPTED','ARCHIVED'));
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_strategy_check" CHECK ("strategy" IN ('MITIGATE','ACCEPT','TRANSFER','AVOID'));
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_category_check" CHECK ("category" IN ('OPERATIONAL','SECURITY','PRIVACY','SUPPLIER','QUALITY','OTHER'));
ALTER TABLE "RiskRecord" ADD CONSTRAINT "RiskRecord_version_check" CHECK ("version" > 0);
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_rating_check" CHECK ("residualLikelihood" BETWEEN 1 AND 5 AND "residualImpact" BETWEEN 1 AND 5);
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','RETURNED','SUPERSEDED'));
ALTER TABLE "RiskReview" ADD CONSTRAINT "RiskReview_version_check" CHECK ("version" > 0);

-- New private tables are closed to Data API roles in the same transaction.
DO $private$
DECLARE
 name text;
 role_name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['RiskRecord','RiskControl','RiskTreatment','RiskReview'] LOOP
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
