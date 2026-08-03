// Import completed match results and scoreboards from Games of Legends.
// Leaguepedia remains the canonical schedule/roster source; Gol.gg is
// authoritative for completed series, game, player, team, and draft stats.

import { prisma } from "../lib/db";
import { validateWeekData } from "../lib/season";
import { assertSequentialIngest } from "../lib/ingest-order";
import { encodeIngestionProgress } from "../lib/ingestion-progress";
import { createWriteCounts, writeIfChanged, type WriteCounts } from "../lib/change-aware-write";
import type { PendingScoreboardMatch } from "../lib/ingest-completeness";
import {
  fetchGolHtml,
  golGameUrl,
  golSeriesResultForMatch,
  golStatInt,
  golStatRatio,
  golTournamentMatchListUrl,
  isGolSeriesComplete,
  normalizeGolIdentity,
  parseGolFullStats,
  parseGolGameOverview,
  parseGolMatchList,
  parseGolSeriesGames,
  type GolGameOverview,
  type GolPlayerStats,
  type GolSeries,
  type GolSeriesGame,
} from "../lib/games-of-legends";

const SOURCE = "GAMES_OF_LEGENDS";

export interface GamesOfLegendsIngestCounts {
  mode: "LIVE" | "FINAL" | "BACKFILL";
  matches: number;
  completedMatches: number;
  games: number;
  players: number;
  rosterPlayers: number;
  playerStats: number;
  draftActions: number;
  pendingScoreboards: PendingScoreboardMatch[];
  unmatchedSourceSeries: string[];
  writes: WriteCounts;
}

type ParsedGame = {
  link: GolSeriesGame;
  overview: GolGameOverview;
  players: GolPlayerStats[];
};

class IngestionCancelledError extends Error {
  constructor() {
    super("This import was recovered or cancelled before it completed");
    this.name = "IngestionCancelledError";
  }
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const teamSetKey = (left: string, right: string) =>
  [normalizeGolIdentity(left), normalizeGolIdentity(right)].sort().join("|");

function requiredStat(player: GolPlayerStats, label: string) {
  const value = golStatInt(player, label);
  if (value === null) throw new Error(`Games of Legends is missing ${label} for ${player.name}`);
  return value;
}

function canonicalTeam(sourceName: string, team1: string, team2: string) {
  const normalized = normalizeGolIdentity(sourceName);
  if (normalized === normalizeGolIdentity(team1)) return team1;
  if (normalized === normalizeGolIdentity(team2)) return team2;
  throw new Error(`Could not map Games of Legends team ${sourceName} to ${team1} vs ${team2}`);
}

function pendingSeries(
  match: { id: string; team1: string; team2: string; bestOf: number },
  series: GolSeries | null,
): PendingScoreboardMatch {
  const winsRequired = Math.floor(match.bestOf / 2) + 1;
  const gamesFound = series ? series.team1Score + series.team2Score : 0;
  return {
    matchId: match.id,
    label: `${match.team1} vs ${match.team2}${series ? ` (${series.team1Score}-${series.team2Score})` : ""}`,
    expectedGames: winsRequired,
    gamesFound,
    expectedPlayerLines: winsRequired * 10,
    playerLinesFound: 0,
  };
}

function pendingDetailedStats(
  match: { id: string; team1: string; team2: string; games: Array<{ playerStats: unknown[] }> },
  series: GolSeries,
  gamesFound: number,
  playerLinesFound: number,
  error: unknown,
): PendingScoreboardMatch {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    matchId: match.id,
    label: `${match.team1} vs ${match.team2} (${series.team1Score}-${series.team2Score}; detailed stats pending: ${detail.slice(0, 120)})`,
    expectedGames: series.team1Score + series.team2Score,
    gamesFound: Math.max(gamesFound, match.games.length),
    expectedPlayerLines: (series.team1Score + series.team2Score) * 10,
    playerLinesFound: Math.max(
      playerLinesFound,
      match.games.reduce((total, game) => total + game.playerStats.length, 0),
    ),
  };
}

