-- Install on the isolated RegPilot staging project only.
CREATE SCHEMA IF NOT EXISTS regpilot_verification;
REVOKE ALL ON SCHEMA regpilot_verification FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS regpilot_verification.inventory (
  name text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS regpilot_verification.samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot timestamptz UNIQUE NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resources integer NOT NULL, tests integer NOT NULL, passed integer NOT NULL,
  details jsonb NOT NULL, fingerprint text NOT NULL
);
ALTER TABLE regpilot_verification.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE regpilot_verification.samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA regpilot_verification FROM PUBLIC, anon, authenticated, regpilot_staging_runtime;

INSERT INTO regpilot_verification.inventory(name) VALUES
('AccessCampaign'),
('AccessInventory'),
('AccessReviewItem'),
('AiDailyUsage'),
('AiReview'),
('AiSystem'),
('AiSystemDecision'),
('AssuranceAnswer'),
('AssuranceAssessment'),
('AssuranceQuestionnaire'),
('AuditEvent'),
('AuditGrant'),
('AuditQuestion'),
('AuditRequest'),
('AuditRoom'),
('AutomationEvent'),
('BillingAccount'),
('BillingEvent'),
('BusinessProfile'),
('ChangeAction'),
('ChangeResponse'),
('CompanyProduct'),
('ConnectorControlLink'),
('ConnectorRun'),
('ControlLink'),
('CoverageDecision'),
('CoverageRun'),
('CustomerApiBudget'),
('CustomerApiControlGrant'),
('CustomerApiCredential'),
('CustomerApiObservation'),
('CustomerApiOperation'),
('DispatchLane'),
('DocumentAttestation'),
('DocumentSignatureChallenge'),
('EvaluationAnswerReview'),
('EvaluationCase'),
('EvaluationOperation'),
('EvaluationRun'),
('Evidence'),
('EvidenceApplicability'),
('EvidenceConnector'),
('EvidenceProductLink'),
('HorizonWatchlist'),
('IntegrationAttempt'),
('IntegrationBudget'),
('IntegrationDelivery'),
('IntegrationEndpoint'),
('IntegrationEndpointControl'),
('IntegrationEvent'),
('IntegrationOperation'),
('IntelligenceDecision'),
('IntelligenceRun'),
('KnowledgeChunk'),
('KnowledgeIndexRun'),
('KnowledgeSearchRun'),
('LibraryApplicability'),
('LibraryRequirement'),
('LibraryRevision'),
('ManagedControl'),
('Membership'),
('Obligation'),
('OcrReview'),
('OcrRun'),
('Organization'),
('PaidBudget'),
('PaidReservation'),
('Policy'),
('PolicyAssignment'),
('PolicyEffectivityOperation'),
('PolicyRelease'),
('PolicyRevision'),
('ProgrammeImport'),
('ProviderGate'),
('ProviderPermit'),
('PublicSourceFetch'),
('QualityAction'),
('QualityCase'),
('QualityEffectiveness'),
('QualityOperation'),
('QuestionnaireDraftRun'),
('RegisteredSource'),
('RegulatorySnapshot'),
('RiskControl'),
('RiskLossScenario'),
('RiskRecord'),
('RiskReview'),
('RiskTreatment'),
('SemanticRequest'),
('ServiceJob'),
('TrainingAssignment'),
('TrainingAttempt'),
('TrainingCurriculum'),
('TrainingEnrollment'),
('TrainingOperation'),
('TrainingRequirement'),
('User'),
('Vendor'),
('VendorReview'),
('WatchSchedule'),
('WebhookReceipt'),
('WorkerRun'),
('WorkspaceInvitation')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION regpilot_verification.capture() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  checks jsonb;
  n integer;
  ok integer;
  receipt uuid;
  bucket timestamptz := date_bin('5 minutes',clock_timestamp(),'2001-01-01'::timestamptz);
BEGIN
  WITH actual AS (
    SELECT i.name, c.oid, c.relrowsecurity
    FROM regpilot_verification.inventory i
    LEFT JOIN pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=i.name AND c.relkind IN ('r','p')
  ), observed AS (
    SELECT name, jsonb_build_object(
      'present', oid IS NOT NULL,
      'rls',coalesce(relrowsecurity,false),
      'anonymous_isolated',coalesce(NOT has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AND NOT has_any_column_privilege('anon',oid,'SELECT,INSERT,UPDATE,REFERENCES'),false),
      'authenticated_isolated',coalesce(NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') AND NOT has_any_column_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,REFERENCES'),false),
      'runtime_access',coalesce(has_table_privilege('regpilot_staging_runtime',oid,'SELECT') AND has_table_privilege('regpilot_staging_runtime',oid,'INSERT') AND has_table_privilege('regpilot_staging_runtime',oid,'UPDATE') AND has_table_privilege('regpilot_staging_runtime',oid,'DELETE'),false)
    ) AS flags FROM actual
  ) SELECT jsonb_object_agg(name,flags),count(*) INTO checks,n FROM observed;
  IF n=0 THEN RAISE EXCEPTION 'Staging inventory is empty'; END IF;
  SELECT count(*) INTO ok FROM jsonb_each(checks) r CROSS JOIN LATERAL jsonb_each_text(r.value) t WHERE t.value='true';
  INSERT INTO regpilot_verification.samples(slot,resources,tests,passed,details,fingerprint)
  VALUES(bucket,n,n*5,ok,checks,encode(sha256(convert_to(checks::text,'UTF8')),'hex'))
  ON CONFLICT (slot) DO NOTHING RETURNING id INTO receipt;
  IF receipt IS NULL THEN SELECT id INTO receipt FROM regpilot_verification.samples WHERE slot=bucket; END IF;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION regpilot_verification.capture() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE VIEW regpilot_verification.history AS SELECT id,collected_at,resources,tests,passed,fingerprint FROM regpilot_verification.samples;
REVOKE ALL ON regpilot_verification.history FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA regpilot_verification TO regpilot_staging_runtime;
GRANT SELECT ON regpilot_verification.history TO regpilot_staging_runtime;
GRANT EXECUTE ON FUNCTION regpilot_verification.capture() TO regpilot_staging_runtime;
