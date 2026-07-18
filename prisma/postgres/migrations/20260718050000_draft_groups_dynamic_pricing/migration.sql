-- AlterTable
ALTER TABLE "League" ADD COLUMN "draftPricingMode" TEXT NOT NULL DEFAULT 'UNIFORM';
ALTER TABLE "League" ADD COLUMN "draftPriceSourceTournamentId" TEXT;
ALTER TABLE "League" ADD COLUMN "draftPriceSheet" TEXT;
