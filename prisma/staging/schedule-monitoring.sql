-- A private staging control. The scheduled query only samples database catalogues.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('regpilot-staging-posture-quarter-hour','*/15 * * * *','SELECT regpilot_verification.capture()');
