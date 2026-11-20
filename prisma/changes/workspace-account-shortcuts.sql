ALTER TABLE "Organization" ADD COLUMN "accountShortcuts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
