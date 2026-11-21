ALTER TABLE "CustomerApiObservation"
 ADD COLUMN "partnerKey" VARCHAR(64),
 ADD COLUMN "partnerRevision" INTEGER,
 ADD COLUMN "supersededAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CustomerApiObservation_partner_revision_key"
 ON "CustomerApiObservation"("credentialId","controlId","partnerKey","partnerRevision");
ALTER TABLE "AuditRoom" ADD COLUMN "publicKey" UUID,
 ADD COLUMN "publicTitle" VARCHAR(120), ADD COLUMN "publicSummary" VARCHAR(600),
 ADD COLUMN "publicRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "publicPublishedBy" UUID;
CREATE UNIQUE INDEX "AuditRoom_publicKey_key" ON "AuditRoom"("publicKey");
ALTER TABLE "AuditGrant" ADD COLUMN "publicRevision" INTEGER;
ALTER TABLE "CustomerApiObservation" ADD COLUMN "retentionEndsAt" TIMESTAMP(3), ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "CustomerApiObservation_retentionEndsAt_purgedAt_idx" ON "CustomerApiObservation"("retentionEndsAt","purgedAt");
