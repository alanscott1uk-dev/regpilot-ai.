BEGIN;
CREATE TABLE public."AutomationEvent" (
 id UUID PRIMARY KEY,
 "organizationId" UUID NOT NULL,
 "connectorId" UUID NOT NULL,
 "eventKey" VARCHAR(64) NOT NULL,
 kind VARCHAR(24) NOT NULL,
 "configVersion" INTEGER NOT NULL,
 "runId" UUID,
 fingerprint VARCHAR(64) NOT NULL,
 changed BOOLEAN NOT NULL DEFAULT false,
 "reasonCode" VARCHAR(40),
 state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
 attempts INTEGER NOT NULL DEFAULT 0,
 "replayCount" INTEGER NOT NULL DEFAULT 0,
 version INTEGER NOT NULL DEFAULT 1,
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" UUID,
 "leaseUntil" TIMESTAMP(3),
 "lastErrorCode" VARCHAR(40),
 "finishedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AutomationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "AutomationEvent_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId","organizationId") REFERENCES public."EvidenceConnector"(id,"organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutomationEvent_eventKey_key" ON public."AutomationEvent"("eventKey");
CREATE INDEX "AutomationEvent_organizationId_state_availableAt_idx" ON public."AutomationEvent"("organizationId",state,"availableAt");
CREATE INDEX "AutomationEvent_organizationId_state_leaseUntil_idx" ON public."AutomationEvent"("organizationId",state,"leaseUntil");
CREATE INDEX "AutomationEvent_state_createdAt_idx" ON public."AutomationEvent"(state,"createdAt");
CREATE OR REPLACE FUNCTION public.regpilot_dispatch_lane() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 INSERT INTO public."DispatchLane"("organizationId",kind)
 VALUES(NEW."organizationId",CASE TG_TABLE_NAME WHEN 'WatchSchedule' THEN 'SOURCE' WHEN 'AutomationEvent' THEN 'AUTOMATION' ELSE 'CONNECTOR' END)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $fn$;
CREATE TRIGGER regpilot_automation_dispatch_lane AFTER INSERT ON public."AutomationEvent" FOR EACH ROW EXECUTE FUNCTION public.regpilot_dispatch_lane();
ALTER TABLE public."AutomationEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."AutomationEvent" FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public."AutomationEvent" FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public."AutomationEvent" TO regpilot_staging_runtime;
  CREATE POLICY regpilot_runtime_access ON public."AutomationEvent" FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true);
 END IF;
END $roles$;
COMMIT;
