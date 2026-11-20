-- Preserve failed attempts and allow only explicitly requested, bounded retries.
-- Existing snapshots and request identities remain unchanged at attempt one.
BEGIN;
ALTER TABLE "QuestionnaireDraftRun"
 ADD COLUMN "retryOfId" UUID,
 ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "QuestionnaireDraftRun_organizationId_inputHash_method_key";
CREATE UNIQUE INDEX "QuestionnaireDraftRun_id_organizationId_key" ON "QuestionnaireDraftRun"("id","organizationId");
CREATE UNIQUE INDEX "QuestionnaireDraftRun_attempt_key" ON "QuestionnaireDraftRun"("organizationId","inputHash","method","attempt");
CREATE INDEX "QuestionnaireDraftRun_input_status_idx" ON "QuestionnaireDraftRun"("organizationId","inputHash","method","status");
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_retryOfId_organizationId_fkey"
 FOREIGN KEY ("retryOfId","organizationId") REFERENCES "QuestionnaireDraftRun"("id","organizationId") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "QuestionnaireDraftRun" ADD CONSTRAINT "QuestionnaireDraftRun_attempt_check"
 CHECK (("attempt"=1 AND "retryOfId" IS NULL) OR ("attempt" BETWEEN 2 AND 3 AND "retryOfId" IS NOT NULL AND "retryOfId"<>"id"));
COMMIT;
