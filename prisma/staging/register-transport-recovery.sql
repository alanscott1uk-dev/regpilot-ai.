-- Preserve the failed attempt and retry only a transient transport failure in the latest batch.
CREATE OR REPLACE FUNCTION regpilot_verification.retry_public_register(source_name text) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prior uuid; next_batch uuid;
BEGIN
 IF NOT pg_try_advisory_xact_lock(74119351) THEN RETURN NULL; END IF;
 SELECT r.batch_id INTO prior FROM regpilot_verification.register_requests r JOIN regpilot_verification.register_batches b ON b.id=r.batch_id
  WHERE r.provider=source_name ORDER BY b.started_at DESC LIMIT 1;
 IF prior IS NULL OR EXISTS(SELECT 1 FROM regpilot_verification.register_requests WHERE batch_id=prior AND provider=source_name AND finished_at IS NULL)
 OR NOT EXISTS(SELECT 1 FROM regpilot_verification.register_requests WHERE batch_id=prior AND provider=source_name
  AND (http_status IS NULL OR http_status BETWEEN 500 AND 599) AND finished_at<=clock_timestamp()-interval '1 minute')
 OR (SELECT count(DISTINCT r.batch_id) FROM regpilot_verification.register_requests r JOIN regpilot_verification.register_batches b
  ON b.id=r.batch_id WHERE r.provider=source_name AND b.started_at>clock_timestamp()-interval '6 hours')>=4
 THEN RETURN NULL; END IF;
 INSERT INTO regpilot_verification.register_batches DEFAULT VALUES RETURNING id INTO next_batch;
 INSERT INTO regpilot_verification.register_requests(request_id,batch_id,provider,part,url)
 SELECT nextval('regpilot_verification.register_local_request'),next_batch,provider,part,url
 FROM regpilot_verification.register_requests WHERE batch_id=prior AND provider=source_name;
 RETURN next_batch;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.retry_public_register(text) FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;

CREATE OR REPLACE FUNCTION regpilot_verification.finish_public_registers() RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE item record; projected jsonb; done integer:=0; response regpilot_staging_fetch.http_response;
BEGIN

 FOR item IN SELECT request_id,part,url FROM regpilot_verification.register_requests
  WHERE finished_at IS NULL ORDER BY request_id LIMIT 4 FOR UPDATE SKIP LOCKED
 LOOP
  projected:=NULL;response:=NULL;
  BEGIN
   PERFORM regpilot_staging_fetch.http_set_curlopt('CURLOPT_TIMEOUT_MS',CASE WHEN item.part='publication' THEN '38000' ELSE '10000' END);
   SELECT * INTO response FROM regpilot_staging_fetch.http_get(item.url::varchar);
   IF response.status=200 AND lower(response.content_type) LIKE '%json%' AND octet_length(response.content)<=262144 THEN
    projected:=regpilot_verification.register_metadata(item.part,response.content::jsonb);
   END IF;
  EXCEPTION WHEN OTHERS THEN projected:=NULL; END;
  UPDATE regpilot_verification.register_requests SET finished_at=clock_timestamp(),http_status=response.status,metadata=projected,
   fingerprint=encode(sha256(convert_to(projected::text,'UTF8')),'hex') WHERE request_id=item.request_id;
  done:=done+1;
 END LOOP;
 PERFORM regpilot_staging_fetch.http_reset_curlopt();
 RETURN done;
END $$;
