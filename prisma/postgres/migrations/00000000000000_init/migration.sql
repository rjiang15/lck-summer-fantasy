-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "seasonOrder" INTEGER NOT NULL DEFAULT 0,
    "catalogStatus" TEXT NOT NULL DEFAULT 'PAST',
    "dateStart" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProTeam" (
    "id" TEXT NOT NULL,
    "short" TEXT,

    CONSTRAINT "ProTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProPlayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "teamId" TEXT,
    "tournamentId" TEXT,

    CONSTRAINT "ProPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPlayer" (
    "id" SERIAL NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT,
    "role" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Week" (
    "id" SERIAL NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "sourceLabel" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "scheduleImportedAt" TIMESTAMP(3),
    "resultsImportedAt" TIMESTAMP(3),

    CONSTRAINT "Week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "weekId" INTEGER,
    "team1" TEXT NOT NULL,
    "team2" TEXT NOT NULL,
    "bestOf" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "winner" TEXT,
    "team1Score" INTEGER,
    "team2Score" INTEGER,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "gameNumber" INTEGER NOT NULL,
    "winner" TEXT,
    "lengthSec" INTEGER,
    "playedAt" TIMESTAMP(3),
    "patch" TEXT,
    "sourceUrl" TEXT,
    "vodUrl" TEXT,
    "riotPlatformGameId" TEXT,
    "riotPlatformId" TEXT,
    "riotGameId" TEXT,
    "sourceData" TEXT,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerGameStat" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "side" TEXT,
    "champion" TEXT NOT NULL,
    "role" TEXT,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "gold" INTEGER,
    "goldEarned" INTEGER,
    "goldSpent" INTEGER,
    "cs" INTEGER,
    "minionKills" INTEGER,
    "monsterKills" INTEGER,
    "monsterKillsOwnJungle" INTEGER,
    "monsterKillsEnemyJungle" INTEGER,
    "damage" INTEGER,
    "damageToObjectives" INTEGER,
    "damageToTowers" INTEGER,
    "damageTaken" INTEGER,
    "damageMitigated" INTEGER,
    "totalHeal" INTEGER,
    "visionScore" INTEGER,
    "wardsPlaced" INTEGER,
    "wardsKilled" INTEGER,
    "controlWardsBought" INTEGER,
    "doubleKills" INTEGER,
    "tripleKills" INTEGER,
    "quadraKills" INTEGER,
    "pentakills" INTEGER,
    "firstBloodKill" BOOLEAN,
    "firstBloodAssist" BOOLEAN,
    "firstBloodVictim" BOOLEAN,
    "summonerSpells" TEXT,
    "items" TEXT,
    "trinket" TEXT,
    "primaryRuneTree" TEXT,
    "secondaryRuneTree" TEXT,
    "keystoneRune" TEXT,
    "teamKills" INTEGER,
    "teamGold" INTEGER,
    "killParticipation" DOUBLE PRECISION,
    "damageShare" DOUBLE PRECISION,
    "goldShare" DOUBLE PRECISION,
    "sourceData" TEXT,
    "won" BOOLEAN NOT NULL,

    CONSTRAINT "PlayerGameStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamGameStat" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "side" TEXT,
    "kills" INTEGER,
    "deaths" INTEGER,
    "gold" INTEGER,
    "towers" INTEGER,
    "turretPlates" INTEGER,
    "dragons" INTEGER,
    "cloudDrakes" INTEGER,
    "infernalDrakes" INTEGER,
    "mountainDrakes" INTEGER,
    "oceanDrakes" INTEGER,
    "hextechDrakes" INTEGER,
    "chemtechDrakes" INTEGER,
    "elderDragons" INTEGER,
    "barons" INTEGER,
    "heralds" INTEGER,
    "voidGrubs" INTEGER,
    "atakhans" INTEGER,
    "inhibs" INTEGER,
    "firstBlood" BOOLEAN,
    "firstDragon" BOOLEAN,
    "firstHerald" BOOLEAN,
    "firstBaron" BOOLEAN,
    "firstTower" BOOLEAN,
    "firstMidTower" BOOLEAN,
    "firstThreeTowers" BOOLEAN,
    "sourceData" TEXT,
    "won" BOOLEAN NOT NULL,

    CONSTRAINT "TeamGameStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftAction" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "champion" TEXT NOT NULL,
    "role" TEXT,
    "playerId" TEXT,

    CONSTRAINT "DraftAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerTimelineSnapshot" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "PlayerTimelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamTimelineSnapshot" (
    "id" SERIAL NOT NULL,
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

    CONSTRAINT "TeamTimelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isCommish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "inviteCode" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL,
    "currentWeek" INTEGER NOT NULL DEFAULT 0,
    "seasonStatus" TEXT NOT NULL DEFAULT 'PRESEASON',
    "crystalBallLockedAt" TIMESTAMP(3),
    "rostersLockedAt" TIMESTAMP(3),
    "isSimulation" BOOLEAN NOT NULL DEFAULT false,
    "draftStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "draftOrder" TEXT,
    "draftCurrentPick" INTEGER NOT NULL DEFAULT 0,
    "draftBudget" INTEGER NOT NULL DEFAULT 10000,
    "draftPlayerPrice" INTEGER NOT NULL DEFAULT 1000,
    "draftPlayersPerRole" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMembership" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PARTICIPANT',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueWeek" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "weekId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPCOMING',
    "picksOpenAt" TIMESTAMP(3),
    "picksLockedAt" TIMESTAMP(3),
    "rosterLockedAt" TIMESTAMP(3),
    "resultsImportedAt" TIMESTAMP(3),
    "scoredAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "validationJson" TEXT,
    "validationError" TEXT,

    CONSTRAINT "LeagueWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyTeam" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "FantasyTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "overallPick" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyRosterSlot" (
    "id" SERIAL NOT NULL,
    "leagueWeekId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyRosterSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyScore" (
    "id" SERIAL NOT NULL,
    "leagueWeekId" INTEGER NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "rosterPts" DOUBLE PRECISION NOT NULL,
    "pickemPts" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "breakdown" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "WeeklyScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterSlot" (
    "id" SERIAL NOT NULL,
    "fantasyTeamId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,

    CONSTRAINT "RosterSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pickem" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "predictedWinner" TEXT NOT NULL,
    "predictedScore" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pickem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrystalBallQuestion" (
    "id" SERIAL NOT NULL,
    "leagueId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "answerType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "metricKey" TEXT,
    "gradingMode" TEXT NOT NULL DEFAULT 'EXACT',
    "resolverConfig" TEXT,
    "partialRule" TEXT,
    "correctAnswer" TEXT,
    "partialAnswers" TEXT,
    "resolvedAnswers" TEXT,
    "resolutionData" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CrystalBallQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrystalBallAnswer" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrystalBallAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "weekNumber" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "rowCount" INTEGER,
    "summary" TEXT,
    "error" TEXT,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatProvenance" (
    "id" SERIAL NOT NULL,
    "gameId" TEXT NOT NULL,
    "runId" INTEGER,
    "entityType" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TournamentPlayer_tournamentId_role_idx" ON "TournamentPlayer"("tournamentId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPlayer_tournamentId_playerId_key" ON "TournamentPlayer"("tournamentId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Week_tournamentId_number_key" ON "Week"("tournamentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerGameStat_gameId_playerId_key" ON "PlayerGameStat"("gameId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamGameStat_gameId_teamId_key" ON "TeamGameStat"("gameId", "teamId");

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

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "League_slug_key" ON "League"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");

-- CreateIndex
CREATE INDEX "LeagueMembership_userId_role_idx" ON "LeagueMembership"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMembership_leagueId_userId_key" ON "LeagueMembership"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "LeagueWeek_leagueId_status_idx" ON "LeagueWeek"("leagueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueWeek_leagueId_weekId_key" ON "LeagueWeek"("leagueId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyTeam_leagueId_userId_key" ON "FantasyTeam"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "DraftPick_fantasyTeamId_role_idx" ON "DraftPick"("fantasyTeamId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_playerId_key" ON "DraftPick"("leagueId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_overallPick_key" ON "DraftPick"("leagueId", "overallPick");

-- CreateIndex
CREATE INDEX "WeeklyRosterSlot_leagueWeekId_fantasyTeamId_idx" ON "WeeklyRosterSlot"("leagueWeekId", "fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyRosterSlot_leagueWeekId_fantasyTeamId_playerId_key" ON "WeeklyRosterSlot"("leagueWeekId", "fantasyTeamId", "playerId");

-- CreateIndex
CREATE INDEX "WeeklyScore_fantasyTeamId_idx" ON "WeeklyScore"("fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScore_leagueWeekId_fantasyTeamId_key" ON "WeeklyScore"("leagueWeekId", "fantasyTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterSlot_fantasyTeamId_playerId_key" ON "RosterSlot"("fantasyTeamId", "playerId");

-- CreateIndex
CREATE INDEX "Pickem_userId_leagueId_idx" ON "Pickem"("userId", "leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "Pickem_leagueId_userId_matchId_key" ON "Pickem"("leagueId", "userId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "CrystalBallQuestion_leagueId_metricKey_key" ON "CrystalBallQuestion"("leagueId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "CrystalBallAnswer_questionId_userId_key" ON "CrystalBallAnswer"("questionId", "userId");

-- CreateIndex
CREATE INDEX "IngestionRun_tournamentId_weekNumber_source_idx" ON "IngestionRun"("tournamentId", "weekNumber", "source");

-- CreateIndex
CREATE INDEX "StatProvenance_runId_idx" ON "StatProvenance"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "StatProvenance_gameId_entityType_entityKey_source_key" ON "StatProvenance"("gameId", "entityType", "entityKey", "source");

-- AddForeignKey
ALTER TABLE "ProPlayer" ADD CONSTRAINT "ProPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ProTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProPlayer" ADD CONSTRAINT "ProPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPlayer" ADD CONSTRAINT "TournamentPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Week" ADD CONSTRAINT "Week_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameStat" ADD CONSTRAINT "PlayerGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerGameStat" ADD CONSTRAINT "PlayerGameStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamGameStat" ADD CONSTRAINT "TeamGameStat_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftAction" ADD CONSTRAINT "DraftAction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTimelineSnapshot" ADD CONSTRAINT "PlayerTimelineSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTimelineSnapshot" ADD CONSTRAINT "PlayerTimelineSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamTimelineSnapshot" ADD CONSTRAINT "TeamTimelineSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMembership" ADD CONSTRAINT "LeagueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueWeek" ADD CONSTRAINT "LeagueWeek_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueWeek" ADD CONSTRAINT "LeagueWeek_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "Week"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FantasyTeam" ADD CONSTRAINT "FantasyTeam_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FantasyTeam" ADD CONSTRAINT "FantasyTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyRosterSlot" ADD CONSTRAINT "WeeklyRosterSlot_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyRosterSlot" ADD CONSTRAINT "WeeklyRosterSlot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyRosterSlot" ADD CONSTRAINT "WeeklyRosterSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyScore" ADD CONSTRAINT "WeeklyScore_leagueWeekId_fkey" FOREIGN KEY ("leagueWeekId") REFERENCES "LeagueWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyScore" ADD CONSTRAINT "WeeklyScore_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_fantasyTeamId_fkey" FOREIGN KEY ("fantasyTeamId") REFERENCES "FantasyTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSlot" ADD CONSTRAINT "RosterSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ProPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickem" ADD CONSTRAINT "Pickem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickem" ADD CONSTRAINT "Pickem_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pickem" ADD CONSTRAINT "Pickem_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrystalBallQuestion" ADD CONSTRAINT "CrystalBallQuestion_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrystalBallAnswer" ADD CONSTRAINT "CrystalBallAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CrystalBallQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrystalBallAnswer" ADD CONSTRAINT "CrystalBallAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatProvenance" ADD CONSTRAINT "StatProvenance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatProvenance" ADD CONSTRAINT "StatProvenance_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
