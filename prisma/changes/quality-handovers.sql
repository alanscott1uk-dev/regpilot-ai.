BEGIN;
ALTER TABLE "QualityCase"
 ADD COLUMN "handoverRecipientId" UUID,
 ADD COLUMN "handoverNotes" VARCHAR(1600) NOT NULL DEFAULT '',
 ADD CONSTRAINT "QualityCase_handover_check" CHECK (
  ("handoverRecipientId" IS NULL AND "handoverNotes" = '') OR
  ("handoverRecipientId" IS NOT NULL AND "handoverRecipientId" <> "ownerId" AND length(trim("handoverNotes")) >= 10 AND "status" <> 'CLOSED')
 );
CREATE INDEX "QualityCase_organizationId_handoverRecipientId_idx" ON "QualityCase"("organizationId","handoverRecipientId");
ALTER TABLE "QualityOperation" DROP CONSTRAINT "QualityOperation_action_check",
 ADD CONSTRAINT "QualityOperation_action_check" CHECK ("action" IN (
  'CREATE','INVESTIGATE','ADD_ACTION','PREPARE_EFFECTIVENESS','DECIDE_EFFECTIVENESS','REOPEN',
  'OFFER_HANDOVER','ACCEPT_HANDOVER','CANCEL_HANDOVER'
 ));
COMMIT;
