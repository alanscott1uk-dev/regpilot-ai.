-- Controlled document effectivity and attributable fresh-authentication attestations.
BEGIN;

ALTER TABLE "Policy" ADD COLUMN "controlledEffectivity" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TrainingAssignment" ADD COLUMN "releaseId" UUID;

CREATE TABLE "PolicyRelease" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "preparedById" UUID NOT NULL,
    "createKey" UUID NOT NULL,
    "state" VARCHAR(24) NOT NULL DEFAULT 'PREPARED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "plannedEffectiveAt" TIMESTAMP(3) NOT NULL,
    "trainingMode" VARCHAR(24) NOT NULL,
    "changeReason" VARCHAR(1600) NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" VARCHAR(64) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "activationProvenance" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancellation" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "lastBlockers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRelease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentSignatureChallenge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "releaseVersion" INTEGER NOT NULL,
    "releaseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "targetHash" VARCHAR(64) NOT NULL,
    "meaning" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(1600) NOT NULL,
    "baselineSessionHash" VARCHAR(64) NOT NULL,
    "baselineAuthenticatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSignatureChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentAttestation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "meaning" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(1600) NOT NULL,
    "signerEmail" VARCHAR(254) NOT NULL,
    "externalSubject" UUID NOT NULL,
    "authMethod" VARCHAR(40) NOT NULL,
    "authenticatedAt" TIMESTAMP(3) NOT NULL,
    "sessionHash" VARCHAR(64) NOT NULL,
    "targetHash" VARCHAR(64) NOT NULL,
    "contentSha256" VARCHAR(64) NOT NULL,
    "record" JSONB NOT NULL,
    "recordHash" VARCHAR(64) NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttestation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyEffectivityOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyEffectivityOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyRelease_organizationId_policyId_state_idx" ON "PolicyRelease"("organizationId", "policyId", "state");

CREATE INDEX "PolicyRelease_state_plannedEffectiveAt_id_idx" ON "PolicyRelease"("state", "plannedEffectiveAt", "id");

CREATE UNIQUE INDEX "PolicyRelease_id_organizationId_key" ON "PolicyRelease"("id", "organizationId");

CREATE UNIQUE INDEX "PolicyRelease_organizationId_createKey_key" ON "PolicyRelease"("organizationId", "createKey");

CREATE INDEX "DocumentSignatureChallenge_organizationId_actorId_releaseId_idx" ON "DocumentSignatureChallenge"("organizationId", "actorId", "releaseId", "expiresAt");

CREATE UNIQUE INDEX "DocumentSignatureChallenge_id_organizationId_key" ON "DocumentSignatureChallenge"("id", "organizationId");

CREATE UNIQUE INDEX "DocumentSignatureChallenge_organizationId_requestKey_key" ON "DocumentSignatureChallenge"("organizationId", "requestKey");

CREATE UNIQUE INDEX "DocumentAttestation_releaseId_key" ON "DocumentAttestation"("releaseId");

CREATE UNIQUE INDEX "DocumentAttestation_challengeId_key" ON "DocumentAttestation"("challengeId");

CREATE INDEX "DocumentAttestation_organizationId_revisionId_signedAt_idx" ON "DocumentAttestation"("organizationId", "revisionId", "signedAt");

CREATE UNIQUE INDEX "DocumentAttestation_id_organizationId_key" ON "DocumentAttestation"("id", "organizationId");

CREATE UNIQUE INDEX "DocumentAttestation_releaseId_organizationId_key" ON "DocumentAttestation"("releaseId", "organizationId");

CREATE UNIQUE INDEX "DocumentAttestation_challengeId_organizationId_key" ON "DocumentAttestation"("challengeId", "organizationId");

CREATE INDEX "PolicyEffectivityOperation_organizationId_releaseId_created_idx" ON "PolicyEffectivityOperation"("organizationId", "releaseId", "createdAt");

CREATE UNIQUE INDEX "PolicyEffectivityOperation_organizationId_requestKey_key" ON "PolicyEffectivityOperation"("organizationId", "requestKey");

ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_policyId_organizationId_fkey" FOREIGN KEY ("policyId", "organizationId") REFERENCES "Policy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentSignatureChallenge" ADD CONSTRAINT "DocumentSignatureChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentSignatureChallenge" ADD CONSTRAINT "DocumentSignatureChallenge_releaseId_organizationId_fkey" FOREIGN KEY ("releaseId", "organizationId") REFERENCES "PolicyRelease"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentSignatureChallenge" ADD CONSTRAINT "DocumentSignatureChallenge_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_releaseId_organizationId_fkey" FOREIGN KEY ("releaseId", "organizationId") REFERENCES "PolicyRelease"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_challengeId_organizationId_fkey" FOREIGN KEY ("challengeId", "organizationId") REFERENCES "DocumentSignatureChallenge"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyEffectivityOperation" ADD CONSTRAINT "PolicyEffectivityOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyEffectivityOperation" ADD CONSTRAINT "PolicyEffectivityOperation_releaseId_organizationId_fkey" FOREIGN KEY ("releaseId", "organizationId") REFERENCES "PolicyRelease"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyEffectivityOperation" ADD CONSTRAINT "PolicyEffectivityOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "TrainingAssignment_organizationId_releaseId_idx" ON "TrainingAssignment"("organizationId","releaseId");
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_releaseId_organizationId_fkey" FOREIGN KEY ("releaseId","organizationId") REFERENCES "PolicyRelease"("id","organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_state_check" CHECK ("state" IN ('PREPARED','SCHEDULED','EFFECTIVE','CANCELLED'));
ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_version_check" CHECK ("version">0);
ALTER TABLE "PolicyRelease" ADD CONSTRAINT "PolicyRelease_training_mode_check" CHECK ("trainingMode" IN ('NONE','READ_AND_ACKNOWLEDGE','COMPETENCE'));
ALTER TABLE "DocumentSignatureChallenge" ADD CONSTRAINT "DocumentSignatureChallenge_bounds_check" CHECK ("releaseVersion">0 AND "expiresAt">"createdAt");
ALTER TABLE "DocumentSignatureChallenge" ADD CONSTRAINT "DocumentSignatureChallenge_meaning_check" CHECK ("meaning"='AUTHORISE_SCHEDULED_RELEASE');
ALTER TABLE "DocumentAttestation" ADD CONSTRAINT "DocumentAttestation_meaning_auth_check" CHECK ("meaning"='AUTHORISE_SCHEDULED_RELEASE' AND "authMethod" IN ('otp','magiclink'));
ALTER TABLE "PolicyEffectivityOperation" ADD CONSTRAINT "PolicyEffectivityOperation_action_check" CHECK ("action" IN ('PREPARE','CHALLENGE','SIGN','CHECK','CANCEL'));

-- Immutable attestation guard. Deletion remains governed by retention/organisation administration.
CREATE OR REPLACE FUNCTION regpilot_document_attestation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Document authorisations are immutable; record a new release or cancellation instead' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER document_attestation_immutable BEFORE UPDATE ON "DocumentAttestation" FOR EACH ROW EXECUTE FUNCTION regpilot_document_attestation_immutable();
-- End immutable attestation guard.

DO $private$
DECLARE name text; role_name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['PolicyRelease','DocumentSignatureChallenge','DocumentAttestation','PolicyEffectivityOperation'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC',name);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',name,role_name);
   END IF;
  END LOOP;
 END LOOP;
END
$private$;
COMMIT;
