BEGIN;
CREATE TABLE public."ProviderGate" (
 provider VARCHAR(24) PRIMARY KEY,
 generation INTEGER NOT NULL DEFAULT 0,
 failures INTEGER NOT NULL DEFAULT 0,
 "failureScopes" JSONB NOT NULL DEFAULT '[]',
 "lastFailureAt" TIMESTAMP(3),
 trips INTEGER NOT NULL DEFAULT 0,
 "openUntil" TIMESTAMP(3),
 "probeToken" UUID,
 "probeUntil" TIMESTAMP(3)
);
CREATE TABLE public."ProviderPermit" (
 token UUID PRIMARY KEY,
 provider VARCHAR(24) NOT NULL,
 generation INTEGER NOT NULL,
 "scopeHash" VARCHAR(64) NOT NULL,
 probe BOOLEAN NOT NULL DEFAULT false,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProviderPermit_provider_fkey" FOREIGN KEY(provider) REFERENCES public."ProviderGate"(provider) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ProviderPermit_provider_expiresAt_idx" ON public."ProviderPermit"(provider,"expiresAt");
ALTER TABLE public."EvidenceConnector"
 ADD COLUMN "encryptedWebhookSecret" TEXT,
 ADD COLUMN "webhookVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "eventRevision" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "collectedEventRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE public."WebhookReceipt" (
 id UUID PRIMARY KEY,
 "connectorId" UUID NOT NULL,
 "webhookVersion" INTEGER NOT NULL,
 "deliveryId" VARCHAR(128) NOT NULL,
 "payloadHash" VARCHAR(64) NOT NULL,
 event VARCHAR(60) NOT NULL,
 revision INTEGER NOT NULL,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WebhookReceipt_connectorId_fkey" FOREIGN KEY("connectorId") REFERENCES public."EvidenceConnector"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebhookReceipt_connectorId_webhookVersion_deliveryId_key" ON public."WebhookReceipt"("connectorId","webhookVersion","deliveryId");
CREATE UNIQUE INDEX "WebhookReceipt_connectorId_webhookVersion_payloadHash_key" ON public."WebhookReceipt"("connectorId","webhookVersion","payloadHash");
CREATE INDEX "WebhookReceipt_connectorId_receivedAt_idx" ON public."WebhookReceipt"("connectorId","receivedAt");
CREATE INDEX "WebhookReceipt_receivedAt_idx" ON public."WebhookReceipt"("receivedAt");
DO $protect$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['ProviderGate','ProviderPermit','WebhookReceipt'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,r); END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO regpilot_staging_runtime',t);
   EXECUTE format('CREATE POLICY regpilot_runtime_access ON public.%I FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true)',t);
  END IF;
 END LOOP;
END $protect$;
COMMIT;
