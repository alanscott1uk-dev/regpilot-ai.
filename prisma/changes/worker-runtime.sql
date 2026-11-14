BEGIN;
CREATE TABLE public."WorkerRun" (
 "id" UUID NOT NULL,
 "invocationKey" VARCHAR(80) NOT NULL,
 "state" VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3) NOT NULL,
 "finishedAt" TIMESTAMP(3),
 "codeCommit" VARCHAR(40),
 "summary" JSONB,
 CONSTRAINT "WorkerRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkerRun_invocationKey_key" ON public."WorkerRun"("invocationKey");
CREATE INDEX "WorkerRun_state_startedAt_idx" ON public."WorkerRun"("state","startedAt");
CREATE INDEX "WorkerRun_startedAt_idx" ON public."WorkerRun"("startedAt");
ALTER TABLE public."WorkerRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."WorkerRun" FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public."WorkerRun" FROM %I',r);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public."WorkerRun" TO regpilot_staging_runtime;
  CREATE POLICY regpilot_runtime_access ON public."WorkerRun" FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true);
 END IF;
END $roles$;
COMMIT;
