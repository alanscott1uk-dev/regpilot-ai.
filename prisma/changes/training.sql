-- Role curricula, revision-aware training and distinct independent competence records.
BEGIN;

CREATE TABLE "TrainingCurriculum" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createKey" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "businessRole" VARCHAR(100) NOT NULL,
    "description" VARCHAR(1600) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCurriculum_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingRequirement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "curriculumId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "preparedRevisionId" UUID NOT NULL,
    "objective" VARCHAR(1600) NOT NULL,
    "criteria" JSONB NOT NULL,
    "quiz" JSONB NOT NULL,
    "passPercent" INTEGER NOT NULL DEFAULT 80,
    "dueDays" INTEGER NOT NULL DEFAULT 14,
    "validDays" INTEGER NOT NULL DEFAULT 365,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingEnrollment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "curriculumId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "enrolledById" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "curriculumId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "enrollmentId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "requirementVersion" INTEGER NOT NULL,
    "enrollmentVersion" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    "dueAt" DATE NOT NULL,
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedHash" VARCHAR(64),
    "validUntil" DATE,
    "requirementSnapshot" JSONB NOT NULL,
    "requirementHash" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAttempt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "learnerId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "observedAt" DATE NOT NULL,
    "statement" VARCHAR(2000) NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "quizAnswers" JSONB NOT NULL,
    "quizScore" INTEGER,
    "quizPassed" BOOLEAN,
    "context" JSONB NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "submissionHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "criterionResults" JSONB NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "decisionHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "curriculumId" UUID NOT NULL,
    "assignmentId" UUID,
    "actorId" UUID NOT NULL,
    "requestKey" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainingCurriculum_organizationId_active_createdAt_idx" ON "TrainingCurriculum"("organizationId", "active", "createdAt");

CREATE UNIQUE INDEX "TrainingCurriculum_id_organizationId_key" ON "TrainingCurriculum"("id", "organizationId");

CREATE UNIQUE INDEX "TrainingCurriculum_organizationId_createKey_key" ON "TrainingCurriculum"("organizationId", "createKey");

CREATE INDEX "TrainingRequirement_organizationId_policyId_active_idx" ON "TrainingRequirement"("organizationId", "policyId", "active");

CREATE UNIQUE INDEX "TrainingRequirement_id_organizationId_key" ON "TrainingRequirement"("id", "organizationId");

CREATE UNIQUE INDEX "TrainingRequirement_curriculumId_policyId_key" ON "TrainingRequirement"("curriculumId", "policyId");

CREATE INDEX "TrainingEnrollment_organizationId_userId_active_idx" ON "TrainingEnrollment"("organizationId", "userId", "active");

CREATE UNIQUE INDEX "TrainingEnrollment_id_organizationId_key" ON "TrainingEnrollment"("id", "organizationId");

CREATE UNIQUE INDEX "TrainingEnrollment_curriculumId_userId_key" ON "TrainingEnrollment"("curriculumId", "userId");

CREATE INDEX "TrainingAssignment_organizationId_learnerId_status_dueAt_idx" ON "TrainingAssignment"("organizationId", "learnerId", "status", "dueAt");

CREATE INDEX "TrainingAssignment_organizationId_curriculumId_createdAt_idx" ON "TrainingAssignment"("organizationId", "curriculumId", "createdAt");

CREATE UNIQUE INDEX "TrainingAssignment_id_organizationId_key" ON "TrainingAssignment"("id", "organizationId");

CREATE UNIQUE INDEX "TrainingAssignment_identity_key" ON "TrainingAssignment"("enrollmentId", "requirementId", "revisionId", "requirementVersion", "enrollmentVersion", "cycle");

CREATE INDEX "TrainingAttempt_organizationId_assignmentId_createdAt_idx" ON "TrainingAttempt"("organizationId", "assignmentId", "createdAt");

CREATE UNIQUE INDEX "TrainingAttempt_assignmentId_requestKey_key" ON "TrainingAttempt"("assignmentId", "requestKey");

