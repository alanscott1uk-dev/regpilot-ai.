-- RegPilot private-data hardening for tables managed by the server-side Prisma application.
-- Apply ONLY AFTER the matching Prisma tables exist and ONLY using a reviewed direct
-- database administrator connection. Supabase Auth does not use these Prisma tables.
--
-- This is an additional API-facing default-deny safety layer, not a complete tenant RLS
-- policy for the privileged direct-DB connection. Every server query must independently
-- enforce authenticated organisation membership. Never expose DATABASE_URL to browsers.
--
-- The SQL fails closed if any expected table is absent; it can be run repeatedly.
BEGIN;
DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision'
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
