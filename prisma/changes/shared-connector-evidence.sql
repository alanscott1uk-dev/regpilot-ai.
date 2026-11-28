BEGIN;
-- CreateTable
CREATE TABLE "ConnectorControlLink" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "connectorId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "mappedById" UUID NOT NULL,
    "rationale" VARCHAR(1200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorControlLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConnectorControlLink_organizationId_controlId_idx" ON "ConnectorControlLink"("organizationId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorControlLink_connectorId_controlId_key" ON "ConnectorControlLink"("connectorId", "controlId");

-- AddForeignKey
ALTER TABLE "ConnectorControlLink" ADD CONSTRAINT "ConnectorControlLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorControlLink" ADD CONSTRAINT "ConnectorControlLink_connectorId_organizationId_fkey" FOREIGN KEY ("connectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorControlLink" ADD CONSTRAINT "ConnectorControlLink_controlId_organizationId_fkey" FOREIGN KEY ("controlId", "organizationId") REFERENCES "ManagedControl"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorControlLink" ADD CONSTRAINT "ConnectorControlLink_mappedById_fkey" FOREIGN KEY ("mappedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE public."ConnectorControlLink" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ConnectorControlLink" FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public."ConnectorControlLink" FROM %I',r); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='regpilot_staging_runtime') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON public."ConnectorControlLink" TO regpilot_staging_runtime;
  CREATE POLICY regpilot_runtime_access ON public."ConnectorControlLink" FOR ALL TO regpilot_staging_runtime USING(true) WITH CHECK(true);
 END IF;
END $roles$;
COMMIT;
