// Ingest a tournament from Leaguepedia into the local DB.
// Usage: npx tsx src/scripts/ingest.ts "LCK/2026 Season/Rounds 1-2"

import { cargoQuery, parseUtc, type CargoProgressEvent } from "../lib/leaguepedia";
import { prisma } from "../lib/db";
import { mergeTournamentRosterOverrides } from "../lib/tournament-roster-overrides";
import { validateWeekData } from "../lib/season";
import { assertSequentialIngest } from "../lib/ingest-order";
import { encodeIngestionProgress } from "../lib/ingestion-progress";
import { setCurrentTournament } from "../lib/tournaments";
import { createWriteCounts, writeIfChanged, type WriteCounts } from "../lib/change-aware-write";

const int = (s: string | undefined) => {
  const n = parseInt(s ?? "", 10);
  return isNaN(n) ? null : n;
};

const listJson = (s: string | undefined, delimiter: string) =>
  s ? JSON.stringify(s.split(delimiter).map((v) => v.trim()).filter(Boolean)) : null;

const sideName = (s: string | undefined) =>
  s === "1" || s?.toLowerCase() === "blue"
    ? "Blue"
    : s === "2" || s?.toLowerCase() === "red"
      ? "Red"
      : null;

type CanonicalRole = "Top" | "Jungle" | "Mid" | "Bot" | "Support";

function normalizeRole(value: string | undefined) {
  if (!value) return null;
  const aliases: Record<string, CanonicalRole> = {
    top: "Top", jungle: "Jungle", jungler: "Jungle", mid: "Mid",
    middle: "Mid", bot: "Bot", adc: "Bot", support: "Support", sup: "Support",
  };
  for (const part of value.split(/[;,/]/).map((item) => item.trim().toLowerCase())) {
    if (aliases[part]) return aliases[part];
  }
  return null;
}

export interface LeaguepediaIngestCounts {
  mode?: "SCHEDULE_ONLY" | "LIVE";
  matches: number;
  games: number;
  players: number;
  rosterPlayers: number;
  playerStats: number;
  draftActions: number;
  writes: WriteCounts;
}

class IngestionCancelledError extends Error {
  constructor() {
    super("This import was recovered or cancelled before it completed");
    this.name = "IngestionCancelledError";
  }
}

async function reportIngestionProgress(runId: number, percent: number, message: string) {
  const updated = await prisma.ingestionRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { summary: encodeIngestionProgress(percent, message) },
  });
  if (updated.count !== 1) throw new IngestionCancelledError();
}

async function reportLoopProgress(
  runId: number,
  index: number,
  total: number,
  start: number,
  end: number,
  label: string,
) {
  if (total === 0) return;
  const interval = Math.max(1, Math.ceil(total / 10));
  if (index !== total - 1 && index % interval !== 0) return;
  const completed = index + 1;
  const percent = start + ((end - start) * completed) / total;
  await reportIngestionProgress(runId, percent, `${label} ${completed} of ${total}`);
}

function cargoHeartbeat(runId: number, percent: number, label: string) {
  return async (event: CargoProgressEvent) => {
    if (event.kind === "retry") {
      await reportIngestionProgress(
        runId,
        percent,
        `Leaguepedia rate limit reached; retrying ${label.toLowerCase()} in ${event.retryInSeconds}s`,
      );
      return;
    }
    const page = event.offset > 0 ? ` (page ${Math.floor(event.offset / 500) + 1})` : "";
    await reportIngestionProgress(runId, percent, `${label}${page}…`);
  };
}

