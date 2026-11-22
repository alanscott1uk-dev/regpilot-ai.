-- Operator-run, bounded verification of the public image tags referenced in the registry.
CREATE TABLE regpilot_verification.source_artifact_checks (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, definition_id uuid NOT NULL REFERENCES regpilot_verification.source_registry(id),
 image text NOT NULL, version text NOT NULL, checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status integer NOT NULL, digest text, retry_at timestamptz,
 CHECK (digest IS NULL OR digest ~ '^sha256:[0-9a-f]{64}$')
);
CREATE INDEX source_artifact_version_idx ON regpilot_verification.source_artifact_checks(definition_id,image,version,checked_at DESC);
ALTER TABLE regpilot_verification.source_artifact_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON regpilot_verification.source_artifact_checks FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE FUNCTION regpilot_verification.check_source_artifacts(batch_size integer DEFAULT 10)
RETURNS integer LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE src record; res record; item jsonb; actual text; code int; wait_seconds int; done int:=0;
BEGIN
 IF batch_size NOT BETWEEN 1 AND 15 OR batch_size IS NULL THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 IF NOT pg_try_advisory_xact_lock(98375143) THEN RETURN 0; END IF;
 IF EXISTS (SELECT 1 FROM regpilot_verification.source_artifact_checks WHERE retry_at>clock_timestamp()) THEN RETURN 0; END IF;
 FOR src IN SELECT d.* FROM regpilot_verification.available_source_definitions d
  LEFT JOIN LATERAL (SELECT checked_at,status FROM regpilot_verification.source_artifact_checks a
   WHERE (a.definition_id,a.image,a.version)=(d.id,d.image,d.version) ORDER BY checked_at DESC,id DESC LIMIT 1) last_run ON true
  WHERE d.plan_available AND (last_run.checked_at IS NULL OR last_run.checked_at<
    clock_timestamp()-CASE WHEN last_run.status=200 THEN interval '7 days' ELSE interval '12 hours' END)
  ORDER BY last_run.checked_at NULLS FIRST,(d.kind='database') DESC,d.name LIMIT batch_size
 LOOP
  actual:=null; wait_seconds:=null;
  BEGIN
   SELECT * INTO STRICT res FROM regpilot_staging_fetch.http_get(('https://hub.docker.com/v2/namespaces/airbyte/repositories/'||
    split_part(src.image,'/',2)||'/tags/'||src.version)::varchar);
   code:=res.status;
   IF code=200 AND octet_length(res.content) BETWEEN 50 AND 524288 THEN
    item:=res.content::jsonb;
    IF item->>'name'=src.version AND item->>'digest' ~ '^sha256:[0-9a-f]{64}$' AND EXISTS
     (SELECT 1 FROM jsonb_array_elements(item->'images') i WHERE i->>'os'='linux'
      AND i->>'architecture' IN ('amd64','arm64') AND i->>'digest' ~ '^sha256:[0-9a-f]{64}$')
    THEN actual:=item->>'digest'; END IF;
   ELSIF code=429 OR code=503 THEN
    SELECT CASE WHEN h.value ~ '^[0-9]{1,8}$' THEN greatest(30,h.value::int)
      ELSE greatest(30,extract(epoch FROM h.value::timestamptz-clock_timestamp())::int) END INTO wait_seconds
    FROM unnest(res.headers) h WHERE lower(h.field)='retry-after' LIMIT 1;
    wait_seconds:=coalesce(wait_seconds,180);
   END IF;
  EXCEPTION WHEN OTHERS THEN code:=0; actual:=null; wait_seconds:=30;
  END;
  INSERT INTO regpilot_verification.source_artifact_checks(definition_id,image,version,status,digest,retry_at)
  VALUES(src.id,src.image,src.version,code,actual,clock_timestamp()+make_interval(secs=>wait_seconds));
  done:=done+1;
  IF wait_seconds IS NOT NULL THEN EXIT; END IF;
 END LOOP;
 RETURN done;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.check_source_artifacts(integer) FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE VIEW regpilot_verification.source_collection_plans AS
 SELECT d.*,proof.digest AS artifact_digest,proof.checked_at AS artifact_checked_at,
  coalesce(proof.digest IS NOT NULL AND proof.checked_at>=now()-interval '8 days' AND proof.digest=first_ok.digest,false) AS artifact_verified
 FROM regpilot_verification.available_source_definitions d
 LEFT JOIN LATERAL (SELECT digest,checked_at FROM regpilot_verification.source_artifact_checks a
  WHERE (a.definition_id,a.image,a.version)=(d.id,d.image,d.version) ORDER BY checked_at DESC,id DESC LIMIT 1) proof ON true
 LEFT JOIN LATERAL (SELECT digest FROM regpilot_verification.source_artifact_checks a
  WHERE (a.definition_id,a.image,a.version)=(d.id,d.image,d.version) AND digest IS NOT NULL ORDER BY checked_at,id LIMIT 1) first_ok ON true;
REVOKE ALL ON regpilot_verification.source_collection_plans FROM PUBLIC,anon,authenticated;
GRANT SELECT ON regpilot_verification.source_collection_plans TO regpilot_staging_runtime;
