BEGIN;
ALTER TABLE public."WorkerRun" ADD COLUMN slot INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "WorkerRun_slot_state_leaseUntil_idx" ON public."WorkerRun"(slot,state,"leaseUntil");
COMMIT;