async function ingestTournament(
  overviewPage: string,
  weekNumber: number | null,
  runId: number,
  scheduleOnly: boolean,
  live: boolean,
): Promise<LeaguepediaIngestCounts> {
  const esc = overviewPage.replace(/"/g, '\\"');
  const writes = createWriteCounts();
  const knownTeams = new Set(
    (await prisma.proTeam.findMany({ select: { id: true } })).map((team) => team.id),
  );
  const ensureTeam = async (teamId: string) => {
    if (knownTeams.has(teamId)) return;
    await prisma.proTeam.create({ data: { id: teamId } });
    knownTeams.add(teamId);
    writes.created++;
  };

  console.log(`Ingesting: ${overviewPage}`);
  await reportIngestionProgress(runId, 3, "Connecting to Leaguepedia…");

  // 1. Tournament metadata
  await reportIngestionProgress(runId, 5, "Fetching tournament metadata…");
  const [t] = await cargoQuery({
    tables: "Tournaments",
    fields: "Name,OverviewPage,DateStart,Date",
    where: `OverviewPage="${esc}"`,
    onProgress: cargoHeartbeat(runId, 5, "Fetching tournament metadata"),
  });
  if (!t) throw new Error(`Tournament not found: ${overviewPage}`);
  const tournamentData = {
    name: t.Name,
    dateStart: parseUtc(t.DateStart ? `${t.DateStart} 00:00:00` : null),
    dateEnd: parseUtc(t.Date ? `${t.Date} 23:59:59` : null),
  };
  const existingTournament = await prisma.tournament.findUnique({ where: { id: overviewPage } });
  await writeIfChanged({
    existing: existingTournament,
    incoming: tournamentData,
    counts: writes,
    create: () => prisma.tournament.create({ data: { id: overviewPage, ...tournamentData } }),
    update: () => prisma.tournament.update({ where: { id: overviewPage }, data: tournamentData }),
  });
  await reportIngestionProgress(runId, 10, "Tournament metadata saved");

  // Fetch the full slate before the player pool. Upcoming tournament pages can
  // publish their schedule before Leaguepedia fills TournamentPlayers; the
  // teams in this slate let us build a safe current-roster fallback.
  await reportIngestionProgress(runId, 11, "Fetching the match schedule…");
  const scheduleRows = await cargoQuery({
    tables: "MatchSchedule",
    fields:
      "MatchId,Team1,Team2,Winner,Team1Score,Team2Score,DateTime_UTC,BestOf,Tab",
    where: `OverviewPage="${esc}"`,
    orderBy: "DateTime_UTC",
    onProgress: cargoHeartbeat(runId, 11, "Fetching the match schedule"),
  });
  if (scheduleRows.length === 0) throw new Error(`No schedule is published for ${overviewPage}`);

  // Tournament rosters exist before Week 1 is played, so ingest them
  // independently of scoreboard rows. This makes Week 0 drafting possible.
  await reportIngestionProgress(runId, 12, "Fetching tournament player pool…");
  const tournamentRosterRows = await cargoQuery({
    tables: "TournamentPlayers",
    fields: "OverviewPage,Player,Team,Role,N_PlayerInTeam",
    where: `OverviewPage="${esc}"`,
    orderBy: "Team,N_PlayerInTeam",
    onProgress: cargoHeartbeat(runId, 12, "Fetching tournament player pool"),
  });
  let rosterPlayers = tournamentRosterRows.map((player) => ({
    Player: player.Player,
    Name: player.Player,
    Team: player.Team,
    Role: normalizeRole(player.Role),
  }));

  if (rosterPlayers.length === 0) {
    const scheduleTeams = [...new Set(
      scheduleRows.flatMap((match) => [match.Team1, match.Team2]).filter(Boolean),
    )];
    const teamFilter = scheduleTeams
      .map((team) => `Team="${team.replace(/"/g, '\\"')}"`)
      .join(" OR ");
    await reportIngestionProgress(runId, 14, "Tournament roster pending; fetching current team rosters…");
    const currentPlayers = await cargoQuery({
      tables: "Players",
      fields: "OverviewPage,Player,Name,Team,RoleLast",
      where: `(${teamFilter})`,
      orderBy: "Team,RoleLast,Player",
      onProgress: cargoHeartbeat(runId, 14, "Fetching current team rosters"),
    });
    rosterPlayers = currentPlayers.map((player) => ({
      Player: player.OverviewPage || player.Player,
      Name: player.Player || player.Name || player.OverviewPage,
      Team: player.Team,
      Role: normalizeRole(player.RoleLast),
    })).filter((player) => player.Player && player.Team && player.Role);
  }
  rosterPlayers = mergeTournamentRosterOverrides(overviewPage, rosterPlayers)
    .map((player) => ({ ...player, Role: normalizeRole(player.Role ?? undefined) }))
    .filter((player) => player.Player && player.Team && player.Role);
  console.log(`  tournament roster players: ${rosterPlayers.length}`);
  for (const [index, player] of rosterPlayers.entries()) {
    await reportLoopProgress(runId, index, rosterPlayers.length, 15, 28, "Saving eligible players");
    if (!player.Player) continue;
    if (player.Team) await ensureTeam(player.Team);
    const proPlayerData = {
      name: player.Name || player.Player,
      role: player.Role || null,
      teamId: player.Team || null,
      tournamentId: overviewPage,
    };
    const existingPlayer = await prisma.proPlayer.findUnique({ where: { id: player.Player } });
    await writeIfChanged({
      existing: existingPlayer,
      incoming: proPlayerData,
      counts: writes,
      create: () => prisma.proPlayer.create({ data: { id: player.Player, ...proPlayerData } }),
      update: () => prisma.proPlayer.update({ where: { id: player.Player }, data: proPlayerData }),
    });
    const tournamentPlayerKey = {
      tournamentId_playerId: { tournamentId: overviewPage, playerId: player.Player },
    };
    const tournamentPlayerData = { teamId: player.Team || null, role: player.Role || null };
    const existingRosterPlayer = await prisma.tournamentPlayer.findUnique({ where: tournamentPlayerKey });
    await writeIfChanged({
      existing: existingRosterPlayer,
      incoming: tournamentPlayerData,
      counts: writes,
      create: () => prisma.tournamentPlayer.create({
        data: { tournamentId: overviewPage, playerId: player.Player, ...tournamentPlayerData },
      }),
      update: () => prisma.tournamentPlayer.update({
        where: tournamentPlayerKey,
        data: { ...tournamentPlayerData, importedAt: new Date() },
      }),
    });
  }

  // 2. Match schedule (also defines weeks via the Tab field, e.g. "Week 10")
  await reportIngestionProgress(runId, 30, "Saving the match schedule…");
  const allTabs = [...new Set(scheduleRows.map((m) => m.Tab).filter(Boolean))];
  const selectedTab = weekNumber === null ? null : allTabs[weekNumber - 1];
  if (weekNumber !== null && !selectedTab) throw new Error(`Week ${weekNumber} does not exist`);
  const schedule = selectedTab ? scheduleRows.filter((m) => m.Tab === selectedTab) : scheduleRows;
  console.log(`  matches in schedule: ${schedule.length}`);
  await reportIngestionProgress(runId, 38, `Found ${schedule.length} scheduled matches`);

  // Weeks: one per distinct Tab, numbered in chronological order
  const tabs = selectedTab ? [selectedTab] : allTabs;
  const weekIdByTab = new Map<string, number>();
  for (const [i, tab] of tabs.entries()) {
    const inTab = schedule.filter((m) => m.Tab === tab);
    const dates = inTab
      .map((m) => parseUtc(m.DateTime_UTC))
      .filter((d): d is Date => d !== null);
    if (dates.length === 0) continue;
    const startsAt = new Date(Math.min(...dates.map((d) => d.getTime())));
    const endsAt = new Date(Math.max(...dates.map((d) => d.getTime())));
    const number = selectedTab ? weekNumber! : i + 1;
    const weekKey = { tournamentId_number: { tournamentId: overviewPage, number } };
    const weekData = { sourceLabel: tab, startsAt, endsAt };
    const existingWeek = await prisma.week.findUnique({ where: weekKey });
    await writeIfChanged({
      existing: existingWeek,
      incoming: weekData,
      counts: writes,
      create: () => prisma.week.create({
        data: { tournamentId: overviewPage, number, ...weekData },
      }),
      update: () => prisma.week.update({ where: weekKey, data: weekData }),
    });
    const week = await prisma.week.findUniqueOrThrow({ where: weekKey });
    weekIdByTab.set(tab, week.id);
  }

  for (const [index, m] of schedule.entries()) {
    await reportLoopProgress(runId, index, schedule.length, 40, scheduleOnly ? 90 : 46, "Saving matches");
    const scheduledAt = parseUtc(m.DateTime_UTC);
    if (!m.MatchId || !scheduledAt) continue;
    const winner = scheduleOnly ? null :
      m.Winner === "1" ? m.Team1 : m.Winner === "2" ? m.Team2 : null;
    const baseData = {
      tournamentId: overviewPage,
      weekId: weekIdByTab.get(m.Tab) ?? null,
      team1: m.Team1,
      team2: m.Team2,
      bestOf: int(m.BestOf) ?? 3,
      scheduledAt,
    };
    const resultData = {
      winner,
      team1Score: int(m.Team1Score),
      team2Score: int(m.Team2Score),
    };
    // A schedule refresh must never erase results already captured by a live
    // refresh. Result fields are included only in full/live ingestion updates.
    const createData = {
      ...baseData,
      winner: scheduleOnly ? null : resultData.winner,
      team1Score: scheduleOnly ? null : resultData.team1Score,
      team2Score: scheduleOnly ? null : resultData.team2Score,
    };
    const updateData = scheduleOnly ? baseData : { ...baseData, ...resultData };
    const existingMatch = await prisma.match.findUnique({ where: { id: m.MatchId } });
    await writeIfChanged({
      existing: existingMatch,
      incoming: updateData,
      counts: writes,
      create: () => prisma.match.create({ data: { id: m.MatchId, ...createData } }),
      update: () => prisma.match.update({ where: { id: m.MatchId }, data: updateData }),
    });
  }

  if (scheduleOnly) {
    await reportIngestionProgress(runId, 96, "Finalizing schedule and player counts…");
    const counts: LeaguepediaIngestCounts = {
      mode: "SCHEDULE_ONLY",
      matches: schedule.length,
      games: 0,
      players: 0,
      rosterPlayers: new Set(rosterPlayers.map((row) => row.Player).filter(Boolean)).size,
      playerStats: 0,
      draftActions: 0,
      writes,
    };
    console.log("Done:", counts);
    return counts;
  }

  // 3. Games + team-level stats
  await reportIngestionProgress(runId, 48, "Fetching completed games and team statistics…");
  const gameRows = await cargoQuery({
    tables: "ScoreboardGames",
    fields:
      "GameId,MatchId,Team1,Team2,WinTeam,Gamelength_Number,DateTime_UTC,N_GameInMatch,Patch,LegacyPatch," +
      "MatchHistory,VOD,RiotPlatformGameId,RiotPlatformId,RiotGameId,Team1Gold,Team2Gold," +
      "Team1Kills,Team2Kills,Team1Towers,Team2Towers,Team1Dragons,Team2Dragons," +
      "Team1Clouds,Team2Clouds,Team1Infernals,Team2Infernals,Team1Mountains,Team2Mountains," +
      "Team1Oceans,Team2Oceans,Team1Hextechs,Team2Hextechs,Team1Chemtechs,Team2Chemtechs," +
      "Team1Elders,Team2Elders,Team1Barons,Team2Barons,Team1RiftHeralds,Team2RiftHeralds," +
      "Team1VoidGrubs,Team2VoidGrubs,Team1Atakhans,Team2Atakhans," +
      "Team1Inhibitors,Team2Inhibitors",
    where: `OverviewPage="${esc}"`,
    orderBy: "DateTime_UTC",
    onProgress: cargoHeartbeat(runId, 48, "Fetching completed games and team statistics"),
  });
  const selectedMatchIds = new Set(schedule.map((m) => m.MatchId));
  const games = weekNumber === null ? gameRows : gameRows.filter((g) => selectedMatchIds.has(g.MatchId));
  console.log(`  games played: ${games.length}`);

  for (const [index, g] of games.entries()) {
    await reportLoopProgress(runId, index, games.length, 52, 64, "Saving games");
    if (!g.GameId || !g.MatchId) continue;
    const match = await prisma.match.findUnique({ where: { id: g.MatchId } });
    if (!match) {
      console.warn(`  ! game ${g.GameId} references unknown match ${g.MatchId}`);
      continue;
    }
    const lengthMin = parseFloat(g.Gamelength_Number ?? "");
    const gameData = {
      matchId: g.MatchId,
      gameNumber: int(g.N_GameInMatch) ?? 1,
      winner: g.WinTeam || null,
      lengthSec: isNaN(lengthMin) ? null : Math.round(lengthMin * 60),
      playedAt: parseUtc(g.DateTime_UTC),
      patch: g.Patch || g.LegacyPatch || null,
      sourceUrl: g.MatchHistory || null,
      vodUrl: g.VOD || null,
      riotPlatformGameId: g.RiotPlatformGameId || null,
      riotPlatformId: g.RiotPlatformId || null,
      riotGameId: g.RiotGameId || null,
      sourceData: JSON.stringify(g),
    };
    const existingGame = await prisma.game.findUnique({ where: { id: g.GameId } });
    const gameWrite = await writeIfChanged({
      existing: existingGame,
      incoming: gameData,
      counts: writes,
      create: () => prisma.game.create({ data: { id: g.GameId, ...gameData } }),
      update: () => prisma.game.update({ where: { id: g.GameId }, data: gameData }),
    });
    if (gameWrite !== "unchanged") {
      await prisma.statProvenance.upsert({
        where: { gameId_entityType_entityKey_source: { gameId: g.GameId, entityType: "GAME", entityKey: g.GameId, source: "LEAGUEPEDIA" } },
        create: { gameId: g.GameId, runId, entityType: "GAME", entityKey: g.GameId, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(gameData)) },
        update: { runId, fields: JSON.stringify(Object.keys(gameData)), importedAt: new Date() },
      });
    }

    for (const side of [1, 2] as const) {
      const teamId = side === 1 ? g.Team1 : g.Team2;
      if (!teamId) continue;
      await ensureTeam(teamId);
      const stat = {
        teamId,
        side: side === 1 ? "Blue" : "Red",
        kills: int(g[`Team${side}Kills`]),
        gold: int(g[`Team${side}Gold`]),
        towers: int(g[`Team${side}Towers`]),
        dragons: int(g[`Team${side}Dragons`]),
        cloudDrakes: int(g[`Team${side}Clouds`]),
        infernalDrakes: int(g[`Team${side}Infernals`]),
        mountainDrakes: int(g[`Team${side}Mountains`]),
        oceanDrakes: int(g[`Team${side}Oceans`]),
        hextechDrakes: int(g[`Team${side}Hextechs`]),
        chemtechDrakes: int(g[`Team${side}Chemtechs`]),
        elderDragons: int(g[`Team${side}Elders`]),
        barons: int(g[`Team${side}Barons`]),
        heralds: int(g[`Team${side}RiftHeralds`]),
        voidGrubs: int(g[`Team${side}VoidGrubs`]),
        atakhans: int(g[`Team${side}Atakhans`]),
        inhibs: int(g[`Team${side}Inhibitors`]),
        sourceData: JSON.stringify(g),
        won: g.WinTeam === teamId,
      };
      const teamStatKey = { gameId_teamId: { gameId: g.GameId, teamId } };
      const existingTeamStat = await prisma.teamGameStat.findUnique({ where: teamStatKey });
      const teamStatWrite = await writeIfChanged({
        existing: existingTeamStat,
        incoming: stat,
        counts: writes,
        create: () => prisma.teamGameStat.create({ data: { gameId: g.GameId, ...stat } }),
        update: () => prisma.teamGameStat.update({ where: teamStatKey, data: stat }),
      });
      if (teamStatWrite !== "unchanged") {
        await prisma.statProvenance.upsert({
          where: { gameId_entityType_entityKey_source: { gameId: g.GameId, entityType: "TEAM_GAME", entityKey: teamId, source: "LEAGUEPEDIA" } },
          create: { gameId: g.GameId, runId, entityType: "TEAM_GAME", entityKey: teamId, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(stat)) },
          update: { runId, fields: JSON.stringify(Object.keys(stat)), importedAt: new Date() },
        });
      }
    }
  }

  // 4. Per-player stats (also builds the player pool)
  await reportIngestionProgress(runId, 66, "Fetching player game statistics…");
  const allPlayerRows = await cargoQuery({
    tables: "ScoreboardPlayers",
    fields:
      "GameId,Link,Name,Team,Side,Champion,IngameRole,Kills,Deaths,Assists,Gold,CS," +
      "DamageToChampions,VisionScore,PlayerWin,SummonerSpells,Items,Trinket," +
      "PrimaryTree,SecondaryTree,KeystoneRune,Pentakills,TeamKills,TeamGold",
    where: `OverviewPage="${esc}"`,
    onProgress: cargoHeartbeat(runId, 66, "Fetching player game statistics"),
  });
  const selectedGameIds = new Set(games.map((g) => g.GameId));
  const playerRows = weekNumber === null ? allPlayerRows : allPlayerRows.filter((p) => selectedGameIds.has(p.GameId));
  console.log(`  player game lines: ${playerRows.length}`);

  const damageByGameTeam = new Map<string, number>();
  const playerByGameTeamChampion = new Map<string, string>();
  for (const p of playerRows) {
    const key = `${p.GameId}\u0000${p.Team}`;
    damageByGameTeam.set(key, (damageByGameTeam.get(key) ?? 0) + (int(p.DamageToChampions) ?? 0));
    if (p.GameId && p.Team && p.Champion && p.Link) {
      playerByGameTeamChampion.set(`${key}\u0000${p.Champion}`, p.Link);
    }
  }

  for (const [index, p] of playerRows.entries()) {
    await reportLoopProgress(runId, index, playerRows.length, 70, 84, "Saving player stat lines");
    if (!p.GameId || !p.Link) continue;
    const game = await prisma.game.findUnique({ where: { id: p.GameId } });
    if (!game) continue;
    if (p.Team) await ensureTeam(p.Team);
    const proPlayerData = {
      name: p.Name || p.Link,
      role: (normalizeRole(p.IngameRole) ?? p.IngameRole) || null,
      teamId: p.Team || null,
      tournamentId: overviewPage,
    };
    const existingPlayer = await prisma.proPlayer.findUnique({ where: { id: p.Link } });
    await writeIfChanged({
      existing: existingPlayer,
      incoming: proPlayerData,
      counts: writes,
      create: () => prisma.proPlayer.create({ data: { id: p.Link, ...proPlayerData } }),
      update: () => prisma.proPlayer.update({ where: { id: p.Link }, data: proPlayerData }),
    });
    // Scoreboard rows are authoritative evidence that a substitute belongs to
    // this tournament, even when TournamentPlayers has not been updated yet.
    const tournamentPlayerKey = {
      tournamentId_playerId: { tournamentId: overviewPage, playerId: p.Link },
    };
    const tournamentPlayerData = {
      teamId: p.Team || null,
      role: (normalizeRole(p.IngameRole) ?? p.IngameRole) || null,
    };
    const existingRosterPlayer = await prisma.tournamentPlayer.findUnique({ where: tournamentPlayerKey });
    await writeIfChanged({
      existing: existingRosterPlayer,
      incoming: tournamentPlayerData,
      counts: writes,
      create: () => prisma.tournamentPlayer.create({
        data: { tournamentId: overviewPage, playerId: p.Link, ...tournamentPlayerData },
      }),
      update: () => prisma.tournamentPlayer.update({
        where: tournamentPlayerKey,
        data: { ...tournamentPlayerData, importedAt: new Date() },
      }),
    });
    const stat = {
      teamId: p.Team ?? "",
      side: sideName(p.Side),
      champion: p.Champion ?? "",
      role: p.IngameRole || null,
      kills: int(p.Kills) ?? 0,
      deaths: int(p.Deaths) ?? 0,
      assists: int(p.Assists) ?? 0,
      gold: int(p.Gold),
      cs: int(p.CS),
      damage: int(p.DamageToChampions),
      visionScore: int(p.VisionScore),
      pentakills: int(p.Pentakills),
      summonerSpells: listJson(p.SummonerSpells, ","),
      items: listJson(p.Items, ";"),
      trinket: p.Trinket || null,
      primaryRuneTree: p.PrimaryTree || null,
      secondaryRuneTree: p.SecondaryTree || null,
      keystoneRune: p.KeystoneRune || null,
      teamKills: int(p.TeamKills),
      teamGold: int(p.TeamGold),
      killParticipation:
        int(p.TeamKills) && int(p.TeamKills)! > 0
          ? ((int(p.Kills) ?? 0) + (int(p.Assists) ?? 0)) / int(p.TeamKills)!
          : null,
      goldShare:
        int(p.TeamGold) && int(p.TeamGold)! > 0 && int(p.Gold) !== null
          ? int(p.Gold)! / int(p.TeamGold)!
          : null,
      damageShare:
        damageByGameTeam.get(`${p.GameId}\u0000${p.Team}`) && int(p.DamageToChampions) !== null
          ? int(p.DamageToChampions)! / damageByGameTeam.get(`${p.GameId}\u0000${p.Team}`)!
          : null,
      sourceData: JSON.stringify(p),
      won: p.PlayerWin === "Yes",
    };
    const playerStatKey = { gameId_playerId: { gameId: p.GameId, playerId: p.Link } };
    const existingPlayerStat = await prisma.playerGameStat.findUnique({ where: playerStatKey });
    const playerStatWrite = await writeIfChanged({
      existing: existingPlayerStat,
      incoming: stat,
      counts: writes,
      create: () => prisma.playerGameStat.create({ data: { gameId: p.GameId, playerId: p.Link, ...stat } }),
      update: () => prisma.playerGameStat.update({ where: playerStatKey, data: stat }),
    });
    if (playerStatWrite !== "unchanged") {
      await prisma.statProvenance.upsert({
        where: { gameId_entityType_entityKey_source: { gameId: p.GameId, entityType: "PLAYER_GAME", entityKey: p.Link, source: "LEAGUEPEDIA" } },
        create: { gameId: p.GameId, runId, entityType: "PLAYER_GAME", entityKey: p.Link, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(stat)) },
        update: { runId, fields: JSON.stringify(Object.keys(stat)), importedAt: new Date() },
      });
    }
  }

  // 5. Ordered champion draft. This table records each side's pick/ban order
  // and role assignment, which ScoreboardGames' comma-separated lists lose.
  await reportIngestionProgress(runId, 86, "Fetching champion picks and bans…");
  const allDrafts = await cargoQuery({
    tables: "PicksAndBansS7",
    fields:
      "GameId,Team1,Team2,Team1Ban1,Team1Ban2,Team1Ban3,Team1Ban4,Team1Ban5," +
      "Team2Ban1,Team2Ban2,Team2Ban3,Team2Ban4,Team2Ban5," +
      "Team1Pick1,Team1Pick2,Team1Pick3,Team1Pick4,Team1Pick5," +
      "Team2Pick1,Team2Pick2,Team2Pick3,Team2Pick4,Team2Pick5," +
      "Team1Role1,Team1Role2,Team1Role3,Team1Role4,Team1Role5," +
      "Team2Role1,Team2Role2,Team2Role3,Team2Role4,Team2Role5",
    where: `OverviewPage="${esc}" AND IsFilled=1`,
    onProgress: cargoHeartbeat(runId, 86, "Fetching champion picks and bans"),
  });
  const drafts = weekNumber === null ? allDrafts : allDrafts.filter((d) => selectedGameIds.has(d.GameId));
  console.log(`  completed drafts: ${drafts.length}`);
  for (const [index, d] of drafts.entries()) {
    await reportLoopProgress(runId, index, drafts.length, 89, 95, "Saving game drafts");
    if (!d.GameId) continue;
    const game = await prisma.game.findUnique({ where: { id: d.GameId } });
    if (!game) continue;
    for (const side of [1, 2] as const) {
      const teamId = d[`Team${side}`];
      if (!teamId) continue;
      for (const action of ["BAN", "PICK"] as const) {
        for (let sequence = 1; sequence <= 5; sequence++) {
          const champion = d[`Team${side}${action === "BAN" ? "Ban" : "Pick"}${sequence}`];
          if (!champion) continue;
          const data = {
            teamId,
            side: side === 1 ? "Blue" : "Red",
            action,
            sequence,
            champion,
            role: action === "PICK" ? d[`Team${side}Role${sequence}`] || null : null,
            playerId:
              action === "PICK"
                ? playerByGameTeamChampion.get(`${d.GameId}\u0000${teamId}\u0000${champion}`) ?? null
                : null,
          };
          const draftKey = {
            gameId_teamId_action_sequence: { gameId: d.GameId, teamId, action, sequence },
          };
          const existingDraft = await prisma.draftAction.findUnique({ where: draftKey });
          await writeIfChanged({
            existing: existingDraft,
            incoming: data,
            counts: writes,
            create: () => prisma.draftAction.create({ data: { gameId: d.GameId, ...data } }),
            update: () => prisma.draftAction.update({ where: draftKey, data }),
          });
        }
      }
    }
  }

  // Summary
  await reportIngestionProgress(runId, 97, "Verifying imported row counts…");
  const matchScope = {
    tournamentId: overviewPage,
    ...(weekNumber === null ? {} : { week: { number: weekNumber } }),
  };
  const counts: LeaguepediaIngestCounts = {
    ...(live ? { mode: "LIVE" as const } : {}),
    matches: await prisma.match.count({ where: matchScope }),
    games: await prisma.game.count({
      where: { match: matchScope },
    }),
    players: new Set(playerRows.map((row) => row.Link).filter(Boolean)).size,
    rosterPlayers: new Set(rosterPlayers.map((row) => row.Player).filter(Boolean)).size,
    playerStats: await prisma.playerGameStat.count({
      where: { game: { match: matchScope } },
    }),
    draftActions: await prisma.draftAction.count({
      where: { game: { match: matchScope } },
    }),
    writes,
  };

  console.log(`Done:`, counts);
  return counts;
}

