-- Keep each publisher's own real collection interval when enrolling additional public sources.
CREATE OR REPLACE FUNCTION regpilot_verification.queue_public_registers() RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE batch uuid; item record;
BEGIN
 IF NOT pg_try_advisory_xact_lock(74119351) THEN RETURN NULL; END IF;
 FOR item IN WITH targets(provider,part,url) AS (VALUES
  ('NHSBSA_MAPPING','package','https://opendata.nhsbsa.net/api/3/action/package_show?id=bnf-snomed-mapping'),
  ('NHSBSA_MAPPING','resource','https://opendata.nhsbsa.net/api/3/action/resource_show?id=638b7dc9-1eac-4495-9fc5-423fc52483e2'),
  ('CLINICALTRIALS_GOV','study','https://clinicaltrials.gov/api/v2/studies/NCT02091375?fields=NCTId,OverallStatus,LastUpdatePostDate,ResultsFirstPostDate'),
  ('OPENFDA_RECALL','recall','https://api.fda.gov/drug/enforcement.json?search=recall_number%3A%22D-321-2016%22+AND+event_id%3A%2272241%22&limit=2'),
  ('DAILYMED_LABEL','label-history','https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/8bf27097-4870-43fb-94f0-f3d0871d1eec/history.json?pagesize=100'),
  ('EUROPE_PMC','publication','https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID%3A28538134%20AND%20SRC%3AMED&resultType=core&format=json&pageSize=1'),
  ('MHRA_GUIDANCE','guidance','https://www.gov.uk/api/content/guidance/good-manufacturing-practice-and-good-distribution-practice')
 ) SELECT t.* FROM targets t WHERE NOT EXISTS (
  SELECT 1 FROM regpilot_verification.register_batches b WHERE b.started_at>statement_timestamp()-interval '24 hours'
   AND NOT EXISTS (SELECT 1 FROM targets expected WHERE expected.provider=t.provider AND NOT EXISTS (
    SELECT 1 FROM regpilot_verification.register_requests r WHERE r.batch_id=b.id AND r.provider=expected.provider
     AND r.part=expected.part AND r.url=expected.url)))
 LOOP
  IF batch IS NULL THEN INSERT INTO regpilot_verification.register_batches DEFAULT VALUES RETURNING id INTO batch; END IF;
  INSERT INTO regpilot_verification.register_requests(request_id,batch_id,provider,part,url)
  VALUES(nextval('regpilot_verification.register_local_request'),batch,item.provider,item.part,item.url);
 END LOOP;
 RETURN batch;
END $$;

ALTER FUNCTION regpilot_verification.register_metadata(text,jsonb) RENAME TO original_register_metadata;
CREATE FUNCTION regpilot_verification.register_metadata(part text,body jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE row jsonb; entries jsonb; refs jsonb; notice jsonb;
BEGIN
 IF part='label-history' THEN
  SELECT jsonb_agg(jsonb_build_object('published_date',e->'published_date','spl_version',e->'spl_version')) INTO entries
  FROM jsonb_array_elements(body#>'{data,history}') e;
  RETURN jsonb_build_object('data',jsonb_build_object('spl',jsonb_build_object('setid',body#>'{data,spl,setid}'),'history',entries),
    'metadata',(SELECT jsonb_object_agg(key,value) FROM jsonb_each(body->'metadata') WHERE key IN ('current_page','total_pages','total_elements')));
 ELSIF part='publication' THEN
  FOR row IN SELECT value FROM jsonb_array_elements(body#>'{resultList,result}') LOOP
   refs:=(SELECT jsonb_object_agg(key,value) FROM jsonb_each(row) WHERE key IN ('source','id','pmid','doi','dateOfRevision','pubTypeList'));
   IF row ? 'commentCorrectionList' THEN
    refs:=refs||jsonb_build_object('commentCorrectionList',jsonb_build_object('commentCorrection',
     CASE WHEN jsonb_typeof(row#>'{commentCorrectionList,commentCorrection}')='array' THEN
     (SELECT coalesce(jsonb_agg(jsonb_build_object('type',e->'type')),'[]'::jsonb) FROM jsonb_array_elements(row#>'{commentCorrectionList,commentCorrection}') e) END));
   END IF;
   entries:=coalesce(entries,'[]'::jsonb)||jsonb_build_array(refs);
  END LOOP;
  RETURN jsonb_build_object('hitCount',body->'hitCount','resultList',jsonb_build_object('result',entries));
 ELSIF part='guidance' THEN
  SELECT jsonb_agg(jsonb_build_object('content_id',e->'content_id')) INTO entries
   FROM jsonb_array_elements(body#>'{links,primary_publishing_organisation}') e;
  notice:=body->'withdrawn_notice';
  IF jsonb_typeof(notice)='object' AND notice<>'{}'::jsonb THEN notice:=jsonb_build_object('withdrawn_at',notice->'withdrawn_at'); END IF;
  RETURN (SELECT jsonb_object_agg(key,value) FROM jsonb_each(body) WHERE key IN ('base_path','content_id','document_type','public_updated_at'))
   ||jsonb_build_object('withdrawn_notice',notice,'links',jsonb_build_object('primary_publishing_organisation',entries));
 END IF;
 RETURN regpilot_verification.original_register_metadata(part,body);
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.register_metadata(text,jsonb),regpilot_verification.original_register_metadata(text,jsonb),
 regpilot_verification.queue_public_registers() FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;

CREATE OR REPLACE FUNCTION regpilot_verification.finish_public_registers() RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE item record; projected jsonb; done integer:=0; response regpilot_staging_fetch.http_response;
BEGIN
 PERFORM set_config('http.curlopt_timeout_ms','18000',true);
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
