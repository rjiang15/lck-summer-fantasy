-- CreateTable
CREATE TABLE "DraftPick" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "overallPick" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "pickedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftPick_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_League" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "inviteCode" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL,
    "currentWeek" INTEGER NOT NULL DEFAULT 0,
    "seasonStatus" TEXT NOT NULL DEFAULT 'PRESEASON',
    "crystalBallLockedAt" DATETIME,
    "isSimulation" BOOLEAN NOT NULL DEFAULT false,
    "draftStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "draftOrder" TEXT,
    "draftCurrentPick" INTEGER NOT NULL DEFAULT 0,
    "draftBudget" INTEGER NOT NULL DEFAULT 10000,
    "draftPlayerPrice" INTEGER NOT NULL DEFAULT 1000,
    "draftPlayersPerRole" INTEGER NOT NULL DEFAULT 2
);
INSERT INTO "new_League" ("crystalBallLockedAt", "currentWeek", "id", "inviteCode", "isSimulation", "name", "scoringConfig", "seasonStatus", "slug", "tournamentId") SELECT "crystalBallLockedAt", "currentWeek", "id", "inviteCode", "isSimulation", "name", "scoringConfig", "seasonStatus", "slug", "tournamentId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DraftPick_fantasyTeamId_role_idx" ON "DraftPick"("fantasyTeamId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_playerId_key" ON "DraftPick"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_overallPick_key" ON "DraftPick"("leagueId", "overallPick");
