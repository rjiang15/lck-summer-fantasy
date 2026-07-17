// Ingest a tournament from Leaguepedia into the local DB.
// Usage: npx tsx src/scripts/ingest.ts "LCK/2026 Season/Rounds 1-2"

import { cargoQuery, parseUtc } from "../lib/leaguepedia";
import { prisma } from "../lib/db";
import { assertSequentialIngest } from "../lib/ingest-order";
import { ensureLeagueWeeks, validateLeagueWeek } from "../lib/season";

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

async function syncLeagueWeeksForTournament(overviewPage: string) {
  const leagues = await prisma.league.findMany({ where: { tournamentId: overviewPage } });
  for (const league of leagues) {
    const leagueWeeks = await ensureLeagueWeeks(league.id);
    const target = leagueWeeks.find((row) => row.week.number === league.currentWeek + 1);
    const alreadyOpen = leagueWeeks.some((row) => row.status === "OPEN");
    if (target?.status === "UPCOMING" && !alreadyOpen) {
      await prisma.leagueWeek.update({
        where: { id: target.id },
        data: { status: "OPEN", picksOpenAt: new Date() },
      });
    }
  }
}

export interface LeaguepediaIngestCounts {
  mode?: "SCHEDULE_ONLY";
  matches: number;
  games: number;
  players: number;
  rosterPlayers: number;
  playerStats: number;
  draftActions: number;
}

