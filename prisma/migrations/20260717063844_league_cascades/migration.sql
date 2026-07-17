-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrystalBallQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "answerType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "partialRule" TEXT,
    "correctAnswer" TEXT,
    "partialAnswers" TEXT,
    CONSTRAINT "CrystalBallQuestion_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrystalBallQuestion" ("answerType", "correctAnswer", "id", "leagueId", "partialAnswers", "partialRule", "points", "prompt") SELECT "answerType", "correctAnswer", "id", "leagueId", "partialAnswers", "partialRule", "points", "prompt" FROM "CrystalBallQuestion";
DROP TABLE "CrystalBallQuestion";
ALTER TABLE "new_CrystalBallQuestion" RENAME TO "CrystalBallQuestion";
CREATE TABLE "new_FantasyTeam" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "FantasyTeam_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FantasyTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FantasyTeam" ("id", "leagueId", "name", "userId") SELECT "id", "leagueId", "name", "userId" FROM "FantasyTeam";
DROP TABLE "FantasyTeam";
ALTER TABLE "new_FantasyTeam" RENAME TO "FantasyTeam";
CREATE UNIQUE INDEX "FantasyTeam_leagueId_userId_key" ON "FantasyTeam"("leagueId", "userId");
CREATE TABLE "new_RosterSlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    CONSTRAINT "RosterSlot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RosterSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RosterSlot" ("fantasyTeamId", "id", "playerId", "slot") SELECT "fantasyTeamId", "id", "playerId", "slot" FROM "RosterSlot";
DROP TABLE "RosterSlot";
ALTER TABLE "new_RosterSlot" RENAME TO "RosterSlot";
CREATE UNIQUE INDEX "RosterSlot_fantasyTeamId_playerId_key" ON "RosterSlot"("fantasyTeamId", "playerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
