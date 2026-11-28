-- The staging operator imports public catalogue metadata from one fixed provider endpoint.
DO $$ BEGIN
 IF to_regrole('regpilot_staging_runtime') IS NULL OR
    to_regprocedure('regpilot_staging_fetch.http_get(character varying)') IS NULL
 THEN RAISE EXCEPTION 'Install only on the RegPilot staging monitoring database'; END IF;
END $$;
CREATE TABLE regpilot_verification.source_registry (
 id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL, image text NOT NULL,
 version text NOT NULL, documentation text, license text, enterprise boolean NOT NULL,
 fields text[] NOT NULL, required_fields text[] NOT NULL, active boolean NOT NULL,
 refreshed_at timestamptz NOT NULL
);
ALTER TABLE regpilot_verification.source_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON regpilot_verification.source_registry FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;

CREATE OR REPLACE FUNCTION regpilot_verification.refresh_source_registry() RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE payload jsonb; response record; stamp timestamptz; imported integer;
BEGIN
 PERFORM pg_advisory_xact_lock(98375142);
 SELECT status,content INTO STRICT response FROM regpilot_staging_fetch.http_get(
  'https://connectors.airbyte.com/files/registries/v0/oss_registry.json'::varchar);
 IF response.status <> 200 OR octet_length(response.content) NOT BETWEEN 100 AND 20971520
 THEN RAISE EXCEPTION 'Upstream source registry unavailable'; END IF;
 payload := response.content::jsonb -> 'sources';
 IF jsonb_typeof(payload) IS DISTINCT FROM 'array' OR jsonb_array_length(payload) = 0
 THEN RAISE EXCEPTION 'Invalid source registry'; END IF;
 stamp := clock_timestamp();
 INSERT INTO regpilot_verification.source_registry AS target
  (id,name,kind,image,version,documentation,license,enterprise,fields,required_fields,active,refreshed_at)
 SELECT (s->>'sourceDefinitionId')::uuid, s->>'name',coalesce(s->>'sourceType','other'),
  s->>'dockerRepository',s->>'dockerImageTag',
  CASE WHEN s->>'documentationUrl' ~ '^https://docs\.airbyte\.com/[a-zA-Z0-9_./-]+$' THEN s->>'documentationUrl' END,
  s->>'license',coalesce((s#>>'{ab_internal,isEnterprise}')::boolean,false),
  ARRAY(SELECT jsonb_object_keys(s#>'{spec,connectionSpecification,properties}') ORDER BY 1),
  ARRAY(SELECT jsonb_array_elements_text(s#>'{spec,connectionSpecification,required}') ORDER BY 1),true,stamp
 FROM jsonb_array_elements(payload) a(s)
 WHERE (s->>'public')::boolean AND NOT coalesce((s->>'tombstone')::boolean,false)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,image=excluded.image,
  version=excluded.version,documentation=excluded.documentation,license=excluded.license,enterprise=excluded.enterprise,
  fields=excluded.fields,required_fields=excluded.required_fields,active=true,refreshed_at=excluded.refreshed_at;
 GET DIAGNOSTICS imported=ROW_COUNT;
 IF imported=0 OR imported < (SELECT count(*)*0.8 FROM regpilot_verification.source_registry WHERE active)
 THEN RAISE EXCEPTION 'Unexpected loss of upstream sources, previous snapshot retained'; END IF;
 UPDATE regpilot_verification.source_registry SET active=false WHERE active AND refreshed_at<>stamp;
 RETURN imported;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.refresh_source_registry() FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE VIEW regpilot_verification.available_source_definitions AS
 SELECT id,name,kind,image,version,documentation,license,fields,required_fields,refreshed_at,
  (NOT enterprise AND image ~ '^airbyte/source-[a-z0-9][a-z0-9.-]*$'
   AND version ~ '^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$') AS plan_available
 FROM regpilot_verification.source_registry WHERE active;
REVOKE ALL ON regpilot_verification.available_source_definitions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON regpilot_verification.available_source_definitions TO regpilot_staging_runtime;
