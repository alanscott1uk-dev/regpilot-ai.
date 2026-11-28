-- Install only on RegPilot staging. The signing key stays inside its private database.
CREATE TABLE regpilot_verification.worker_clock_key (
  singleton boolean PRIMARY KEY CHECK (singleton), secret bytea NOT NULL
);
ALTER TABLE regpilot_verification.worker_clock_key ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON regpilot_verification.worker_clock_key FROM PUBLIC,anon,authenticated,service_role,regpilot_staging_runtime;
INSERT INTO regpilot_verification.worker_clock_key VALUES (true,extensions.gen_random_bytes(32));

CREATE FUNCTION regpilot_verification.worker_clock_token(bucket bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT encode(extensions.hmac(convert_to('regpilot-staging-worker/' || bucket,'UTF8'),secret,'sha256'),'hex')
  FROM regpilot_verification.worker_clock_key WHERE singleton
$$;
REVOKE ALL ON FUNCTION regpilot_verification.worker_clock_token(bigint) FROM PUBLIC,anon,authenticated,service_role,regpilot_staging_runtime;

CREATE FUNCTION regpilot_verification.verify_worker_clock(bucket bigint, signature text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT bucket = floor(extract(epoch FROM statement_timestamp())/300)::bigint
    AND sha256(convert_to(signature,'UTF8')) = sha256(convert_to(regpilot_verification.worker_clock_token(bucket),'UTF8'))
$$;
REVOKE ALL ON FUNCTION regpilot_verification.verify_worker_clock(bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION regpilot_verification.verify_worker_clock(bigint,text) TO regpilot_staging_runtime;

CREATE FUNCTION regpilot_verification.invoke_worker_clock() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
SET http.curlopt_timeout_ms='125000' SET http.curlopt_connecttimeout_ms='6000' SET http.curlopt_followlocation='0' AS $$
DECLARE bucket bigint := floor(extract(epoch FROM clock_timestamp())/300)::bigint;
        status_code integer;
BEGIN
 SELECT status INTO status_code FROM regpilot_staging_fetch.http((
   'POST','https://regpilot-ai-qnx6-git-feature-traceabil-2f0b3f-alanscott1uk-5933.vercel.app/api/internal/staging-worker',
   ARRAY[regpilot_staging_fetch.http_header('Authorization','Bearer ' || bucket || '.' || regpilot_verification.worker_clock_token(bucket))],
   'application/json','{}')::regpilot_staging_fetch.http_request);
 IF status_code NOT IN (200,409) THEN RAISE EXCEPTION 'Staging worker returned HTTP %',status_code; END IF;
 RETURN status_code;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.invoke_worker_clock() FROM PUBLIC,anon,authenticated,service_role,regpilot_staging_runtime;
SELECT cron.schedule('regpilot-staging-worker-clock','7,37 * * * *','SELECT regpilot_verification.invoke_worker_clock()');