CREATE INDEX "TrainingOperation_organizationId_curriculumId_createdAt_idx" ON "TrainingOperation"("organizationId", "curriculumId", "createdAt");

CREATE UNIQUE INDEX "TrainingOperation_organizationId_requestKey_key" ON "TrainingOperation"("organizationId", "requestKey");

ALTER TABLE "TrainingCurriculum" ADD CONSTRAINT "TrainingCurriculum_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingCurriculum" ADD CONSTRAINT "TrainingCurriculum_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingCurriculum" ADD CONSTRAINT "TrainingCurriculum_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_curriculumId_organizationId_fkey" FOREIGN KEY ("curriculumId", "organizationId") REFERENCES "TrainingCurriculum"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_policyId_organizationId_fkey" FOREIGN KEY ("policyId", "organizationId") REFERENCES "Policy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_preparedRevisionId_organizationId_fkey" FOREIGN KEY ("preparedRevisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_curriculumId_organizationId_fkey" FOREIGN KEY ("curriculumId", "organizationId") REFERENCES "TrainingCurriculum"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_enrolledById_fkey" FOREIGN KEY ("enrolledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_curriculumId_organizationId_fkey" FOREIGN KEY ("curriculumId", "organizationId") REFERENCES "TrainingCurriculum"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_requirementId_organizationId_fkey" FOREIGN KEY ("requirementId", "organizationId") REFERENCES "TrainingRequirement"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_enrollmentId_organizationId_fkey" FOREIGN KEY ("enrollmentId", "organizationId") REFERENCES "TrainingEnrollment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_assignmentId_organizationId_fkey" FOREIGN KEY ("assignmentId", "organizationId") REFERENCES "TrainingAssignment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingOperation" ADD CONSTRAINT "TrainingOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingOperation" ADD CONSTRAINT "TrainingOperation_curriculumId_organizationId_fkey" FOREIGN KEY ("curriculumId", "organizationId") REFERENCES "TrainingCurriculum"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingOperation" ADD CONSTRAINT "TrainingOperation_assignmentId_organizationId_fkey" FOREIGN KEY ("assignmentId", "organizationId") REFERENCES "TrainingAssignment"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingOperation" ADD CONSTRAINT "TrainingOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TrainingCurriculum" ADD CONSTRAINT "TrainingCurriculum_version_check" CHECK ("version">0);
ALTER TABLE "TrainingRequirement" ADD CONSTRAINT "TrainingRequirement_bounds_check" CHECK ("version">0 AND "dueDays" BETWEEN 1 AND 90 AND "validDays" BETWEEN 1 AND 730 AND "passPercent" BETWEEN 50 AND 100);
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_version_check" CHECK ("version">0);
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_status_check" CHECK ("status" IN ('ASSIGNED','SUBMITTED','PASSED','RETRAIN','SUPERSEDED','REVOKED'));
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_version_check" CHECK ("version">0 AND "requirementVersion">0 AND "enrollmentVersion">0 AND "cycle" BETWEEN 1 AND 50);
ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_status_check" CHECK ("status" IN ('PENDING','PASSED','RETRAIN','QUIZ_FAILED','SUPERSEDED'));
ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_bounds_check" CHECK ("version">0 AND ("quizScore" IS NULL OR "quizScore" BETWEEN 0 AND 100));
ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_independent_check" CHECK ("reviewerId" IS NULL OR "reviewerId"<>"learnerId");
ALTER TABLE "TrainingOperation" ADD CONSTRAINT "TrainingOperation_action_check" CHECK ("action" IN ('CREATE','REQUIREMENT','ENROL','REFRESH','SET_ACTIVE','ACKNOWLEDGE','SUBMIT','DECIDE'));
DO $private$
DECLARE name text; role_name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['TrainingCurriculum','TrainingRequirement','TrainingEnrollment','TrainingAssignment','TrainingAttempt','TrainingOperation'] LOOP
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
