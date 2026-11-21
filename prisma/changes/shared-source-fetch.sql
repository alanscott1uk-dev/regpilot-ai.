BEGIN;
CREATE TABLE public."PublicSourceFetch" (
 key VARCHAR(64) PRIMARY KEY,
 "sourceId" VARCHAR(120) NOT NULL,
 payload JSONB,
 "payloadHash" VARCHAR(64),
 "fetchedAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3),
 "leaseToken" UUID,
 "leaseUntil" TIMESTAMP(3),
 "retryAt" TIMESTAMP(3),
 failures INTEGER NOT NULL DEFAULT 0,
 "failureCode" VARCHAR(40),
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PublicSourceFetch_updatedAt_idx" ON public."PublicSourceFetch"("updatedAt");
ALTER TABLE public."RegulatorySnapshot" ADD COLUMN "sourceFetchedAt" TIMESTAMP(3);
ALTER TABLE public."PublicSourceFetch" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."PublicSourceFetch" FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public."PublicSourceFetch" FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public."PublicSourceFetch" TO regpilot_staging_runtime;
  CREATE POLICY regpilot_runtime_access ON public."PublicSourceFetch" FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true);
 END IF;
END $roles$;
COMMIT;
