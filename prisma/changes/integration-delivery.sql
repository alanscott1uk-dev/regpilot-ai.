-- Durable, company-scoped outbound integration events and delivery history.
BEGIN;

-- CreateTable
CREATE TABLE "IntegrationEndpoint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "configuredById" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "eventTypes" VARCHAR(60)[],
    "state" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedSecret" TEXT,
    "secretHint" VARCHAR(8) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedVersion" INTEGER,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCode" VARCHAR(80),
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSkippedAt" TIMESTAMP(3),
    "lastDispatchedAt" TIMESTAMP(3),
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEndpointControl" (
    "organizationId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "IntegrationEndpointControl_pkey" PRIMARY KEY ("endpointId","controlId")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventKey" VARCHAR(64) NOT NULL,
    "eventType" VARCHAR(60) NOT NULL,
    "sourceKind" VARCHAR(40) NOT NULL,
    "sourceId" UUID NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "controlIds" UUID[],
    "payload" JSONB NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationDelivery" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "endpointVersion" INTEGER NOT NULL,
    "secretVersion" INTEGER NOT NULL,
    "controlIds" UUID[],
    "payload" JSONB NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cycleAttempts" INTEGER NOT NULL DEFAULT 0,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" VARCHAR(80),
    "lastHttpStatus" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAttempt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "endpointVersion" INTEGER NOT NULL,
    "secretVersion" INTEGER NOT NULL,
    "leaseToken" UUID NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'SENDING',
    "requestHash" VARCHAR(64) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "responseBytes" INTEGER,
    "errorCode" VARCHAR(80),
    "peerAddressHash" VARCHAR(64),

    CONSTRAINT "IntegrationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationBudget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bucket" VARCHAR(80) NOT NULL,
    "window" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IntegrationBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "entityId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationEndpoint_organizationId_state_expiresAt_idx" ON "IntegrationEndpoint"("organizationId", "state", "expiresAt");

