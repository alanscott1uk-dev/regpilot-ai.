BEGIN;
CREATE TABLE public."DispatchLane" (
 "organizationId" UUID NOT NULL,
 "kind" VARCHAR(20) NOT NULL,
 "lastDispatchedAt" TIMESTAMP(3),
 "leaseToken" UUID,
 "leaseUntil" TIMESTAMP(3),
 "dispatchCount" INTEGER NOT NULL DEFAULT 0,
 CONSTRAINT "DispatchLane_pkey" PRIMARY KEY("organizationId","kind"),
 CONSTRAINT "DispatchLane_organizationId_fkey" FOREIGN KEY("organizationId") REFERENCES public."Organization"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DispatchLane_kind_lastDispatchedAt_organizationId_idx" ON public."DispatchLane"("kind","lastDispatchedAt","organizationId");
CREATE INDEX "WatchSchedule_organizationId_enabled_nextCheckAt_idx" ON public."WatchSchedule"("organizationId",enabled,"nextCheckAt");
CREATE INDEX "WatchSchedule_organizationId_enabled_leaseUntil_idx" ON public."WatchSchedule"("organizationId",enabled,"leaseUntil");
CREATE INDEX "EvidenceConnector_organizationId_enabled_nextRunAt_idx" ON public."EvidenceConnector"("organizationId",enabled,"nextRunAt");
CREATE INDEX "EvidenceConnector_organizationId_enabled_leaseUntil_idx" ON public."EvidenceConnector"("organizationId",enabled,"leaseUntil");

-- All scheduling entry points, including imports, create a tenant lane atomically.
CREATE FUNCTION public.regpilot_dispatch_lane() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 INSERT INTO public."DispatchLane"("organizationId",kind)
 VALUES(NEW."organizationId",CASE TG_TABLE_NAME WHEN 'WatchSchedule' THEN 'SOURCE' ELSE 'CONNECTOR' END)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.regpilot_dispatch_lane() FROM PUBLIC;
CREATE TRIGGER regpilot_source_dispatch_lane AFTER INSERT ON public."WatchSchedule" FOR EACH ROW EXECUTE FUNCTION public.regpilot_dispatch_lane();
CREATE TRIGGER regpilot_connector_dispatch_lane AFTER INSERT ON public."EvidenceConnector" FOR EACH ROW EXECUTE FUNCTION public.regpilot_dispatch_lane();
INSERT INTO public."DispatchLane"("organizationId",kind) SELECT DISTINCT "organizationId",'SOURCE' FROM public."WatchSchedule" ON CONFLICT DO NOTHING;
INSERT INTO public."DispatchLane"("organizationId",kind) SELECT DISTINCT "organizationId",'CONNECTOR' FROM public."EvidenceConnector" ON CONFLICT DO NOTHING;
ALTER TABLE public."DispatchLane" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."DispatchLane" FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public."DispatchLane" FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public."DispatchLane" TO regpilot_staging_runtime;
  GRANT EXECUTE ON FUNCTION public.regpilot_dispatch_lane() TO regpilot_staging_runtime;
  CREATE POLICY regpilot_runtime_access ON public."DispatchLane" FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true);
 END IF;
END $roles$;
COMMIT;