async function ingestTournament(
  overviewPage: string,
  weekNumber: number | null,
  runId: number,
  scheduleOnly: boolean,
): Promise<LeaguepediaIngestCounts> {
  const esc = overviewPage.replace(/"/g, '\\"');

  if (scheduleOnly) {
    if (weekNumber === null) throw new Error("--schedule-only requires --week=N");
  }

  console.log(`Ingesting: ${overviewPage}`);

  // 1. Tournament metadata
  const [t] = await cargoQuery({
    tables: "Tournaments",
    fields: "Name,OverviewPage,DateStart,Date",
    where: `OverviewPage="${esc}"`,
  });
  if (!t) throw new Error(`Tournament not found: ${overviewPage}`);
  await prisma.tournament.upsert({
    where: { id: overviewPage },
    create: {
      id: overviewPage,
      name: t.Name,
      dateStart: parseUtc(t.DateStart ? `${t.DateStart} 00:00:00` : null),
      dateEnd: parseUtc(t.Date ? `${t.Date} 23:59:59` : null),
    },
    update: { name: t.Name },
  });

  // Tournament rosters exist before Week 1 is played, so ingest them
  // independently of scoreboard rows. This makes Week 0 drafting possible.
  const rosterPlayers = await cargoQuery({
    tables: "TournamentPlayers",
    fields: "OverviewPage,Player,Team,Role,N_PlayerInTeam",
    where: `OverviewPage="${esc}"`,
    orderBy: "Team,N_PlayerInTeam",
  });
  console.log(`  tournament roster players: ${rosterPlayers.length}`);
  for (const player of rosterPlayers) {
    if (!player.Player) continue;
    if (player.Team) {
      await prisma.proTeam.upsert({
        where: { id: player.Team },
        create: { id: player.Team },
        update: {},
      });
    }
    await prisma.proPlayer.upsert({
      where: { id: player.Player },
      create: {
        id: player.Player,
        name: player.Player,
        role: player.Role || null,
        teamId: player.Team || null,
        tournamentId: overviewPage,
      },
      update: {
        name: player.Player,
        role: player.Role || null,
        teamId: player.Team || null,
        tournamentId: overviewPage,
      },
    });
  }

  // 2. Match schedule (also defines weeks via the Tab field, e.g. "Week 1")
  const scheduleRows = await cargoQuery({
    tables: "MatchSchedule",
    fields:
      "MatchId,Team1,Team2,Winner,Team1Score,Team2Score,DateTime_UTC,BestOf,Tab",
    where: `OverviewPage="${esc}"`,
    orderBy: "DateTime_UTC",
  });
  const allTabs = [...new Set(scheduleRows.map((m) => m.Tab).filter(Boolean))];
  const selectedTab = weekNumber === null ? null : allTabs[weekNumber - 1];
  if (weekNumber !== null && !selectedTab) throw new Error(`Week ${weekNumber} does not exist`);
  const schedule = selectedTab ? scheduleRows.filter((m) => m.Tab === selectedTab) : scheduleRows;
  console.log(`  matches in schedule: ${schedule.length}`);

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
    const week = await prisma.week.upsert({
      where: {
        tournamentId_number: { tournamentId: overviewPage, number: selectedTab ? weekNumber! : i + 1 },
      },
      create: { tournamentId: overviewPage, number: selectedTab ? weekNumber! : i + 1, startsAt, endsAt },
      update: { startsAt, endsAt },
    });
    weekIdByTab.set(tab, week.id);
  }

  for (const m of schedule) {
    const scheduledAt = parseUtc(m.DateTime_UTC);
    if (!m.MatchId || !scheduledAt) continue;
    const winner = scheduleOnly ? null :
      m.Winner === "1" ? m.Team1 : m.Winner === "2" ? m.Team2 : null;
    const data = {
      tournamentId: overviewPage,
      weekId: weekIdByTab.get(m.Tab) ?? null,
      team1: m.Team1,
      team2: m.Team2,
      bestOf: int(m.BestOf) ?? 3,
      scheduledAt,
      winner,
      team1Score: scheduleOnly ? null : int(m.Team1Score),
      team2Score: scheduleOnly ? null : int(m.Team2Score),
    };
    await prisma.match.upsert({
      where: { id: m.MatchId },
      create: { id: m.MatchId, ...data },
      update: data,
    });
  }

  if (scheduleOnly) {
    await syncLeagueWeeksForTournament(overviewPage);
    const counts: LeaguepediaIngestCounts = {
      mode: "SCHEDULE_ONLY",
      matches: schedule.length,
      games: 0,
      players: 0,
      rosterPlayers: new Set(rosterPlayers.map((row) => row.Player).filter(Boolean)).size,
      playerStats: 0,
      draftActions: 0,
    };
    console.log("Done:", counts);
    return counts;
  }

  // 3. Games + team-level stats
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
  });
  const selectedMatchIds = new Set(schedule.map((m) => m.MatchId));
  const games = weekNumber === null ? gameRows : gameRows.filter((g) => selectedMatchIds.has(g.MatchId));
  console.log(`  games played: ${games.length}`);

  for (const g of games) {
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
    await prisma.game.upsert({
      where: { id: g.GameId },
      create: { id: g.GameId, ...gameData },
      update: gameData,
    });
    await prisma.statProvenance.upsert({
      where: { gameId_entityType_entityKey_source: { gameId: g.GameId, entityType: "GAME", entityKey: g.GameId, source: "LEAGUEPEDIA" } },
      create: { gameId: g.GameId, runId, entityType: "GAME", entityKey: g.GameId, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(gameData)) },
      update: { runId, fields: JSON.stringify(Object.keys(gameData)), importedAt: new Date() },
    });

    for (const side of [1, 2] as const) {
      const teamId = side === 1 ? g.Team1 : g.Team2;
      if (!teamId) continue;
      await prisma.proTeam.upsert({
        where: { id: teamId },
        create: { id: teamId },
        update: {},
      });
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
      await prisma.teamGameStat.upsert({
        where: { gameId_teamId: { gameId: g.GameId, teamId } },
        create: { gameId: g.GameId, ...stat },
        update: stat,
      });
      await prisma.statProvenance.upsert({
        where: { gameId_entityType_entityKey_source: { gameId: g.GameId, entityType: "TEAM_GAME", entityKey: teamId, source: "LEAGUEPEDIA" } },
        create: { gameId: g.GameId, runId, entityType: "TEAM_GAME", entityKey: teamId, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(stat)) },
        update: { runId, fields: JSON.stringify(Object.keys(stat)), importedAt: new Date() },
      });
    }
  }

  // 4. Per-player stats (also builds the player pool)
  const allPlayerRows = await cargoQuery({
    tables: "ScoreboardPlayers",
    fields:
      "GameId,Link,Name,Team,Side,Champion,IngameRole,Kills,Deaths,Assists,Gold,CS," +
      "DamageToChampions,VisionScore,PlayerWin,SummonerSpells,Items,Trinket," +
      "PrimaryTree,SecondaryTree,KeystoneRune,Pentakills,TeamKills,TeamGold",
    where: `OverviewPage="${esc}"`,
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

  for (const p of playerRows) {
    if (!p.GameId || !p.Link) continue;
    const game = await prisma.game.findUnique({ where: { id: p.GameId } });
    if (!game) continue;
    if (p.Team) {
      await prisma.proTeam.upsert({
        where: { id: p.Team },
        create: { id: p.Team },
        update: {},
      });
    }
    await prisma.proPlayer.upsert({
      where: { id: p.Link },
      create: {
        id: p.Link,
        name: p.Name || p.Link,
        role: p.IngameRole || null,
        teamId: p.Team || null,
        tournamentId: overviewPage,
      },
      update: {
        name: p.Name || p.Link,
        role: p.IngameRole || null,
        teamId: p.Team || null,
        tournamentId: overviewPage,
      },
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
    await prisma.playerGameStat.upsert({
      where: { gameId_playerId: { gameId: p.GameId, playerId: p.Link } },
      create: { gameId: p.GameId, playerId: p.Link, ...stat },
      update: stat,
    });
    await prisma.statProvenance.upsert({
      where: { gameId_entityType_entityKey_source: { gameId: p.GameId, entityType: "PLAYER_GAME", entityKey: p.Link, source: "LEAGUEPEDIA" } },
      create: { gameId: p.GameId, runId, entityType: "PLAYER_GAME", entityKey: p.Link, source: "LEAGUEPEDIA", fields: JSON.stringify(Object.keys(stat)) },
      update: { runId, fields: JSON.stringify(Object.keys(stat)), importedAt: new Date() },
    });
  }

  // 5. Ordered champion draft. This table records each side's pick/ban order
  // and role assignment, which ScoreboardGames' comma-separated lists lose.
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
  });
  const drafts = weekNumber === null ? allDrafts : allDrafts.filter((d) => selectedGameIds.has(d.GameId));
  console.log(`  completed drafts: ${drafts.length}`);
  for (const d of drafts) {
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
          await prisma.draftAction.upsert({
            where: {
              gameId_teamId_action_sequence: { gameId: d.GameId, teamId, action, sequence },
            },
            create: { gameId: d.GameId, ...data },
            update: data,
          });
        }
      }
    }
  }

  // Summary
  const matchScope = {
    tournamentId: overviewPage,
    ...(weekNumber === null ? {} : { week: { number: weekNumber } }),
  };
  const counts = {
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
  };

  // A successful weekly pull should immediately expose the next slate. At
  // Week 0 this creates/opens LeagueWeek 1; publishing it later advances the
  // league to Week 1 and opens Week 2.
  await syncLeagueWeeksForTournament(overviewPage);
  console.log(`Done:`, counts);
  return counts;
}

