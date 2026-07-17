-- CreateTable
CREATE TABLE "Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueWeek" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "weekId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "picksOpenAt" DATETIME,
    "picksLockedAt" DATETIME,
    "rosterLockedAt" DATETIME,
    "resultsImportedAt" DATETIME,
    "scoredAt" DATETIME,
    "publishedAt" DATETIME,
    "validationJson" TEXT,
    "validationError" TEXT,
    CONSTRAINT "LeagueWeek_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueWeek_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyRosterSlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueWeekId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "lockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyRosterSlot_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId") REFERENCES "LeagueWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyRosterSlot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyRosterSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyScore" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueWeekId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "rosterPts" REAL NOT NULL,
    "pickemPts" REAL NOT NULL,
    "total" REAL NOT NULL,
    "breakdown" TEXT NOT NULL,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    CONSTRAINT "WeeklyScore_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId") REFERENCES "LeagueWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyScore_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "weekNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "rowCount" INTEGER,
    "summary" TEXT,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "StatProvenance" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "runId" INTEGER,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatProvenance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StatProvenance_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrystalBallAnswer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrystalBallAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CrystalBallQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrystalBallAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CrystalBallAnswer" ("answer", "id", "questionId", "userId") SELECT "answer", "id", "questionId", "userId" FROM "CrystalBallAnswer";
DROP TABLE "CrystalBallAnswer";
ALTER TABLE "new_CrystalBallAnswer" RENAME TO "CrystalBallAnswer";
CREATE UNIQUE INDEX "CrystalBallAnswer_questionId_userId_key" ON "CrystalBallAnswer"("questionId", "userId");
CREATE TABLE "new_League" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL,
    "currentWeek" INTEGER NOT NULL DEFAULT 0,
    "seasonStatus" TEXT NOT NULL DEFAULT 'PRESEASON',
    "crystalBallLockedAt" DATETIME,
    "isSimulation" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_League" ("id", "inviteCode", "name", "scoringConfig", "tournamentId") SELECT "id", "inviteCode", "name", "scoringConfig", "tournamentId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LeagueWeek_leagueId_status_idx" ON "LeagueWeek"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueWeek_leagueId_weekId_key" ON "LeagueWeek"("leagueId", "weekId");

-- CreateIndex
CREATE INDEX "WeeklyRosterSlot_leagueWeekId_fantasyTeamId_idx" ON "WeeklyRosterSlot"("leagueWeekId", "fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyRosterSlot_leagueWeekId_fantasyTeamId_playerId_key" ON "WeeklyRosterSlot"("leagueWeekId", "fantasyTeamId", "playerId");

-- CreateIndex
CREATE INDEX "WeeklyScore_fantasyTeamId_idx" ON "WeeklyScore"("fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScore_leagueWeekId_fantasyTeamId_key" ON "WeeklyScore"("leagueWeekId", "fantasyTeamId");

-- CreateIndex
CREATE INDEX "IngestionRun_tournamentId_weekNumber_source_idx" ON "IngestionRun"("tournamentId", "weekNumber", "source");

-- CreateIndex
CREATE INDEX "StatProvenance_runId_idx" ON "StatProvenance"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "StatProvenance_gameId_entityType_entityKey_source_key" ON "StatProvenance"("gameId", "entityType", "entityKey", "source");