function assertParsedGameComplete(parsed: ParsedGame) {
  if (parsed.players.length !== 10) {
    throw new Error(`Games of Legends game ${parsed.link.gameId} has ${parsed.players.length}/10 player rows`);
  }
  for (const draft of parsed.overview.drafts) {
    if (draft.picks.length !== 5 || draft.bans.length !== 5) {
      throw new Error(
        `Games of Legends game ${parsed.link.gameId} ${draft.side} draft has ` +
        `${draft.picks.length}/5 picks and ${draft.bans.length}/5 bans`,
      );
    }
  }
  for (const player of parsed.players) {
    for (const label of [
      "Kills", "Deaths", "Assists", "CS", "Golds", "Vision Score",
      "Wards destroyed", "Control Wards Purchased", "Total damage to Champion",
      "Damage dealt to turrets", "Damage self mitigated", "Triple kills",
      "Quadra kills", "Penta kills", "GD@15", "CSD@15", "XPD@15",
    ]) requiredStat(player, label);
    if (golStatRatio(player, "DMG%") === null || golStatRatio(player, "GOLD%") === null) {
      throw new Error(`Games of Legends game ${parsed.link.gameId} is missing damage/gold share for ${player.name}`);
    }
  }
}

async function reportProgress(runId: number, percent: number, message: string) {
  const updated = await prisma.ingestionRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { summary: encodeIngestionProgress(percent, message) },
  });
  if (updated.count !== 1) throw new IngestionCancelledError();
}

async function recordProvenance({
  runId,
  gameId,
  entityType,
  entityKey,
  fields,
}: {
  runId: number;
  gameId: string;
  entityType: "GAME" | "TEAM_GAME" | "PLAYER_GAME";
  entityKey: string;
  fields: string[];
}) {
  await prisma.statProvenance.upsert({
    where: {
      gameId_entityType_entityKey_source: { gameId, entityType, entityKey, source: SOURCE },
    },
    create: {
      gameId, runId, entityType, entityKey, source: SOURCE, fields: JSON.stringify(fields),
    },
    update: { runId, fields: JSON.stringify(fields), importedAt: new Date() },
  });
}

async function validateRequest(tournamentId: string, weekNumber: number | null) {
  if (!tournamentId.trim()) throw new Error("A tournament id is required");
  if (weekNumber === null) return;
  const weeks = await prisma.week.findMany({
    where: { tournamentId },
    orderBy: { number: "asc" },
  });
  const target = weeks.find((week) => week.number === weekNumber);
  const published = target
    ? await prisma.leagueWeek.count({ where: { weekId: target.id, status: "PUBLISHED" } })
    : 0;
  assertSequentialIngest(
    weekNumber,
    false,
    weeks.map((week) => ({
      number: week.number,
      scheduleReady: Boolean(week.scheduleImportedAt),
      resultsReady: Boolean(week.resultsImportedAt),
    })),
    published > 0,
  );
}

