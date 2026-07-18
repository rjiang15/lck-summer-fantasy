-- Add a chronological tournament catalog without changing any existing league.
ALTER TABLE "Tournament" ADD COLUMN "seasonOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tournament" ADD COLUMN "catalogStatus" TEXT NOT NULL DEFAULT 'PAST';
ALTER TABLE "Week" ADD COLUMN "sourceLabel" TEXT;

-- The already imported Rounds 1-2 split is the first known historical season.
UPDATE "Tournament"
SET "seasonOrder" = 1, "catalogStatus" = 'PAST'
WHERE "id" = 'LCK/2026 Season/Rounds 1-2';
