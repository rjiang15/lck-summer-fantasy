/*
  Warnings:

  - Added the required column `leagueId` to the `Pickem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Week" ADD COLUMN "resultsImportedAt" DATETIME;
ALTER TABLE "Week" ADD COLUMN "scheduleImportedAt" DATETIME;

-- CreateTable
CREATE TABLE "TournamentPlayer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT,
    "role" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TournamentPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TournamentPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PARTICIPANT',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "isSimulation" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_League" ("crystalBallLockedAt", "currentWeek", "id", "inviteCode", "isSimulation", "name", "slug", "scoringConfig", "seasonStatus", "tournamentId") SELECT "crystalBallLockedAt", "currentWeek", "id", "inviteCode", "isSimulation", "name", 'league-' || "id", "scoringConfig", "seasonStatus", "tournamentId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
CREATE TABLE "new_Pickem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "predictedWinner" TEXT NOT NULL,
    "predictedScore" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pickem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pickem_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Pickem_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Pickem" ("createdAt", "id", "leagueId", "matchId", "predictedScore", "predictedWinner", "updatedAt", "userId")
SELECT p."createdAt", p."id", ft."leagueId", p."matchId", p."predictedScore", p."predictedWinner", p."updatedAt", p."userId"
FROM "Pickem" p
JOIN "FantasyTeam" ft ON ft."userId" = p."userId"
JOIN "League" l ON l."id" = ft."leagueId"
JOIN "Match" m ON m."id" = p."matchId" AND m."tournamentId" = l."tournamentId";
DROP TABLE "Pickem";
ALTER TABLE "new_Pickem" RENAME TO "Pickem";
CREATE INDEX "Pickem_userId_leagueId_idx" ON "Pickem"("userId", "leagueId");
CREATE UNIQUE INDEX "Pickem_leagueId_userId_matchId_key" ON "Pickem"("leagueId", "userId", "matchId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TournamentPlayer_tournamentId_role_idx" ON "TournamentPlayer"("tournamentId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPlayer_tournamentId_playerId_key" ON "TournamentPlayer"("tournamentId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueMembership_userId_role_idx" ON "LeagueMembership"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key" ON "LeagueMembership"("leagueId", "userId");

-- Preserve tournament-specific eligibility even when a player's current
-- ProPlayer row is later updated by a different split import.
INSERT INTO "TournamentPlayer" ("tournamentId", "playerId", "teamId", "role")
SELECT "tournamentId", "id", "teamId", "role"
FROM "ProPlayer"
WHERE "tournamentId" IS NOT NULL;

-- Existing schedules predate the explicit shared-data readiness columns.
UPDATE "Week"
SET "scheduleImportedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Match" WHERE "Match"."weekId" = "Week"."id");

UPDATE "Week"
SET "resultsImportedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Match" WHERE "Match"."weekId" = "Week"."id")
  AND NOT EXISTS (
    SELECT 1 FROM "Match"
    WHERE "Match"."weekId" = "Week"."id" AND "Match"."winner" IS NULL
  );
