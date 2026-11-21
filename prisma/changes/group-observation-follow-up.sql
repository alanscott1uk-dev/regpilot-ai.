BEGIN;
ALTER TABLE "CustomerApiOperation" DROP CONSTRAINT "CustomerApiOperation_fields_check",
 ADD CONSTRAINT "CustomerApiOperation_fields_check" CHECK (
  "requestHash" ~ '^[a-f0-9]{64}$' AND
  "action" IN ('CREATED','ROTATED','REVOKED','OBSERVATION_REVIEWED','GROUPED_FOLLOW_UP') AND
  jsonb_typeof("result")='object' AND NOT ("result" ?| ARRAY['secret','secretHash'])
 );
CREATE INDEX IF NOT EXISTS "CustomerApiObservation_organizationId_followUpTaskId_idx"
 ON "CustomerApiObservation"("organizationId","followUpTaskId");
CREATE INDEX IF NOT EXISTS "AuditEvent_record_action_time_idx"
 ON "AuditEvent"("organizationId","entityType","entityId","action","createdAt");
COMMIT;
