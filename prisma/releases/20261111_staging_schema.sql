-- New app tables only. Preserve existing lowercase prototype tables.
BEGIN;
SET LOCAL search_path = public;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETE');

-- CreateEnum
CREATE TYPE "AiReviewState" AS ENUM ('PENDING_REVIEW', 'REVIEWED', 'NEEDS_CHANGES', 'REDACTED');

-- CreateEnum
CREATE TYPE "SourceReviewState" AS ENUM ('NEEDS_REVIEW', 'REVIEWED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('CLEAN', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceBytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaidBudget" (
    "organizationId" UUID NOT NULL,
    "monthlyLimitMicros" INTEGER NOT NULL,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "configuredById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaidBudget_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "PaidReservation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" VARCHAR(140) NOT NULL,
    "service" VARCHAR(24) NOT NULL,
    "units" INTEGER NOT NULL,
    "reservedMicros" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaidReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "targetId" UUID,
    "sourceHash" VARCHAR(64),
    "dedupeKey" VARCHAR(180) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "units" INTEGER NOT NULL DEFAULT 1,
    "recipientId" UUID,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "failureCode" VARCHAR(48),
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "providerId" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "organizationId" UUID NOT NULL,
    "customerId" VARCHAR(120) NOT NULL,
    "subscriptionId" VARCHAR(120),
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "lastEventAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" VARCHAR(120) NOT NULL,
    "organizationId" UUID NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "invitedById" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'VIEWER',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "vendorSignalId" UUID,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "ObligationStatus" NOT NULL DEFAULT 'OPEN',
    "completionException" BOOLEAN NOT NULL DEFAULT false,
    "completionRationale" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT,
    "sourceCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "originKey" VARCHAR(64),
    "automationKey" VARCHAR(64),
    "assigneeId" UUID,
    "controlId" UUID,
    "connectorId" UUID,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3),
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'QUARANTINED',
    "uploadedById" UUID,
    "reviewerId" UUID,
    "reviewerNotes" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "reviewVersion" INTEGER NOT NULL DEFAULT 1,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDailyUsage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReview" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "result" JSONB NOT NULL,
    "resultSha256" VARCHAR(64) NOT NULL,
    "status" "AiReviewState" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewerId" UUID,
    "reviewerNotes" TEXT NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatorySnapshot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "bodyText" TEXT NOT NULL,
    "revisionAt" VARCHAR(100),
    "addedSnippets" JSONB NOT NULL DEFAULT '[]',
    "removedSnippets" JSONB NOT NULL DEFAULT '[]',
    "reviewStatus" "SourceReviewState" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewNotes" TEXT NOT NULL DEFAULT '',
    "reviewerId" UUID,
    "capturedById" UUID NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "firstCapturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "facts" JSONB NOT NULL DEFAULT '{}',
    "organizationId" UUID NOT NULL,
    "activities" JSONB NOT NULL,
    "jurisdictions" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "IntelligenceRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "candidateKey" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "rationale" VARCHAR(800) NOT NULL,
    "reviewerId" UUID NOT NULL,
    "obligationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "configuredById" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastOutcome" VARCHAR(40),
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticRequest" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "modelId" VARCHAR(160) NOT NULL,
    "createdById" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'RUNNING',
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SemanticRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceAssessment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "engineVersion" VARCHAR(80) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "failureCode" VARCHAR(40),
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "selectedPassages" JSONB NOT NULL DEFAULT '[]',
    "reviewedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammeImport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "inputHash" VARCHAR(64) NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'PROCESSING',
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ProgrammeImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedControl" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "proposalKey" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1600) NOT NULL,
    "testProcedure" VARCHAR(1600) NOT NULL,
    "theme" VARCHAR(40) NOT NULL,
    "ownerId" UUID NOT NULL,
    "scheduledById" UUID NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "nextReviewAt" DATE NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "obligationId" UUID NOT NULL,
    "mappedById" UUID NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceConnector" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "configuredById" UUID NOT NULL,
    "provider" VARCHAR(24) NOT NULL DEFAULT 'GITHUB',
    "repository" VARCHAR(220) NOT NULL,
    "branch" VARCHAR(120) NOT NULL,
    "encryptedSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "intervalHours" INTEGER NOT NULL DEFAULT 24,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCode" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceConnector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "leaseToken" UUID NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "resultHash" VARCHAR(64) NOT NULL,
    "signalHash" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisteredSource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "path" VARCHAR(450) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "documentType" VARCHAR(120) NOT NULL,
    "registeredById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisteredSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRequirement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "collection" VARCHAR(100) NOT NULL,
    "reference" VARCHAR(100) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "provenance" JSONB NOT NULL,
    "provenanceHash" VARCHAR(64) NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LibraryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryApplicability" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "contextHash" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(30) NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "ownerId" UUID,
    "reviewerId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryApplicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    "context" JSONB NOT NULL,
    "result" JSONB,
    "resultHash" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageDecision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "revisionId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" VARCHAR(20) NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoverageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoom" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "purpose" VARCHAR(1200) NOT NULL,
    "manifest" JSONB NOT NULL,
    "manifestHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditGrant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "userId" UUID,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditQuestion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "evidenceId" UUID,
    "question" VARCHAR(2000) NOT NULL,
    "response" VARCHAR(4000) NOT NULL DEFAULT '',
    "responses" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "answeredById" UUID,
    "answeredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "summary" VARCHAR(1200) NOT NULL,
    "file" JSONB NOT NULL,
    "fileHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1200) NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedHash" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "signalConnectorId" UUID,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "service" VARCHAR(1200) NOT NULL,
    "ownerId" UUID NOT NULL,
    "criticality" VARCHAR(12) NOT NULL,
    "dataAccess" VARCHAR(12) NOT NULL,
    "systemAccess" BOOLEAN NOT NULL DEFAULT false,
    "nextReviewAt" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorReview" (
    "signalSnapshot" JSONB,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "vendorId" UUID NOT NULL,
    "vendorVersion" INTEGER NOT NULL,
    "baselineReviewId" UUID,
    "vendorSnapshot" JSONB NOT NULL,
    "evidenceManifest" JSONB NOT NULL,
    "assessment" JSONB NOT NULL,
    "inputHash" VARCHAR(64) NOT NULL,
    "recommendation" VARCHAR(16) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "followUpDue" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(2000) NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "followUpTasks" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRequest" (
    "samplingPlan" JSONB,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "controlSnapshot" JSONB NOT NULL,
    "controlHash" VARCHAR(64) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instructions" VARCHAR(1600) NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "submission" JSONB,
    "submissionHash" VARCHAR(64),
    "submittedById" UUID,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "AuditRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeResponse" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolution" JSONB,
    "resolutionHash" VARCHAR(64),
    "closedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ChangeResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeAction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "responseId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "requirements" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    "submission" JSONB,
    "submissionHash" VARCHAR(64),
    "submittedById" UUID,
    "reviewerId" UUID,
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessInventory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "system" VARCHAR(120) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "records" JSONB NOT NULL,
    "recordsHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCampaign" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "inventoryId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "closedById" UUID,
    "title" VARCHAR(160) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "closure" JSONB,
    "closureHash" VARCHAR(64),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "taskId" UUID,
    "submittedById" UUID,
    "verifiedById" UUID,
    "entry" JSONB NOT NULL,
    "entryHash" VARCHAR(64) NOT NULL,
    "decision" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "stage" VARCHAR(16) NOT NULL DEFAULT 'DECIDE',
    "targetPermission" VARCHAR(160),
    "rationale" VARCHAR(1600) NOT NULL DEFAULT '',
    "proof" JSONB,
    "proofHash" VARCHAR(64),
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceAnswer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "question" VARCHAR(1200) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "answer" VARCHAR(6000) NOT NULL,
    "files" JSONB NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "reviewedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssuranceQuestionnaire" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewerId" UUID,
    "title" VARCHAR(160) NOT NULL,
    "recipient" VARCHAR(160) NOT NULL,
    "scope" VARCHAR(120) NOT NULL,
    "questions" JSONB NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedSnapshot" JSONB,
    "approvedHash" VARCHAR(64),
    "approvedAt" TIMESTAMP(3),
    "reviewNotes" VARCHAR(1600) NOT NULL DEFAULT '',
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssuranceQuestionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PaidReservation_month_organizationId_idx" ON "PaidReservation"("month", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaidReservation_organizationId_requestKey_key" ON "PaidReservation"("organizationId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_providerId_key" ON "ServiceJob"("providerId");

-- CreateIndex
CREATE INDEX "ServiceJob_status_createdAt_idx" ON "ServiceJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceJob_organizationId_createdAt_idx" ON "ServiceJob"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_organizationId_dedupeKey_key" ON "ServiceJob"("organizationId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_customerId_key" ON "BillingAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_subscriptionId_key" ON "BillingAccount"("subscriptionId");

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_createdAt_idx" ON "BillingEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_organizationId_status_expiresAt_idx" ON "WorkspaceInvitation"("organizationId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "WorkspaceInvitation_email_status_expiresAt_idx" ON "WorkspaceInvitation"("email", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_vendorSignalId_status_idx" ON "Obligation"("organizationId", "vendorSignalId", "status");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_controlId_status_idx" ON "Obligation"("organizationId", "controlId", "status");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_connectorId_status_idx" ON "Obligation"("organizationId", "connectorId", "status");

-- CreateIndex
CREATE INDEX "Obligation_organizationId_status_dueDate_idx" ON "Obligation"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_id_organizationId_key" ON "Obligation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_organizationId_originKey_key" ON "Obligation"("organizationId", "originKey");

-- CreateIndex
CREATE UNIQUE INDEX "Obligation_organizationId_automationKey_key" ON "Obligation"("organizationId", "automationKey");

-- CreateIndex
CREATE INDEX "Evidence_organizationId_obligationId_idx" ON "Evidence"("organizationId", "obligationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDailyUsage_organizationId_day_idx" ON "AiDailyUsage"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AiDailyUsage_organizationId_userId_day_key" ON "AiDailyUsage"("organizationId", "userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AiReview_requestId_key" ON "AiReview"("requestId");

-- CreateIndex
CREATE INDEX "AiReview_organizationId_status_createdAt_idx" ON "AiReview"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AiReview_organizationId_createdAt_idx" ON "AiReview"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "RegulatorySnapshot_organizationId_sourceId_firstCapturedAt_idx" ON "RegulatorySnapshot"("organizationId", "sourceId", "firstCapturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatorySnapshot_id_organizationId_key" ON "RegulatorySnapshot"("id", "organizationId");

-- CreateIndex
CREATE INDEX "IntelligenceRun_organizationId_createdAt_idx" ON "IntelligenceRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceRun_id_organizationId_key" ON "IntelligenceRun"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceRun_organizationId_snapshotId_profileVersion_en_key" ON "IntelligenceRun"("organizationId", "snapshotId", "profileVersion", "engineVersion");

-- CreateIndex
CREATE INDEX "IntelligenceDecision_organizationId_createdAt_idx" ON "IntelligenceDecision"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelligenceDecision_runId_candidateKey_key" ON "IntelligenceDecision"("runId", "candidateKey");

-- CreateIndex
CREATE INDEX "WatchSchedule_enabled_nextCheckAt_idx" ON "WatchSchedule"("enabled", "nextCheckAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchSchedule_organizationId_sourceId_key" ON "WatchSchedule"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "SemanticRequest_organizationId_createdAt_idx" ON "SemanticRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticRequest_organizationId_snapshotId_profileVersion_en_key" ON "SemanticRequest"("organizationId", "snapshotId", "profileVersion", "engineVersion");

-- CreateIndex
CREATE INDEX "AssuranceAssessment_organizationId_obligationId_createdAt_idx" ON "AssuranceAssessment"("organizationId", "obligationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceAssessment_organizationId_inputHash_method_key" ON "AssuranceAssessment"("organizationId", "inputHash", "method");

-- CreateIndex
CREATE INDEX "ProgrammeImport_organizationId_createdAt_idx" ON "ProgrammeImport"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeImport_id_organizationId_key" ON "ProgrammeImport"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeImport_organizationId_inputHash_method_key" ON "ProgrammeImport"("organizationId", "inputHash", "method");

-- CreateIndex
CREATE INDEX "ManagedControl_organizationId_enabled_nextReviewAt_idx" ON "ManagedControl"("organizationId", "enabled", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedControl_id_organizationId_key" ON "ManagedControl"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedControl_importId_proposalKey_key" ON "ManagedControl"("importId", "proposalKey");

-- CreateIndex
CREATE INDEX "ControlLink_organizationId_obligationId_idx" ON "ControlLink"("organizationId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlLink_controlId_obligationId_key" ON "ControlLink"("controlId", "obligationId");

-- CreateIndex
CREATE INDEX "EvidenceConnector_enabled_nextRunAt_idx" ON "EvidenceConnector"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConnector_id_organizationId_key" ON "EvidenceConnector"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceConnector_organizationId_repository_branch_key" ON "EvidenceConnector"("organizationId", "repository", "branch");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorRun_leaseToken_key" ON "ConnectorRun"("leaseToken");

-- CreateIndex
CREATE INDEX "ConnectorRun_organizationId_connectorId_capturedAt_idx" ON "ConnectorRun"("organizationId", "connectorId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredSource_organizationId_sourceId_key" ON "RegisteredSource"("organizationId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredSource_organizationId_path_key" ON "RegisteredSource"("organizationId", "path");

-- CreateIndex
CREATE INDEX "LibraryRequirement_organizationId_createdAt_id_idx" ON "LibraryRequirement"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRequirement_id_organizationId_key" ON "LibraryRequirement"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRequirement_organizationId_collection_reference_key" ON "LibraryRequirement"("organizationId", "collection", "reference");

-- CreateIndex
CREATE INDEX "LibraryRevision_organizationId_status_createdAt_idx" ON "LibraryRevision"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRevision_id_organizationId_key" ON "LibraryRevision"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRevision_requirementId_number_key" ON "LibraryRevision"("requirementId", "number");

-- CreateIndex
CREATE INDEX "LibraryApplicability_organizationId_profileVersion_idx" ON "LibraryApplicability"("organizationId", "profileVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryApplicability_revisionId_contextHash_key" ON "LibraryApplicability"("revisionId", "contextHash");

-- CreateIndex
CREATE INDEX "CoverageRun_organizationId_createdAt_idx" ON "CoverageRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRun_id_organizationId_key" ON "CoverageRun"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRun_organizationId_inputHash_method_key" ON "CoverageRun"("organizationId", "inputHash", "method");

-- CreateIndex
CREATE INDEX "CoverageDecision_organizationId_revisionId_controlId_create_idx" ON "CoverageDecision"("organizationId", "revisionId", "controlId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageDecision_runId_key_key" ON "CoverageDecision"("runId", "key");

-- CreateIndex
CREATE INDEX "AuditRoom_organizationId_createdAt_idx" ON "AuditRoom"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRoom_id_organizationId_key" ON "AuditRoom"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AuditGrant_email_status_expiresAt_idx" ON "AuditGrant"("email", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditGrant_roomId_email_key" ON "AuditGrant"("roomId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "AuditGrant_id_roomId_organizationId_key" ON "AuditGrant"("id", "roomId", "organizationId");

-- CreateIndex
CREATE INDEX "AuditQuestion_organizationId_roomId_createdAt_idx" ON "AuditQuestion"("organizationId", "roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Policy_organizationId_createdAt_idx" ON "Policy"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_id_organizationId_key" ON "Policy"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRevision_id_organizationId_key" ON "PolicyRevision"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRevision_policyId_number_key" ON "PolicyRevision"("policyId", "number");

-- CreateIndex
CREATE INDEX "PolicyAssignment_organizationId_userId_status_dueDate_idx" ON "PolicyAssignment"("organizationId", "userId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_revisionId_userId_key" ON "PolicyAssignment"("revisionId", "userId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_signalConnectorId_idx" ON "Vendor"("organizationId", "signalConnectorId");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_active_nextReviewAt_idx" ON "Vendor"("organizationId", "active", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_id_organizationId_key" ON "Vendor"("id", "organizationId");

-- CreateIndex
CREATE INDEX "VendorReview_organizationId_vendorId_createdAt_idx" ON "VendorReview"("organizationId", "vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorReview_id_organizationId_key" ON "VendorReview"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRequest_taskId_key" ON "AuditRequest"("taskId");

-- CreateIndex
CREATE INDEX "AuditRequest_organizationId_roomId_status_idx" ON "AuditRequest"("organizationId", "roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRequest_taskId_organizationId_key" ON "AuditRequest"("taskId", "organizationId");

-- CreateIndex
CREATE INDEX "ChangeResponse_organizationId_status_createdAt_idx" ON "ChangeResponse"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeResponse_id_organizationId_key" ON "ChangeResponse"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeResponse_organizationId_snapshotId_key" ON "ChangeResponse"("organizationId", "snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_taskId_key" ON "ChangeAction"("taskId");

-- CreateIndex
CREATE INDEX "ChangeAction_organizationId_responseId_status_idx" ON "ChangeAction"("organizationId", "responseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_responseId_controlId_key" ON "ChangeAction"("responseId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAction_taskId_organizationId_key" ON "ChangeAction"("taskId", "organizationId");

-- CreateIndex
CREATE INDEX "AccessInventory_organizationId_system_createdAt_idx" ON "AccessInventory"("organizationId", "system", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessInventory_id_organizationId_key" ON "AccessInventory"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AccessCampaign_organizationId_status_createdAt_idx" ON "AccessCampaign"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCampaign_id_organizationId_key" ON "AccessCampaign"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCampaign_organizationId_inventoryId_key" ON "AccessCampaign"("organizationId", "inventoryId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_taskId_key" ON "AccessReviewItem"("taskId");

-- CreateIndex
CREATE INDEX "AccessReviewItem_organizationId_reviewerId_stage_idx" ON "AccessReviewItem"("organizationId", "reviewerId", "stage");

-- CreateIndex
CREATE INDEX "AccessReviewItem_campaignId_stage_idx" ON "AccessReviewItem"("campaignId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_id_organizationId_key" ON "AccessReviewItem"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessReviewItem_taskId_organizationId_key" ON "AccessReviewItem"("taskId", "organizationId");

-- CreateIndex
CREATE INDEX "AssuranceAnswer_organizationId_status_scope_idx" ON "AssuranceAnswer"("organizationId", "status", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceAnswer_id_organizationId_key" ON "AssuranceAnswer"("id", "organizationId");

-- CreateIndex
CREATE INDEX "AssuranceQuestionnaire_organizationId_status_createdAt_idx" ON "AssuranceQuestionnaire"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssuranceQuestionnaire_id_organizationId_key" ON "AssuranceQuestionnaire"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "PaidBudget" ADD CONSTRAINT "PaidBudget_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidBudget" ADD CONSTRAINT "PaidBudget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReservation" ADD CONSTRAINT "PaidReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaidReservation" ADD CONSTRAINT "PaidReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceJob" ADD CONSTRAINT "ServiceJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingAccount" ADD CONSTRAINT "BillingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvitation" ADD CONSTRAINT "WorkspaceInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_vendorSignalId_organizationId_fkey" FOREIGN KEY ("vendorSignalId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDailyUsage" ADD CONSTRAINT "AiDailyUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDailyUsage" ADD CONSTRAINT "AiDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReview" ADD CONSTRAINT "AiReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReview" ADD CONSTRAINT "AiReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReview" ADD CONSTRAINT "AiReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatorySnapshot" ADD CONSTRAINT "RegulatorySnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatorySnapshot" ADD CONSTRAINT "RegulatorySnapshot_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatorySnapshot" ADD CONSTRAINT "RegulatorySnapshot_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceRun" ADD CONSTRAINT "IntelligenceRun_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_runId_organizationId_fkey" FOREIGN KEY ("runId", "organizationId") REFERENCES "IntelligenceRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceDecision" ADD CONSTRAINT "IntelligenceDecision_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSchedule" ADD CONSTRAINT "WatchSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchSchedule" ADD CONSTRAINT "WatchSchedule_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticRequest" ADD CONSTRAINT "SemanticRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAssessment" ADD CONSTRAINT "AssuranceAssessment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeImport" ADD CONSTRAINT "ProgrammeImport_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "ProgrammeImport"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedControl" ADD CONSTRAINT "ManagedControl_scheduledById_fkey" FOREIGN KEY ("scheduledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_obligationId_organizationId_fkey" FOREIGN KEY ("obligationId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlLink" ADD CONSTRAINT "ControlLink_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceConnector" ADD CONSTRAINT "EvidenceConnector_configuredById_fkey" FOREIGN KEY ("configuredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorRun" ADD CONSTRAINT "ConnectorRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorRun" ADD CONSTRAINT "ConnectorRun_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredSource" ADD CONSTRAINT "RegisteredSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredSource" ADD CONSTRAINT "RegisteredSource_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRequirement" ADD CONSTRAINT "LibraryRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_requirementId_organizationId_fkey" FOREIGN KEY ("requirementId", "organizationId") REFERENCES "LibraryRequirement"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryRevision" ADD CONSTRAINT "LibraryRevision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "LibraryRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryApplicability" ADD CONSTRAINT "LibraryApplicability_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRun" ADD CONSTRAINT "CoverageRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRun" ADD CONSTRAINT "CoverageRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_runId_organizationId_fkey" FOREIGN KEY ("runId", "organizationId") REFERENCES "CoverageRun"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "LibraryRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageDecision" ADD CONSTRAINT "CoverageDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoom" ADD CONSTRAINT "AuditRoom_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoom" ADD CONSTRAINT "AuditRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditGrant" ADD CONSTRAINT "AuditGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_grantId_roomId_organizationId_fkey" FOREIGN KEY ("grantId", "roomId", "organizationId") REFERENCES "AuditGrant"("id", "roomId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestion" ADD CONSTRAINT "AuditQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_policyId_organizationId_fkey" FOREIGN KEY ("policyId", "organizationId") REFERENCES "Policy"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_revisionId_organizationId_fkey" FOREIGN KEY ("revisionId", "organizationId") REFERENCES "PolicyRevision"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_signalConnectorId_organizationId_fkey" FOREIGN KEY ("signalConnectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_vendorId_organizationId_fkey" FOREIGN KEY ("vendorId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorReview" ADD CONSTRAINT "VendorReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_roomId_organizationId_fkey" FOREIGN KEY ("roomId", "organizationId") REFERENCES "AuditRoom"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRequest" ADD CONSTRAINT "AuditRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_snapshotId_organizationId_fkey" FOREIGN KEY ("snapshotId", "organizationId") REFERENCES "RegulatorySnapshot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeResponse" ADD CONSTRAINT "ChangeResponse_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_responseId_organizationId_fkey" FOREIGN KEY ("responseId", "organizationId") REFERENCES "ChangeResponse"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAction" ADD CONSTRAINT "ChangeAction_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessInventory" ADD CONSTRAINT "AccessInventory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessInventory" ADD CONSTRAINT "AccessInventory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_inventoryId_organizationId_fkey" FOREIGN KEY ("inventoryId", "organizationId") REFERENCES "AccessInventory"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCampaign" ADD CONSTRAINT "AccessCampaign_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_campaignId_organizationId_fkey" FOREIGN KEY ("campaignId", "organizationId") REFERENCES "AccessCampaign"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Obligation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewItem" ADD CONSTRAINT "AccessReviewItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceAnswer" ADD CONSTRAINT "AssuranceAnswer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssuranceQuestionnaire" ADD CONSTRAINT "AssuranceQuestionnaire_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RegPilot private-data hardening for tables managed by the server-side Prisma application.
-- Apply ONLY AFTER the matching Prisma tables exist and ONLY using a reviewed direct
-- database administrator connection. Supabase Auth does not use these Prisma tables.
--
-- This is an additional API-facing default-deny safety layer, not a complete tenant RLS
-- policy for the privileged direct-DB connection. Every server query must independently
-- enforce authenticated organisation membership. Never expose DATABASE_URL to browsers.
--
-- The SQL fails closed if any expected table is absent; it can be run repeatedly.

DO $private$
DECLARE
  name text;
  role_name text;
  relation_name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'User','Organization','Membership','Obligation','Evidence','AuditEvent',
    'AiDailyUsage','AiReview','RegulatorySnapshot','BusinessProfile','IntelligenceRun','IntelligenceDecision','WatchSchedule','SemanticRequest','AssuranceAssessment','ProgrammeImport','ManagedControl','ControlLink','EvidenceConnector','ConnectorRun','RegisteredSource','LibraryRequirement','LibraryRevision','LibraryApplicability','CoverageRun','CoverageDecision','WorkspaceInvitation','PaidBudget','PaidReservation','ServiceJob','BillingAccount','BillingEvent','AuditRoom','AuditGrant','AuditQuestion','Policy','PolicyRevision','PolicyAssignment','Vendor','VendorReview','AuditRequest','ChangeResponse','ChangeAction','AccessInventory','AccessCampaign','AccessReviewItem','AssuranceAnswer','AssuranceQuestionnaire'
  ] LOOP
    relation_name := format('public.%I',name);
    IF to_regclass(relation_name) IS NULL THEN
      RAISE EXCEPTION 'RegPilot private table % is missing; apply schema first',relation_name;
    END IF;
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM PUBLIC',relation_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I',relation_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END
$private$;


COMMIT;
