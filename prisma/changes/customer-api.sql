-- Private customer integrations. Apply with the reviewed application release.
BEGIN;
-- CreateTable
CREATE TABLE "CustomerApiCredential" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "issuedById" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "scopes" VARCHAR(40)[],
    "secretHash" VARCHAR(64) NOT NULL,
    "hint" VARCHAR(8) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerApiControlGrant" (
    "organizationId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "controlId" UUID NOT NULL,

    CONSTRAINT "CustomerApiControlGrant_pkey" PRIMARY KEY ("credentialId","controlId")
);

-- CreateTable
CREATE TABLE "CustomerApiBudget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bucket" VARCHAR(80) NOT NULL,
    "minute" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerApiBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerApiObservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "controlId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "externalId" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewerId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "followUpTaskId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerApiObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerApiOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "entityId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerApiOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerApiCredential_organizationId_createdAt_idx" ON "CustomerApiCredential"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerApiCredential_organizationId_revokedAt_expiresAt_idx" ON "CustomerApiCredential"("organizationId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiCredential_id_organizationId_key" ON "CustomerApiCredential"("id", "organizationId");

-- CreateIndex
CREATE INDEX "CustomerApiControlGrant_organizationId_controlId_idx" ON "CustomerApiControlGrant"("organizationId", "controlId");

-- CreateIndex
CREATE INDEX "CustomerApiBudget_organizationId_minute_idx" ON "CustomerApiBudget"("organizationId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiBudget_organizationId_bucket_minute_key" ON "CustomerApiBudget"("organizationId", "bucket", "minute");

-- CreateIndex
CREATE INDEX "CustomerApiObservation_organizationId_status_receivedAt_id_idx" ON "CustomerApiObservation"("organizationId", "status", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "CustomerApiObservation_organizationId_credentialId_received_idx" ON "CustomerApiObservation"("organizationId", "credentialId", "receivedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiObservation_id_organizationId_key" ON "CustomerApiObservation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiObservation_credentialId_requestKey_key" ON "CustomerApiObservation"("credentialId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiObservation_credentialId_controlId_externalId_key" ON "CustomerApiObservation"("credentialId", "controlId", "externalId");

-- CreateIndex
CREATE INDEX "CustomerApiOperation_organizationId_createdAt_idx" ON "CustomerApiOperation"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerApiOperation_organizationId_requestKey_key" ON "CustomerApiOperation"("organizationId", "requestKey");

-- AddForeignKey
ALTER TABLE "CustomerApiCredential" ADD CONSTRAINT "CustomerApiCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiCredential" ADD CONSTRAINT "CustomerApiCredential_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiControlGrant" ADD CONSTRAINT "CustomerApiControlGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiControlGrant" ADD CONSTRAINT "CustomerApiControlGrant_credentialId_organizationId_fkey" FOREIGN KEY ("credentialId", "organizationId") REFERENCES "CustomerApiCredential"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiControlGrant" ADD CONSTRAINT "CustomerApiControlGrant_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiBudget" ADD CONSTRAINT "CustomerApiBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_credentialId_organizationId_fkey" FOREIGN KEY ("credentialId", "organizationId") REFERENCES "CustomerApiCredential"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_followUpTaskId_organizationId_fkey" FOREIGN KEY ("followUpTaskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiOperation" ADD CONSTRAINT "CustomerApiOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerApiOperation" ADD CONSTRAINT "CustomerApiOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerApiCredential" ADD CONSTRAINT "CustomerApiCredential_fields_check" CHECK ("version">0 AND "secretHash" ~ '^[a-f0-9]{64}$' AND char_length("hint")=8 AND "expiresAt">"createdAt" AND "scopes" IS NOT NULL AND cardinality("scopes") BETWEEN 1 AND 6 AND "scopes" <@ ARRAY['controls:read','tasks:read','regulatory:read','evidence:read','observations:read','observations:write']::varchar[]);
ALTER TABLE "CustomerApiBudget" ADD CONSTRAINT "CustomerApiBudget_fields_check" CHECK ("count">=0 AND "minute"=date_trunc('minute',"minute") AND ("bucket"='company' OR "bucket" ~ '^key:[a-f0-9-]{36}$'));
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_fields_check" CHECK ("version">0 AND "credentialVersion">0 AND "validUntil">"observedAt" AND "payloadHash" ~ '^[a-f0-9]{64}$' AND "contextHash" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("payload")='object' AND jsonb_typeof("context")='object' AND "status" IN ('PENDING','ACKNOWLEDGED','FOLLOW_UP','REJECTED'));
ALTER TABLE "CustomerApiObservation" ADD CONSTRAINT "CustomerApiObservation_review_check" CHECK (("status"='PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL AND "reviewNotes"='' AND "followUpTaskId" IS NULL) OR ("status"<>'PENDING' AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND char_length("reviewNotes")>=20 AND (("status"='FOLLOW_UP' AND "followUpTaskId" IS NOT NULL) OR ("status"<>'FOLLOW_UP' AND "followUpTaskId" IS NULL))));
ALTER TABLE "CustomerApiOperation" ADD CONSTRAINT "CustomerApiOperation_fields_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND "action" IN ('CREATED','ROTATED','REVOKED','OBSERVATION_REVIEWED') AND jsonb_typeof("result")='object' AND NOT ("result" ?| ARRAY['secret','secretHash']));
ALTER TABLE "CustomerApiCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerApiControlGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerApiBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerApiObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerApiOperation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "CustomerApiCredential","CustomerApiControlGrant","CustomerApiBudget","CustomerApiObservation","CustomerApiOperation" FROM PUBLIC;
DO $private$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['CustomerApiCredential','CustomerApiControlGrant','CustomerApiBudget','CustomerApiObservation','CustomerApiOperation'] LOOP
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
