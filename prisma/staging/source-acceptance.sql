-- Evidence from completed repository acceptance jobs against disposable databases.
CREATE TABLE regpilot_verification.source_acceptance (
 job bigint PRIMARY KEY CHECK(job>0), run bigint NOT NULL CHECK(run>0),
 commit_sha text NOT NULL CHECK(commit_sha ~ '^[a-f0-9]{40}$'),
 definition_id uuid NOT NULL REFERENCES regpilot_verification.source_registry(id),
 version text NOT NULL, digest text NOT NULL CHECK(digest ~ '^sha256:[0-9a-f]{64}$'),
 completed_at timestamptz NOT NULL, before_matched int NOT NULL CHECK(before_matched>=0),
 before_different int NOT NULL CHECK(before_different>0),
 after_matched int NOT NULL CHECK(after_matched=before_matched+before_different)
);
ALTER TABLE regpilot_verification.source_acceptance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON regpilot_verification.source_acceptance FROM PUBLIC,anon,authenticated,regpilot_staging_runtime;
CREATE VIEW regpilot_verification.tested_database_sources AS
 SELECT DISTINCT ON (p.id) p.id,p.name,p.version,p.artifact_digest AS digest,
  a.run::text AS run,a.job::text AS job,a.commit_sha,a.completed_at,a.before_matched,a.before_different,a.after_matched
 FROM regpilot_verification.source_collection_plans p
 JOIN regpilot_verification.source_acceptance a ON (p.id,p.version,p.artifact_digest)=(a.definition_id,a.version,a.digest)
 WHERE p.artifact_verified AND p.kind='database'
 ORDER BY p.id,a.completed_at DESC,a.job DESC;
REVOKE ALL ON regpilot_verification.tested_database_sources FROM PUBLIC,anon,authenticated;
GRANT SELECT ON regpilot_verification.tested_database_sources TO regpilot_staging_runtime;
