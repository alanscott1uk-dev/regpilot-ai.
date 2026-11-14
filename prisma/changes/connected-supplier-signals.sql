-- Additive supplier signal links; no new public tables or grants.
BEGIN;
-- AlterTable
ALTER TABLE "Obligation" ADD COLUMN     "vendorSignalId" UUID;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "signalConnectorId" UUID;

-- AlterTable
ALTER TABLE "VendorReview" ADD COLUMN     "signalSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "Obligation_organizationId_vendorSignalId_status_idx" ON "Obligation"("organizationId", "vendorSignalId", "status");

-- CreateIndex
CREATE INDEX "Vendor_organizationId_signalConnectorId_idx" ON "Vendor"("organizationId", "signalConnectorId");

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_vendorSignalId_organizationId_fkey" FOREIGN KEY ("vendorSignalId", "organizationId") REFERENCES "Vendor"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_signalConnectorId_organizationId_fkey" FOREIGN KEY ("signalConnectorId", "organizationId") REFERENCES "EvidenceConnector"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
