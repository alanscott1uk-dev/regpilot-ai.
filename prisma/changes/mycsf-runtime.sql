BEGIN;
-- Use the same private application role as the existing outbound integration service.
DO $$
DECLARE runtime name;
BEGIN
 IF to_regrole('service_role') IS NOT NULL THEN
  REVOKE ALL ON "MyCsfConnection", "MyCsfMapping" FROM service_role;
 END IF;
 FOR runtime IN SELECT rolname FROM pg_roles WHERE rolname IN ('regpilot_staging_runtime','regpilot_production_runtime')
   AND has_table_privilege(rolname,'"IntegrationEndpoint"','SELECT,INSERT,UPDATE,DELETE') LOOP
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON "MyCsfConnection", "MyCsfMapping" TO %I',runtime);
  EXECUTE format('CREATE POLICY %I ON "MyCsfConnection" FOR ALL TO %I USING (current_user=%L) WITH CHECK (current_user=%L)',runtime,runtime,runtime,runtime);
  EXECUTE format('CREATE POLICY %I ON "MyCsfMapping" FOR ALL TO %I USING (current_user=%L) WITH CHECK (current_user=%L)',runtime,runtime,runtime,runtime);
 END LOOP;
END $$;
COMMIT;
