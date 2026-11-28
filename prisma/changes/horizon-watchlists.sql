BEGIN;
CREATE TABLE "HorizonWatchlist" (
    "organizationId" UUID NOT NULL CONSTRAINT "HorizonWatchlist_organizationId_fkey" REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "filters" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "changedById" UUID NOT NULL CONSTRAINT "HorizonWatchlist_changedById_fkey" REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    PRIMARY KEY ("organizationId", "id")
);
CREATE INDEX "HorizonWatchlist_organizationId_archived_name_idx" ON "HorizonWatchlist"("organizationId","archived","name");
ALTER TABLE "HorizonWatchlist" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "HorizonWatchlist" FROM PUBLIC;
DO $private$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "HorizonWatchlist" FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "HorizonWatchlist" TO regpilot_staging_runtime;
    CREATE POLICY regpilot_staging_runtime_private ON "HorizonWatchlist" FOR ALL TO regpilot_staging_runtime
      USING (current_user='regpilot_staging_runtime') WITH CHECK (current_user='regpilot_staging_runtime');
  END IF;
END
$private$;
COMMIT;