async function validateIngestRequest(
  overviewPage: string,
  weekNumber: number | null,
  scheduleOnly: boolean,
) {
  if (!overviewPage.trim()) throw new Error("A Leaguepedia tournament page is required");
  if (scheduleOnly && weekNumber === null) throw new Error("Schedule ingestion requires a week number");
  if (weekNumber !== null && (!Number.isInteger(weekNumber) || weekNumber < 1)) {
    throw new Error("The ingest week must be a positive whole number");
  }

  const leagues = await prisma.league.findMany({
    where: { tournamentId: overviewPage },
    select: {
      currentWeek: true,
      leagueWeeks: {
        where: weekNumber === null ? undefined : { week: { number: weekNumber } },
        select: { status: true },
      },
    },
  });
  if (leagues.length > 0 && weekNumber === null) {
    throw new Error("This tournament is attached to a live league; fetch one week at a time");
  }
  if (weekNumber !== null) {
    assertSequentialIngest(
      weekNumber,
      scheduleOnly,
      leagues.map((league) => ({
        currentWeek: league.currentWeek,
        targetStatus: league.leagueWeeks[0]?.status ?? null,
      })),
    );
  }
  return leagues;
}

export async function runLeaguepediaIngest({
  overviewPage,
  weekNumber,
  scheduleOnly = false,
}: {
  overviewPage: string;
  weekNumber: number | null;
  scheduleOnly?: boolean;
}): Promise<LeaguepediaIngestCounts> {
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
      source: scheduleOnly ? "LEAGUEPEDIA_SCHEDULE" : "LEAGUEPEDIA",
      tournamentId: overviewPage,
      weekNumber,
    },
  });

  try {
    const counts = await ingestTournament(overviewPage, weekNumber, run.id, scheduleOnly);

    if (!scheduleOnly && weekNumber !== null) {
      const target = await prisma.leagueWeek.findFirst({
        where: { league: { tournamentId: overviewPage }, week: { number: weekNumber } },
        select: { id: true },
      });
      if (target) {
        const validation = await validateLeagueWeek(target.id);
        if (!validation.ok) {
          const details = validation.errors.slice(0, 5).join("; ");
          throw new Error(
            `Week ${weekNumber} results are incomplete (${validation.errors.length} checks failed): ${details}`,
          );
        }
      }
    }

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), rowCount: counts.playerStats, summary: JSON.stringify(counts) },
    });

    if (!scheduleOnly && weekNumber !== null) {
      await prisma.leagueWeek.updateMany({
        where: {
          league: { tournamentId: overviewPage },
          week: { number: weekNumber },
          status: { in: ["LOCKED", "RESULTS_IMPORTED"] },
        },
        data: { status: "RESULTS_IMPORTED", resultsImportedAt: new Date() },
      });
    }
    return counts;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.ingestionRun.update({
      where: { id: run.id },
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
  if (!overviewPage) {
    throw new Error('Usage: npm run ingest -- "<Leaguepedia OverviewPage>" [--week=N] [--schedule-only]');
  }
  await runLeaguepediaIngest({ overviewPage, weekNumber, scheduleOnly });
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
