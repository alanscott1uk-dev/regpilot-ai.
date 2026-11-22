-- Isolated RegPilot staging only. The scheduler reads four fixed public JSON endpoints.
DO $$ BEGIN
 IF to_regrole('regpilot_staging_runtime') IS NULL OR to_regclass('regpilot_verification.samples') IS NULL
 THEN RAISE EXCEPTION 'RegPilot staging monitoring is required'; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS regpilot_staging_fetch;
REVOKE ALL ON SCHEMA regpilot_staging_fetch FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA regpilot_staging_fetch;
DO $$ BEGIN
 IF to_regprocedure('regpilot_staging_fetch.http_get(character varying)') IS NULL
 OR has_schema_privilege('anon','regpilot_staging_fetch','USAGE')
 OR has_schema_privilege('authenticated','regpilot_staging_fetch','USAGE')
 OR has_schema_privilege('regpilot_staging_runtime','regpilot_staging_fetch','USAGE')
 THEN RAISE EXCEPTION 'Expected a staging-only HTTP client'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS regpilot_verification.register_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS regpilot_verification.register_requests (
 request_id bigint PRIMARY KEY, batch_id uuid NOT NULL REFERENCES regpilot_verification.register_batches(id),
 provider text NOT NULL, part text NOT NULL, url text NOT NULL, finished_at timestamptz,
 http_status int, metadata jsonb, fingerprint text, UNIQUE(batch_id,provider,part)
);
REVOKE ALL ON regpilot_verification.register_batches,regpilot_verification.register_requests FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
ALTER TABLE regpilot_verification.register_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE regpilot_verification.register_requests ENABLE ROW LEVEL SECURITY;
CREATE SEQUENCE IF NOT EXISTS regpilot_verification.register_local_request MINVALUE 1 START 1000000;
REVOKE ALL ON SEQUENCE regpilot_verification.register_local_request FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE OR REPLACE FUNCTION regpilot_verification.queue_public_registers() RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE batch uuid; item record; seq bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock(74119351) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM regpilot_verification.register_batches WHERE started_at>clock_timestamp()-interval '24 hours') THEN RETURN NULL; END IF;
 INSERT INTO regpilot_verification.register_batches DEFAULT VALUES RETURNING id INTO batch;
 FOR item IN SELECT * FROM (VALUES
 ('NHSBSA_MAPPING','package','https://opendata.nhsbsa.net/api/3/action/package_show?id=bnf-snomed-mapping'),
 ('NHSBSA_MAPPING','resource','https://opendata.nhsbsa.net/api/3/action/resource_show?id=638b7dc9-1eac-4495-9fc5-423fc52483e2'),
 ('CLINICALTRIALS_GOV','study','https://clinicaltrials.gov/api/v2/studies/NCT02091375?fields=NCTId,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate'),
 ('OPENFDA_RECALL','recall','https://api.fda.gov/drug/enforcement.json?search=recall_number%3A%22D-321-2016%22+AND+event_id%3A%2272241%22&limit=2')
 ) AS t(provider,part,url) LOOP
  SELECT nextval('regpilot_verification.register_local_request') INTO seq;
  INSERT INTO regpilot_verification.register_requests(request_id,batch_id,provider,part,url)
  VALUES(seq,batch,item.provider,item.part,item.url);
 END LOOP;
 RETURN batch;
END $$;
-- Persist only the metadata consumed by the workspace collectors, excluding trial text and recall descriptions.
CREATE OR REPLACE FUNCTION regpilot_verification.register_metadata(part text, body jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE r jsonb:=body->'result'; items jsonb;
BEGIN
 IF part='study' THEN
  RETURN jsonb_build_object('protocolSection',jsonb_build_object(
   'identificationModule',jsonb_build_object('nctId',body#>'{protocolSection,identificationModule,nctId}'),
   'statusModule', (SELECT jsonb_object_agg(key,value) FROM jsonb_each(body#>'{protocolSection,statusModule}') WHERE key IN ('overallStatus','lastUpdatePostDateStruct','resultsFirstPostDateStruct'))));
 ELSIF part='recall' THEN
  SELECT jsonb_agg((SELECT jsonb_object_agg(key,value) FROM jsonb_each(entry) WHERE key IN
   ('recall_number','event_id','product_type','classification','status','termination_date','report_date','recall_initiation_date')))
  INTO items FROM jsonb_array_elements(body->'results') AS x(entry);
  RETURN jsonb_build_object('meta',jsonb_build_object('results',body#>'{meta,results}'),'results',items);
 ELSIF part='resource' THEN
  RETURN jsonb_build_object('success',body->'success','result',(SELECT jsonb_object_agg(key,value) FROM jsonb_each(r)
   WHERE key IN ('id','name','format','state','package_id')));
 ELSIF part='package' THEN
  SELECT jsonb_agg((SELECT jsonb_object_agg(key,value) FROM jsonb_each(entry) WHERE key IN ('id','name','format','state')))
  INTO items FROM jsonb_array_elements(r->'resources') AS x(entry);
  RETURN jsonb_build_object('success',body->'success','result',
   (SELECT jsonb_object_agg(key,value) FROM jsonb_each(r) WHERE key IN ('id','name','state','num_resources')) || jsonb_build_object('resources',items));
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION regpilot_verification.finish_public_registers() RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE item record; projected jsonb; done integer:=0; response regpilot_staging_fetch.http_response;
BEGIN
 PERFORM set_config('http.curlopt_timeout_msec','6000',true);
 FOR item IN SELECT request_id,part,url FROM regpilot_verification.register_requests
  WHERE finished_at IS NULL ORDER BY request_id LIMIT 4 FOR UPDATE SKIP LOCKED
 LOOP
  projected:=NULL;response:=NULL;
  BEGIN
   SELECT * INTO response FROM regpilot_staging_fetch.http_get(item.url::varchar);
   IF response.status=200 AND lower(response.content_type) LIKE '%json%' AND octet_length(response.content)<=262144 THEN
    projected:=regpilot_verification.register_metadata(item.part,response.content::jsonb);
   END IF;
  EXCEPTION WHEN OTHERS THEN projected:=NULL; END;
  UPDATE regpilot_verification.register_requests SET finished_at=clock_timestamp(),http_status=response.status,metadata=projected,
   fingerprint=encode(sha256(convert_to(projected::text,'UTF8')),'hex') WHERE request_id=item.request_id;
  done:=done+1;
 END LOOP;
 RETURN done;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.queue_public_registers(),regpilot_verification.finish_public_registers(),regpilot_verification.register_metadata(text,jsonb) FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE OR REPLACE VIEW regpilot_verification.public_register_history AS
 SELECT b.id AS batch,b.started_at,r.provider,r.part,r.url,r.finished_at,r.http_status,r.metadata,r.fingerprint,
 r.fingerprint=encode(sha256(convert_to(r.metadata::text,'UTF8')),'hex') AS intact
 FROM regpilot_verification.register_requests r JOIN regpilot_verification.register_batches b ON b.id=r.batch_id;
REVOKE ALL ON regpilot_verification.public_register_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON regpilot_verification.public_register_history TO regpilot_staging_runtime;
SELECT cron.schedule('regpilot-stage-public-registers','*/15 * * * *','SELECT regpilot_verification.queue_public_registers()');
SELECT cron.schedule('regpilot-stage-finish-public-registers','* * * * *','SELECT regpilot_verification.finish_public_registers()');
