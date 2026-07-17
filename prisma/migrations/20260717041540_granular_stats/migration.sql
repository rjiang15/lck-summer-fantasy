-- AlterTable
ALTER TABLE "Game" ADD COLUMN "patch" TEXT;
ALTER TABLE "Game" ADD COLUMN "riotGameId" TEXT;
ALTER TABLE "Game" ADD COLUMN "riotPlatformGameId" TEXT;
ALTER TABLE "Game" ADD COLUMN "riotPlatformId" TEXT;
ALTER TABLE "Game" ADD COLUMN "sourceData" TEXT;
ALTER TABLE "Game" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "Game" ADD COLUMN "vodUrl" TEXT;

-- AlterTable
ALTER TABLE "PlayerGameStat" ADD COLUMN "controlWardsBought" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "damageMitigated" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "damageShare" REAL;
ALTER TABLE "PlayerGameStat" ADD COLUMN "damageTaken" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "damageToObjectives" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "doubleKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "firstBloodAssist" BOOLEAN;
ALTER TABLE "PlayerGameStat" ADD COLUMN "firstBloodKill" BOOLEAN;
ALTER TABLE "PlayerGameStat" ADD COLUMN "firstBloodVictim" BOOLEAN;
ALTER TABLE "PlayerGameStat" ADD COLUMN "goldEarned" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "goldShare" REAL;
ALTER TABLE "PlayerGameStat" ADD COLUMN "goldSpent" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "items" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "keystoneRune" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "killParticipation" REAL;
ALTER TABLE "PlayerGameStat" ADD COLUMN "minionKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "monsterKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "pentakills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "primaryRuneTree" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "quadraKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "secondaryRuneTree" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "side" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "sourceData" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "summonerSpells" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "teamGold" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "teamKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "totalHeal" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "trinket" TEXT;
ALTER TABLE "PlayerGameStat" ADD COLUMN "tripleKills" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "wardsKilled" INTEGER;
ALTER TABLE "PlayerGameStat" ADD COLUMN "wardsPlaced" INTEGER;

-- AlterTable
ALTER TABLE "TeamGameStat" ADD COLUMN "atakhans" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "chemtechDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "cloudDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "deaths" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "elderDragons" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstBaron" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstBlood" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstDragon" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstHerald" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstMidTower" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstThreeTowers" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "firstTower" BOOLEAN;
ALTER TABLE "TeamGameStat" ADD COLUMN "gold" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "hextechDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "infernalDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "mountainDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "oceanDrakes" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "side" TEXT;
ALTER TABLE "TeamGameStat" ADD COLUMN "sourceData" TEXT;
ALTER TABLE "TeamGameStat" ADD COLUMN "turretPlates" INTEGER;
ALTER TABLE "TeamGameStat" ADD COLUMN "voidGrubs" INTEGER;

-- CreateTable
CREATE TABLE "DraftAction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "champion" TEXT NOT NULL,
    "role" TEXT,
    "playerId" TEXT,
    CONSTRAINT "DraftAction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "timestampMs" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "teamId" TEXT,
    "playerId" TEXT,
    "victimPlayerId" TEXT,
    "assistingPlayerIds" TEXT,
    "champion" TEXT,
    "monsterType" TEXT,
    "monsterSubType" TEXT,
    "buildingType" TEXT,
    "laneType" TEXT,
    "positionX" INTEGER,
    "positionY" INTEGER,
    "payload" TEXT,
    CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerTimelineSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "kills" INTEGER,
    "deaths" INTEGER,
    "assists" INTEGER,
    "cs" INTEGER,
    "gold" INTEGER,
    "xp" INTEGER,
    "level" INTEGER,
    "csDiff" INTEGER,
    "goldDiff" INTEGER,
    "xpDiff" INTEGER,
    "sourceData" TEXT,
    CONSTRAINT "PlayerTimelineSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PlayerTimelineSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamTimelineSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "minute" INTEGER NOT NULL,
    "kills" INTEGER,
    "deaths" INTEGER,
    "gold" INTEGER,
    "xp" INTEGER,
    "cs" INTEGER,
    "towers" INTEGER,
    "dragons" INTEGER,
    "heralds" INTEGER,
    "voidGrubs" INTEGER,
    "barons" INTEGER,
    "sourceData" TEXT,
    CONSTRAINT "TeamTimelineSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DraftAction_gameId_teamId_action_sequence_key" ON "DraftAction"("gameId", "teamId", "action", "sequence");

-- CreateIndex
CREATE INDEX "GameEvent_gameId_timestampMs_idx" ON "GameEvent"("gameId", "timestampMs");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_gameId_sourceKey_key" ON "GameEvent"("gameId", "sourceKey");

-- CreateIndex
CREATE INDEX "PlayerTimelineSnapshot_playerId_minute_idx" ON "PlayerTimelineSnapshot"("playerId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerTimelineSnapshot_gameId_playerId_minute_key" ON "PlayerTimelineSnapshot"("gameId", "playerId", "minute");

-- CreateIndex
CREATE INDEX "TeamTimelineSnapshot_teamId_minute_idx" ON "TeamTimelineSnapshot"("teamId", "minute");

-- CreateIndex
CREATE UNIQUE INDEX "TeamTimelineSnapshot_gameId_teamId_minute_key" ON "TeamTimelineSnapshot"("gameId", "teamId", "minute");