async function ingestTournament({
  tournamentId,
  tournamentName,
  weekNumber,
  runId,
  mode,
}: {
  tournamentId: string;
  tournamentName: string;
  weekNumber: number | null;
  runId: number;
  mode: GamesOfLegendsIngestCounts["mode"];
}): Promise<GamesOfLegendsIngestCounts> {
  const writes = createWriteCounts();
  const matches = await prisma.match.findMany({
    where: {
      tournamentId,
      ...(weekNumber === null ? {} : { week: { number: weekNumber } }),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      games: {
        include: { playerStats: true, teamStats: true, draftActions: true },
      },
    },
  });
  if (matches.length === 0) {
    throw new Error(
      weekNumber === null
        ? `No canonical schedule exists for ${tournamentId}`
        : `No canonical Week ${weekNumber} schedule exists for ${tournamentId}`,
    );
  }
  const tournamentChronology = await prisma.tournament.findMany({
    select: { id: true, seasonOrder: true, dateStart: true },
  });
  const chronologyById = new Map(tournamentChronology.map((tournament) => [tournament.id, tournament]));
  const targetChronology = chronologyById.get(tournamentId);
  const canReplaceCurrentPlayerIdentity = (existingTournamentId: string | null) => {
    if (!existingTournamentId || existingTournamentId === tournamentId) return true;
    const existingChronology = chronologyById.get(existingTournamentId);
    if (!existingChronology || !targetChronology) return false;
    if (existingChronology.seasonOrder > 0 && targetChronology.seasonOrder > 0) {
      return targetChronology.seasonOrder >= existingChronology.seasonOrder;
    }
    if (existingChronology.dateStart && targetChronology.dateStart) {
      return targetChronology.dateStart >= existingChronology.dateStart;
    }
    return false;
  };

  await reportProgress(runId, 3, "Connecting to Games of Legends…");
  const matchListUrl = golTournamentMatchListUrl(tournamentName);
  const sourceSeries = parseGolMatchList(await fetchGolHtml(matchListUrl));
  const sourceByKey = new Map(
    sourceSeries.map((series) => [
      `${series.date}|${teamSetKey(series.team1, series.team2)}`,
      series,
    ]),
  );
  const matchedSourceIds = new Set<string>();
  const pendingScoreboards: PendingScoreboardMatch[] = [];
  const completed: Array<{ match: (typeof matches)[number]; series: GolSeries }> = [];
  for (const match of matches) {
    const key = `${dateKey(match.scheduledAt)}|${teamSetKey(match.team1, match.team2)}`;
    const series = sourceByKey.get(key) ?? null;
    if (!series || !isGolSeriesComplete(series, match.bestOf)) {
      pendingScoreboards.push(pendingSeries(match, series));
      continue;
    }
    matchedSourceIds.add(series.summaryGameId);
    completed.push({ match, series });
  }
  await reportProgress(
    runId,
    6,
    `Found ${completed.length} completed series; ${pendingScoreboards.length} not yet complete`,
  );

  // A final series score is enough to close that Pick'em slate, even when Gol's
  // individual game pages or all-stats tables are still catching up. Persist
  // every completed match-list result before attempting the detailed import so
  // commissioners can open the next week's picks without freezing incomplete
  // fantasy scores.
  for (const { match, series } of completed) {
    const matchData = golSeriesResultForMatch(series, match);
    const key = { id: match.id };
    await writeIfChanged({
      existing: match,
      incoming: matchData,
      counts: writes,
      create: async () => { throw new Error(`Canonical match disappeared: ${match.id}`); },
      update: () => prisma.match.update({ where: key, data: matchData }),
    });
  }

  const knownPlayers = await prisma.proPlayer.findMany();
  const playerIdByIdentity = new Map<string, string>();
  const playerById = new Map(knownPlayers.map((player) => [player.id, player]));
  for (const player of knownPlayers) {
    for (const identity of [normalizeGolIdentity(player.id), normalizeGolIdentity(player.name)]) {
      if (identity && !playerIdByIdentity.has(identity)) playerIdByIdentity.set(identity, player.id);
    }
  }
  const sourcePlayerNames = new Set<string>();

  for (const [seriesIndex, { match, series }] of completed.entries()) {
    await reportProgress(
      runId,
      7 + (seriesIndex / Math.max(completed.length, 1)) * 84,
      `Reading ${match.team1} vs ${match.team2} series summary…`,
    );
    let gameLinks: GolSeriesGame[] = [];
    const parsedGames: ParsedGame[] = [];
    try {
      gameLinks = parseGolSeriesGames(await fetchGolHtml(series.summaryUrl));
      const expectedGames = series.team1Score + series.team2Score;
      if (gameLinks.length !== expectedGames) {
        throw new Error(
          `${match.team1} vs ${match.team2} is scored ${series.team1Score}-${series.team2Score}, ` +
          `but Games of Legends links ${gameLinks.length}/${expectedGames} games`,
        );
      }

      for (const [gameIndex, link] of gameLinks.entries()) {
        const progress = 7 + ((seriesIndex + gameIndex / gameLinks.length) / Math.max(completed.length, 1)) * 84;
        await reportProgress(
          runId,
          progress,
          `Reading ${match.team1} vs ${match.team2}, game ${link.gameNumber} overview…`,
        );
        const overview = parseGolGameOverview(
          await fetchGolHtml(golGameUrl(link.gameId, "game")),
          link.gameId,
        );
        await reportProgress(
          runId,
          progress + 1,
          `Reading ${match.team1} vs ${match.team2}, game ${link.gameNumber} all stats…`,
        );
        const players = parseGolFullStats(
          await fetchGolHtml(golGameUrl(link.gameId, "fullstats")),
          link.gameId,
        );
        const parsed = { link, overview, players };
        assertParsedGameComplete(parsed);
        if (overview.date !== series.date) {
          throw new Error(`Games of Legends game ${link.gameId} date does not match its series`);
        }
        const overviewTeamSet = teamSetKey(overview.teams[0].sourceName, overview.teams[1].sourceName);
        if (overviewTeamSet !== teamSetKey(match.team1, match.team2)) {
          throw new Error(`Games of Legends game ${link.gameId} teams do not match the canonical series`);
        }
        parsedGames.push(parsed);
      }
    } catch (error) {
      if (mode !== "LIVE" || error instanceof IngestionCancelledError) throw error;
      pendingScoreboards.push(pendingDetailedStats(
        match,
        series,
        gameLinks.length,
        parsedGames.length * 10,
        error,
      ));
      continue;
    }

    // Only write after every game page and all-stats table in the series has
    // passed validation. This prevents a partially published series from
    // leaking into live scoring.
    for (const parsed of parsedGames) {
      const existingGame = match.games.find((game) => game.gameNumber === parsed.link.gameNumber) ?? null;
      const gameId = existingGame?.id ?? `gol:${parsed.link.gameId}`;
      const teamsBySide = new Map(parsed.overview.teams.map((team) => [team.side, team]));
      const canonicalTeamBySide = new Map(
        parsed.overview.teams.map((team) => [
          team.side,
          canonicalTeam(team.sourceName, match.team1, match.team2),
        ]),
      );
      // The overview rounds team gold to one decimal thousand (for example
      // 50.1k). The all-stats columns retain exact player gold, so prefer their
      // sum for both team rows and each player's teamGold denominator.
      const exactTeamGoldBySide = new Map(
        (["Blue", "Red"] as const).map((side) => [
          side,
          parsed.players
            .filter((player) => player.side === side)
            .reduce((total, player) => total + requiredStat(player, "Golds"), 0),
        ]),
      );
      const winnerTeam = parsed.overview.teams.find((team) => team.won);
      if (!winnerTeam) throw new Error(`Games of Legends game ${parsed.link.gameId} has no winner`);
      const winner = canonicalTeam(winnerTeam.sourceName, match.team1, match.team2);
      const gameData = {
        matchId: match.id,
        gameNumber: parsed.link.gameNumber,
        winner,
        lengthSec: parsed.overview.lengthSec,
        playedAt: existingGame?.playedAt ?? match.scheduledAt,
        patch: parsed.overview.patch ?? series.patch,
        sourceUrl: golGameUrl(parsed.link.gameId, "game"),
        sourceData: JSON.stringify({
          source: SOURCE,
          golGameId: parsed.link.gameId,
          overview: parsed.overview,
          fullStatsUrl: golGameUrl(parsed.link.gameId, "fullstats"),
        }),
      };
      const gameWrite = await writeIfChanged({
        existing: existingGame,
        incoming: gameData,
        counts: writes,
        create: () => prisma.game.create({ data: { id: gameId, ...gameData } }),
        update: () => prisma.game.update({ where: { id: gameId }, data: gameData }),
      });
      if (gameWrite !== "unchanged") {
        await recordProvenance({
          runId, gameId, entityType: "GAME", entityKey: gameId, fields: Object.keys(gameData),
        });
      }

      for (const team of parsed.overview.teams) {
        const teamId = canonicalTeamBySide.get(team.side)!;
        const opponent = parsed.overview.teams.find((candidate) => candidate.side !== team.side)!;
        const data = {
          teamId,
          side: team.side,
          kills: team.kills,
          deaths: opponent.kills,
          gold: exactTeamGoldBySide.get(team.side)!,
          towers: team.towers,
          turretPlates: team.turretPlates,
          dragons: team.dragons,
          cloudDrakes: team.cloudDrakes,
          infernalDrakes: team.infernalDrakes,
          mountainDrakes: team.mountainDrakes,
          oceanDrakes: team.oceanDrakes,
          hextechDrakes: team.hextechDrakes,
          chemtechDrakes: team.chemtechDrakes,
          elderDragons: team.elderDragons,
          barons: team.barons,
          heralds: team.heralds,
          voidGrubs: team.voidGrubs,
          atakhans: team.atakhans,
          inhibs: team.inhibs,
          firstBlood: team.firstBlood,
          firstDragon: team.firstDragon,
          firstHerald: team.firstHerald,
          firstBaron: team.firstBaron,
          firstTower: team.firstTower,
          sourceData: JSON.stringify({ source: SOURCE, golGameId: parsed.link.gameId, team }),
          won: team.won,
        };
        const existing = existingGame?.teamStats.find((stat) => stat.teamId === teamId) ?? null;
        const key = { gameId_teamId: { gameId, teamId } };
        const write = await writeIfChanged({
          existing,
          incoming: data,
          counts: writes,
          create: () => prisma.teamGameStat.create({ data: { gameId, ...data } }),
          update: () => prisma.teamGameStat.update({ where: key, data }),
        });
        if (write !== "unchanged") {
          await recordProvenance({
            runId, gameId, entityType: "TEAM_GAME", entityKey: teamId, fields: Object.keys(data),
          });
        }
      }

      const playerIdBySideChampion = new Map<string, string>();
      for (const player of parsed.players) {
        sourcePlayerNames.add(normalizeGolIdentity(player.name));
        const teamId = canonicalTeamBySide.get(player.side)!;
        const existingStat = existingGame?.playerStats.find(
          (stat) => stat.teamId === teamId && normalizeGolIdentity(stat.role ?? "") === normalizeGolIdentity(player.role),
        ) ?? null;
        let playerId = existingStat?.playerId ?? playerIdByIdentity.get(normalizeGolIdentity(player.name));
        if (!playerId) {
          playerId = player.name.trim();
          playerIdByIdentity.set(normalizeGolIdentity(player.name), playerId);
        }
        const existingPlayer = playerById.get(playerId) ?? await prisma.proPlayer.findUnique({ where: { id: playerId } });
        const playerData = existingPlayer && !canReplaceCurrentPlayerIdentity(existingPlayer.tournamentId)
          ? { name: existingPlayer.name }
          : { name: player.name, role: player.role, teamId, tournamentId };
        await writeIfChanged({
          existing: existingPlayer,
          incoming: playerData,
          counts: writes,
          create: () => prisma.proPlayer.create({ data: { id: playerId!, ...playerData } }),
          update: () => prisma.proPlayer.update({ where: { id: playerId! }, data: playerData }),
        });
        playerById.set(playerId, { ...(existingPlayer ?? { id: playerId }), ...playerData } as (typeof knownPlayers)[number]);
        playerIdByIdentity.set(normalizeGolIdentity(playerId), playerId);
        playerIdByIdentity.set(normalizeGolIdentity(player.name), playerId);

        const rosterKey = { tournamentId_playerId: { tournamentId, playerId } };
        const existingRoster = await prisma.tournamentPlayer.findUnique({ where: rosterKey });
        const rosterData = { teamId, role: player.role };
        await writeIfChanged({
          existing: existingRoster,
          incoming: rosterData,
          counts: writes,
          create: () => prisma.tournamentPlayer.create({ data: { tournamentId, playerId, ...rosterData } }),
          update: () => prisma.tournamentPlayer.update({
            where: rosterKey,
            data: { ...rosterData, importedAt: new Date() },
          }),
        });

        const team = teamsBySide.get(player.side)!;
        const ownJungle = golStatInt(player, "CS in Team's Jungle");
        const enemyJungle = golStatInt(player, "CS in Enemy Jungle");
        const data = {
          teamId,
          side: player.side,
          champion: player.champion,
          role: player.role,
          kills: requiredStat(player, "Kills"),
          deaths: requiredStat(player, "Deaths"),
          assists: requiredStat(player, "Assists"),
          gold: requiredStat(player, "Golds"),
          cs: requiredStat(player, "CS"),
          ...(ownJungle === null ? {} : { monsterKillsOwnJungle: ownJungle }),
          ...(enemyJungle === null ? {} : { monsterKillsEnemyJungle: enemyJungle }),
          damage: requiredStat(player, "Total damage to Champion"),
          damageToTowers: requiredStat(player, "Damage dealt to turrets"),
          damageTaken: golStatInt(player, "Total damage taken"),
          damageMitigated: requiredStat(player, "Damage self mitigated"),
          totalHeal: golStatInt(player, "Total heal"),
          visionScore: requiredStat(player, "Vision Score"),
          wardsPlaced: golStatInt(player, "Wards placed"),
          wardsKilled: requiredStat(player, "Wards destroyed"),
          controlWardsBought: requiredStat(player, "Control Wards Purchased"),
          doubleKills: golStatInt(player, "Double kills"),
          tripleKills: requiredStat(player, "Triple kills"),
          quadraKills: requiredStat(player, "Quadra kills"),
          pentakills: requiredStat(player, "Penta kills"),
          teamKills: team.kills,
          teamGold: exactTeamGoldBySide.get(player.side)!,
          killParticipation: golStatRatio(player, "KP%") ?? (
            team.kills > 0
              ? (requiredStat(player, "Kills") + requiredStat(player, "Assists")) / team.kills
              : null
          ),
          damageShare: golStatRatio(player, "DMG%"),
          goldShare: golStatRatio(player, "GOLD%"),
          sourceData: JSON.stringify({
            source: SOURCE,
            golGameId: parsed.link.gameId,
            name: player.name,
            champion: player.champion,
            stats: player.stats,
          }),
          won: team.won,
        };
        const statKey = { gameId_playerId: { gameId, playerId } };
        const write = await writeIfChanged({
          existing: existingStat,
          incoming: data,
          counts: writes,
          create: () => prisma.playerGameStat.create({ data: { gameId, playerId, ...data } }),
          update: () => prisma.playerGameStat.update({ where: statKey, data }),
        });
        if (write !== "unchanged") {
          await recordProvenance({
            runId, gameId, entityType: "PLAYER_GAME", entityKey: playerId, fields: Object.keys(data),
          });
        }

        const timelineData = {
          csDiff: requiredStat(player, "CSD@15"),
          goldDiff: requiredStat(player, "GD@15"),
          xpDiff: requiredStat(player, "XPD@15"),
          sourceData: JSON.stringify({
            source: SOURCE,
            golGameId: parsed.link.gameId,
            minute: 15,
            csDiff: golStatInt(player, "CSD@15"),
            goldDiff: golStatInt(player, "GD@15"),
            xpDiff: golStatInt(player, "XPD@15"),
          }),
        };
        const timelineKey = { gameId_playerId_minute: { gameId, playerId, minute: 15 } };
        const existingTimeline = await prisma.playerTimelineSnapshot.findUnique({ where: timelineKey });
        await writeIfChanged({
          existing: existingTimeline,
          incoming: timelineData,
          counts: writes,
          create: () => prisma.playerTimelineSnapshot.create({
            data: { gameId, playerId, minute: 15, ...timelineData },
          }),
          update: () => prisma.playerTimelineSnapshot.update({ where: timelineKey, data: timelineData }),
        });
        playerIdBySideChampion.set(`${player.side}\u0000${player.champion}`, playerId);
      }

      for (const draft of parsed.overview.drafts) {
        const teamId = canonicalTeamBySide.get(draft.side)!;
        for (const action of ["BAN", "PICK"] as const) {
          const champions = action === "BAN" ? draft.bans : draft.picks;
          for (const [index, champion] of champions.entries()) {
            const sequence = index + 1;
            const draftedPlayer = parsed.players.find(
              (player) => player.side === draft.side && player.champion === champion,
            );
            const data = {
              teamId,
              side: draft.side,
              action,
              sequence,
              champion,
              role: action === "PICK" ? draftedPlayer?.role ?? null : null,
              playerId: action === "PICK"
                ? playerIdBySideChampion.get(`${draft.side}\u0000${champion}`) ?? null
                : null,
            };
            const key = { gameId_teamId_action_sequence: { gameId, teamId, action, sequence } };
            const existing = existingGame?.draftActions.find(
              (row) => row.teamId === teamId && row.action === action && row.sequence === sequence,
            ) ?? null;
            await writeIfChanged({
              existing,
              incoming: data,
              counts: writes,
              create: () => prisma.draftAction.create({ data: { gameId, ...data } }),
              update: () => prisma.draftAction.update({ where: key, data }),
            });
          }
        }
      }
    }

  }

  await reportProgress(runId, 94, "Verifying imported Games of Legends rows…");
  const matchScope = {
    tournamentId,
    ...(weekNumber === null ? {} : { week: { number: weekNumber } }),
  };
  const unmatchedSourceSeries = sourceSeries
    .filter((series) => {
      const sourceKey = `${series.date}|${teamSetKey(series.team1, series.team2)}`;
      const inRequestedScope = matches.some((match) =>
        `${dateKey(match.scheduledAt)}|${teamSetKey(match.team1, match.team2)}` === sourceKey,
      );
      return inRequestedScope && isGolSeriesComplete(series) && !matchedSourceIds.has(series.summaryGameId);
    })
    .map((series) => `${series.date} ${series.label}`);
  return {
    mode,
    matches: matches.length,
    completedMatches: completed.length,
    games: await prisma.game.count({ where: { match: matchScope } }),
    players: sourcePlayerNames.size,
    rosterPlayers: await prisma.tournamentPlayer.count({ where: { tournamentId } }),
    playerStats: await prisma.playerGameStat.count({ where: { game: { match: matchScope } } }),
    draftActions: await prisma.draftAction.count({ where: { game: { match: matchScope } } }),
    pendingScoreboards,
    unmatchedSourceSeries,
    writes,
  };
}

