-- Additive paid-service integration tables. All providers remain disabled.
BEGIN;
-- CreateTable
CREATE TABLE "PaidBudget" (
    "organizationId" UUID NOT NULL,
    "monthlyLimitMicros" INTEGER NOT NULL,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "configuredById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaidBudget_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PaidReservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" VARCHAR(140) NOT NULL,
    "service" VARCHAR(24) NOT NULL,
    "units" INTEGER NOT NULL,
    "reservedMicros" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "targetId" UUID,
    "sourceHash" VARCHAR(64),
    "dedupeKey" VARCHAR(180) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "units" INTEGER NOT NULL DEFAULT 1,
    "recipientId" UUID,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "failureCode" VARCHAR(48),
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "providerId" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "organizationId" UUID NOT NULL,
    "customerId" VARCHAR(120) NOT NULL,
    "subscriptionId" VARCHAR(120),
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "lastEventAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" VARCHAR(120) NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaidReservation_month_organizationId_idx" ON "PaidReservation"("month", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidReservation_organizationId_requestKey_key" ON "PaidReservation"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_providerId_key" ON "ServiceJob"("providerId");

-- CreateIndex
CREATE INDEX "ServiceJob_status_createdAt_idx" ON "ServiceJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceJob_organizationId_createdAt_idx" ON "ServiceJob"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_organizationId_dedupeKey_key" ON "ServiceJob"("organizationId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_customerId_key" ON "BillingAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_subscriptionId_key" ON "BillingAccount"("subscriptionId");

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_createdAt_idx" ON "BillingEvent"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaidBudget" ADD CONSTRAINT "PaidBudget_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBudget" ADD CONSTRAINT "PaidBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReservation" ADD CONSTRAINT "PaidReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReservation" ADD CONSTRAINT "PaidReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent'
  ] LOOP
    relation_name := format('public.%I',name);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'RegPilot private table % is missing; apply schema first',relation_name;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC',relation_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',relation_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$private$;
COMMIT;
