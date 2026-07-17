-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "dateStart" DATETIME,
    "dateEnd" DATETIME
);

-- CreateTable
CREATE TABLE "ProTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "short" TEXT
);

-- CreateTable
CREATE TABLE "ProPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "teamId" TEXT,
    "tournamentId" TEXT,
    CONSTRAINT "ProPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ProTeam" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Week" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tournamentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    CONSTRAINT "Week_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tournamentId" TEXT NOT NULL,
    "weekId" INTEGER,
    "team1" TEXT NOT NULL,
    "team2" TEXT NOT NULL,
    "bestOf" INTEGER NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "winner" TEXT,
    "team1Score" INTEGER,
    "team2Score" INTEGER,
    CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Match_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "winner" TEXT,
    "lengthSec" INTEGER,
    "playedAt" DATETIME,
    CONSTRAINT "Game_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerGameStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "champion" TEXT NOT NULL,
    "role" TEXT,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "gold" INTEGER,
    "cs" INTEGER,
    "damage" INTEGER,
    "visionScore" INTEGER,
    "won" BOOLEAN NOT NULL,
    CONSTRAINT "PlayerGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlayerGameStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamGameStat" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "kills" INTEGER,
    "towers" INTEGER,
    "dragons" INTEGER,
    "barons" INTEGER,
    "heralds" INTEGER,
    "inhibs" INTEGER,
    "won" BOOLEAN NOT NULL,
    CONSTRAINT "TeamGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isCommish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "League" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "FantasyTeam" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "FantasyTeam_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FantasyTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosterSlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    CONSTRAINT "RosterSlot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RosterSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pickem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "predictedWinner" TEXT NOT NULL,
    "predictedScore" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Pickem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pickem_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrystalBallQuestion" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "leagueId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "answerType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "partialRule" TEXT,
    "correctAnswer" TEXT,
    "partialAnswers" TEXT,
    CONSTRAINT "CrystalBallQuestion_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrystalBallAnswer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "questionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    CONSTRAINT "CrystalBallAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CrystalBallQuestion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrystalBallAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Week_tournamentId_number_key" ON "Week"("tournamentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerGameStat_gameId_playerId_key" ON "PlayerGameStat"("gameId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGameStat_gameId_teamId_key" ON "TeamGameStat"("gameId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyTeam_leagueId_userId_key" ON "FantasyTeam"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterSlot_fantasyTeamId_playerId_key" ON "RosterSlot"("fantasyTeamId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Pickem_userId_matchId_key" ON "Pickem"("userId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "CrystalBallAnswer_questionId_userId_key" ON "CrystalBallAnswer"("questionId", "userId");