export async function runGamesOfLegendsIngest({
  tournamentId,
  weekNumber,
  live = false,
}: {
  tournamentId: string;
  weekNumber: number | null;
  live?: boolean;
}): Promise<GamesOfLegendsIngestCounts> {
  await validateRequest(tournamentId, weekNumber);
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const active = await prisma.ingestionRun.findFirst({
    where: { tournamentId, weekNumber, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    throw new Error(
      `An import for Week ${weekNumber ?? "all"} is already running (started ${active.startedAt.toLocaleString()})`,
    );
  }
  const mode: GamesOfLegendsIngestCounts["mode"] = weekNumber === null ? "BACKFILL" : live ? "LIVE" : "FINAL";
  const source = mode === "BACKFILL"
    ? "GAMES_OF_LEGENDS_BACKFILL"
    : mode === "LIVE"
      ? "GAMES_OF_LEGENDS_LIVE"
      : "GAMES_OF_LEGENDS";
  const run = await prisma.ingestionRun.create({
    data: {
      source,
      tournamentId,
      weekNumber,
      summary: encodeIngestionProgress(1, "Import queued…"),
    },
  });

  try {
    const counts = await ingestTournament({
      tournamentId,
      tournamentName: tournament.name,
      weekNumber,
      runId: run.id,
      mode,
    });
    if (mode === "FINAL" && weekNumber !== null) {
      await reportProgress(run.id, 97, "Validating game, player, team, draft, and advanced stats…");
      const target = await prisma.week.findUnique({
        where: { tournamentId_number: { tournamentId, number: weekNumber } },
        select: { id: true },
      });
      if (target) {
        const validation = await validateWeekData(target.id);
        if (!validation.ok) {
          throw new Error(
            `Week ${weekNumber} results are incomplete (${validation.errors.length} checks failed): ` +
            validation.errors.slice(0, 5).join("; "),
          );
        }
      }
    }
    await prisma.$transaction(async (tx) => {
      const completed = await tx.ingestionRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          rowCount: counts.playerStats,
          summary: JSON.stringify(counts),
        },
      });
      if (completed.count !== 1) throw new IngestionCancelledError();
      if (mode === "FINAL" && weekNumber !== null) {
        await tx.week.update({
          where: { tournamentId_number: { tournamentId, number: weekNumber } },
          data: { resultsImportedAt: new Date() },
        });
      }
    });
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.ingestionRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date(), error: message },
    });
    throw error;
  }
}

async function runCli() {
  const weekArg = process.argv.find((arg) => arg.startsWith("--week="));
  const weekNumber = weekArg ? Number(weekArg.split("=")[1]) : null;
  const live = process.argv.includes("--live");
  if (process.argv.includes("--all-tournaments")) {
    const tournaments = await prisma.tournament.findMany({
      where: { hidden: false },
      orderBy: [{ dateStart: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const tournament of tournaments) {
      console.log(`Backfilling Games of Legends: ${tournament.id}`);
      const counts = await runGamesOfLegendsIngest({
        tournamentId: tournament.id,
        weekNumber: null,
        live: true,
      });
      console.log(counts);
    }
    return;
  }
  const tournamentId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!tournamentId) {
    throw new Error(
      'Usage: npm run ingest:gol -- "<tournament-id>" [--week=N] [--live] | --all-tournaments',
    );
  }
  const counts = await runGamesOfLegendsIngest({ tournamentId, weekNumber, live });
  console.log(counts);
}

const isCliEntry = /[/\\]src[/\\]scripts[/\\]ingest-gol\.ts$/.test(process.argv[1] ?? "");
if (isCliEntry) {
  runCli()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