-- CreateIndex
CREATE INDEX "IntegrationEndpoint_lastDispatchedAt_leaseUntil_idx" ON "IntegrationEndpoint"("lastDispatchedAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEndpoint_id_organizationId_key" ON "IntegrationEndpoint"("id", "organizationId");

-- CreateIndex
CREATE INDEX "IntegrationEndpointControl_organizationId_controlId_idx" ON "IntegrationEndpointControl"("organizationId", "controlId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_organizationId_createdAt_idx" ON "IntegrationEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_id_organizationId_key" ON "IntegrationEvent"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_organizationId_eventKey_key" ON "IntegrationEvent"("organizationId", "eventKey");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_organizationId_state_availableAt_idx" ON "IntegrationDelivery"("organizationId", "state", "availableAt");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_endpointId_state_availableAt_idx" ON "IntegrationDelivery"("endpointId", "state", "availableAt");

-- CreateIndex
CREATE INDEX "IntegrationDelivery_organizationId_createdAt_id_idx" ON "IntegrationDelivery"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_id_organizationId_key" ON "IntegrationDelivery"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationDelivery_endpointId_eventId_key" ON "IntegrationDelivery"("endpointId", "eventId");

-- CreateIndex
CREATE INDEX "IntegrationAttempt_organizationId_startedAt_idx" ON "IntegrationAttempt"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationAttempt_deliveryId_number_key" ON "IntegrationAttempt"("deliveryId", "number");

-- CreateIndex
CREATE INDEX "IntegrationBudget_organizationId_window_idx" ON "IntegrationBudget"("organizationId", "window");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationBudget_organizationId_bucket_window_key" ON "IntegrationBudget"("organizationId", "bucket", "window");

-- CreateIndex
CREATE INDEX "IntegrationOperation_organizationId_createdAt_idx" ON "IntegrationOperation"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOperation_organizationId_requestKey_key" ON "IntegrationOperation"("organizationId", "requestKey");

-- AddForeignKey
ALTER TABLE "IntegrationEndpoint" ADD CONSTRAINT "IntegrationEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEndpoint" ADD CONSTRAINT "IntegrationEndpoint_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEndpointControl" ADD CONSTRAINT "IntegrationEndpointControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEndpointControl" ADD CONSTRAINT "IntegrationEndpointControl_endpointId_organizationId_fkey" FOREIGN KEY ("endpointId", "organizationId") REFERENCES "IntegrationEndpoint"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEndpointControl" ADD CONSTRAINT "IntegrationEndpointControl_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_endpointId_organizationId_fkey" FOREIGN KEY ("endpointId", "organizationId") REFERENCES "IntegrationEndpoint"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_eventId_organizationId_fkey" FOREIGN KEY ("eventId", "organizationId") REFERENCES "IntegrationEvent"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_deliveryId_organizationId_fkey" FOREIGN KEY ("deliveryId", "organizationId") REFERENCES "IntegrationDelivery"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationBudget" ADD CONSTRAINT "IntegrationBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bounded state, integrity and recovery contracts complement scoped foreign keys.
ALTER TABLE "IntegrationEndpoint" ADD CONSTRAINT "IntegrationEndpoint_fields_check" CHECK ("version">0 AND "secretVersion">0 AND "state" IN ('DRAFT','ACTIVE','PAUSED','REVOKED') AND char_length("secretHint")=8 AND "skippedCount">=0 AND "eventTypes" IS NOT NULL AND cardinality("eventTypes") BETWEEN 1 AND 4 AND "eventTypes" <@ ARRAY['customer.observation.received','customer.observation.reviewed','connector.observation.recorded','connector.collection.failed']::varchar[] AND ("state"<>'REVOKED' OR "encryptedSecret" IS NULL));
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_fields_check" CHECK ("sourceVersion">0 AND "sourceKind" IN ('CUSTOMER_OBSERVATION','CONNECTOR_RUN','CONNECTOR_FAILURE','ENDPOINT') AND "eventType" IN ('customer.observation.received','customer.observation.reviewed','connector.observation.recorded','connector.collection.failed','endpoint.probe') AND "eventKey" ~ '^[a-f0-9]{64}$' AND "payloadHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("payload")='object' AND "controlIds" IS NOT NULL AND cardinality("controlIds")<=500);
ALTER TABLE "IntegrationDelivery" ADD CONSTRAINT "IntegrationDelivery_fields_check" CHECK ("version">0 AND "endpointVersion">0 AND "secretVersion">0 AND "attempts" BETWEEN 0 AND 24 AND "cycleAttempts" BETWEEN 0 AND 6 AND "attempts">="cycleAttempts" AND "replayCount" BETWEEN 0 AND 3 AND "state" IN ('PENDING','SENDING','DELIVERED','DEAD','CANCELLED') AND "payloadHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("payload")='object' AND "controlIds" IS NOT NULL AND cardinality("controlIds")<=50 AND ("lastHttpStatus" IS NULL OR "lastHttpStatus" BETWEEN 100 AND 599));
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_fields_check" CHECK ("number" BETWEEN 1 AND 24 AND "endpointVersion">0 AND "secretVersion">0 AND "state" IN ('SENDING','DELIVERED','RETRY_SCHEDULED','FAILED','CANCELLED','INTERRUPTED') AND "requestHash" ~ '^[a-f0-9]{64}$' AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599) AND ("durationMs" IS NULL OR "durationMs">=0) AND ("responseBytes" IS NULL OR "responseBytes" BETWEEN 0 AND 4096) AND ("peerAddressHash" IS NULL OR "peerAddressHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE "IntegrationBudget" ADD CONSTRAINT "IntegrationBudget_fields_check" CHECK ("count">=0 AND "window"=date_trunc('minute',"window") AND ("bucket" IN ('company-minute','company-day') OR "bucket" ~ '^endpoint:[a-f0-9-]{36}$'));
ALTER TABLE "IntegrationOperation" ADD CONSTRAINT "IntegrationOperation_fields_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND "resultHash" ~ '^[a-f0-9]{64}$' AND "action" IN ('CREATED','PROBE','PAUSE','RESUME','ROTATE','REVOKE','REPLAY') AND jsonb_typeof("result")='object' AND NOT ("result" ?| ARRAY['secret','encryptedSecret','token']));
ALTER TABLE "IntegrationEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationEndpointControl" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationOperation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "IntegrationEndpoint","IntegrationEndpointControl","IntegrationEvent","IntegrationDelivery","IntegrationAttempt","IntegrationBudget","IntegrationOperation" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['IntegrationEndpoint','IntegrationEndpointControl','IntegrationEvent','IntegrationDelivery','IntegrationAttempt','IntegrationBudget','IntegrationOperation'] LOOP
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