async function validateIngestRequest(
  overviewPage: string,
  weekNumber: number | null,
  scheduleOnly: boolean,
) {
  if (!overviewPage.trim()) throw new Error("A Leaguepedia tournament page is required");
  if (weekNumber !== null && (!Number.isInteger(weekNumber) || weekNumber < 1)) {
    throw new Error("The ingest week must be a positive whole number");
  }

  if (weekNumber !== null) {
    const weeks = await prisma.week.findMany({ where: { tournamentId: overviewPage }, orderBy: { number: "asc" } });
    const target = weeks.find((week) => week.number === weekNumber);
    const published = !scheduleOnly && target ? await prisma.leagueWeek.count({ where: { weekId: target.id, status: "PUBLISHED" } }) : 0;
    assertSequentialIngest(weekNumber, scheduleOnly, weeks.map((week) => ({ number: week.number, scheduleReady: Boolean(week.scheduleImportedAt), resultsReady: Boolean(week.resultsImportedAt) })), published > 0);
  }
}

export async function runLeaguepediaIngest({
  overviewPage,
  weekNumber,
  scheduleOnly = false,
  live = false,
  markCurrent = false,
}: {
  overviewPage: string;
  weekNumber: number | null;
  scheduleOnly?: boolean;
  live?: boolean;
  markCurrent?: boolean;
}): Promise<LeaguepediaIngestCounts> {
  if (live && scheduleOnly) throw new Error("A live refresh cannot be schedule-only");
  if (live && weekNumber === null) throw new Error("A live refresh requires a week number");
  await validateIngestRequest(overviewPage, weekNumber, scheduleOnly);

  const active = await prisma.ingestionRun.findFirst({
    where: { tournamentId: overviewPage, weekNumber, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    throw new Error(
      `An import for Week ${weekNumber ?? "all"} is already running (started ${active.startedAt.toLocaleString()})`,
    );
  }

  const run = await prisma.ingestionRun.create({
    data: {
      source: scheduleOnly ? "LEAGUEPEDIA_SCHEDULE" : live ? "LEAGUEPEDIA_LIVE" : "LEAGUEPEDIA",
      tournamentId: overviewPage,
      weekNumber,
      summary: encodeIngestionProgress(1, "Import queued…"),
    },
  });

  try {
    const counts = await ingestTournament(overviewPage, weekNumber, run.id, scheduleOnly, live);

    if (markCurrent) {
      await reportIngestionProgress(run.id, 97, "Updating the current/past season catalog…");
      await setCurrentTournament(overviewPage);
    }

    if (!scheduleOnly && !live && weekNumber !== null) {
      await reportIngestionProgress(run.id, 98, "Validating game, player, team, and draft data…");
      const target = await prisma.week.findUnique({ where: { tournamentId_number: { tournamentId: overviewPage, number: weekNumber } }, select: { id: true } });
      if (target) {
        const validation = await validateWeekData(target.id);
        if (!validation.ok) {
          const details = validation.errors.slice(0, 5).join("; ");
          throw new Error(
            `Week ${weekNumber} results are incomplete (${validation.errors.length} checks failed): ${details}`,
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      const completed = await tx.ingestionRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { status: "SUCCEEDED", completedAt: new Date(), rowCount: counts.playerStats, summary: JSON.stringify(counts) },
      });
      if (completed.count !== 1) throw new IngestionCancelledError();
      if (!scheduleOnly && !live && weekNumber !== null) {
        await tx.week.update({
          where: { tournamentId_number: { tournamentId: overviewPage, number: weekNumber } },
          data: { resultsImportedAt: new Date() },
        });
      } else if (scheduleOnly && weekNumber !== null) {
        await tx.week.update({
          where: { tournamentId_number: { tournamentId: overviewPage, number: weekNumber } },
          data: { scheduleImportedAt: new Date() },
        });
      } else if (!live && weekNumber === null) {
        await tx.week.updateMany({
          where: { tournamentId: overviewPage },
          data: {
            scheduleImportedAt: new Date(),
            ...(!scheduleOnly ? { resultsImportedAt: new Date() } : {}),
          },
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
  const overviewPage = process.argv[2];
  const weekArg = process.argv.find((arg) => arg.startsWith("--week="));
  const weekNumber = weekArg ? Number(weekArg.split("=")[1]) : null;
  const scheduleOnly = process.argv.includes("--schedule-only");
  const live = process.argv.includes("--live");
  const markCurrent = process.argv.includes("--current-season");
  if (!overviewPage) {
    throw new Error('Usage: npm run ingest -- "<Leaguepedia OverviewPage>" [--week=N] [--schedule-only|--live] [--current-season]');
  }
  await runLeaguepediaIngest({ overviewPage, weekNumber, scheduleOnly, live, markCurrent });
}

const isCliEntry = /[/\\]src[/\\]scripts[/\\]ingest\.ts$/.test(process.argv[1] ?? "");
if (isCliEntry) {
  runCli()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
