-- Apply after worker-clock.sql on RegPilot staging. Reuse the installed signing key.
CREATE OR REPLACE FUNCTION regpilot_verification.invoke_worker_clock() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE bucket bigint := floor(extract(epoch FROM clock_timestamp())/300)::bigint;
        status_code integer;
BEGIN
 -- Skip empty queue ticks in the database. The previously authorised pilot keeps minutes 07 and 37.
 IF mod(bucket,6)<>1 AND NOT EXISTS (
   SELECT 1 FROM public."EvidenceConnector" WHERE provider='PIPEDREAM_READ' AND enabled
     AND "intervalHours"=1 AND "nextRunAt"<=statement_timestamp()
     AND ("leaseUntil" IS NULL OR "leaseUntil"<=statement_timestamp())
 ) THEN RETURN 204; END IF;
 PERFORM regpilot_staging_fetch.http_set_curlopt('CURLOPT_TIMEOUT_MS','120000');
 SELECT status INTO status_code FROM regpilot_staging_fetch.http((
   'POST','https://regpilot-ai-qnx6-git-feature-traceabil-2f0b3f-alanscott1uk-5933.vercel.app/api/internal/staging-worker',
   ARRAY[regpilot_staging_fetch.http_header('Authorization','Bearer ' || bucket || '.' || regpilot_verification.worker_clock_token(bucket))],
   'application/json','{}')::regpilot_staging_fetch.http_request);
 PERFORM regpilot_staging_fetch.http_reset_curlopt();
 IF status_code NOT IN (200,409) THEN RAISE EXCEPTION 'Staging worker returned HTTP %',status_code; END IF;
 RETURN status_code;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.invoke_worker_clock() FROM PUBLIC,anon,authenticated,service_role,regpilot_staging_runtime;
SELECT cron.schedule('regpilot-staging-worker-clock','2-59/5 * * * *','SELECT regpilot_verification.invoke_worker_clock()');
