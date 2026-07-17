ALTER TABLE "CrystalBallQuestion" ADD COLUMN "metricKey" TEXT;
ALTER TABLE "CrystalBallQuestion" ADD COLUMN "gradingMode" TEXT NOT NULL DEFAULT 'EXACT';
ALTER TABLE "CrystalBallQuestion" ADD COLUMN "resolverConfig" TEXT;
ALTER TABLE "CrystalBallQuestion" ADD COLUMN "resolvedAnswers" TEXT;
ALTER TABLE "CrystalBallQuestion" ADD COLUMN "resolutionData" TEXT;
ALTER TABLE "CrystalBallQuestion" ADD COLUMN "resolvedAt" DATETIME;

CREATE UNIQUE INDEX "CrystalBallQuestion_leagueId_metricKey_key"
ON "CrystalBallQuestion"("leagueId", "metricKey");
