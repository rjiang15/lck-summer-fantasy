import fixtureJson from "@/data/manual-series/2026-08-01-gen-dk.json";
import { writeIfChanged, type WriteCounts } from "./change-aware-write";
import { prisma } from "./db";
import { normalizeGolIdentity } from "./games-of-legends";

export const GEN_DK_MANUAL_RECONCILIATION_ID = "2026-08-01-gen-dk";

type ManualPlayer = {
  player: string;
  team: string;
  side: string;
  champion: string;
  role: string;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  cs: number;
  monsterKillsOwnJungle?: number | null;
  monsterKillsEnemyJungle?: number | null;
  damage: number;
  damageToTowers: number;
  damageTaken?: number | null;
  damageMitigated: number;
  totalHeal: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  controlWardsBought: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentakills: number;
  teamKills: number;
  teamGold: number;
  killParticipation: number;
  damageShare: number;
  goldShare: number;
  laneAt15: { csDiff: number; goldDiff: number; xpDiff: number };
  provisional?: {
    fields: string[];
    xpConfidence: string;
    controlWards: string;
  };
};

type ManualTeam = {
  team: string;
  side: string;
  won: boolean;
  kills: number;
  deaths: number;
  gold: number;
  towers: number;
  turretPlates: number;
  dragons: number;
  cloudDrakes: number;
  infernalDrakes: number;
  mountainDrakes: number;
  oceanDrakes: number;
  hextechDrakes: number;
  chemtechDrakes: number;
  elderDragons: number;
  barons: number;
  heralds: number;
  voidGrubs: number;
  atakhans: number;
  inhibs: number;
  firstBlood: boolean;
  firstDragon: boolean;
  firstHerald: boolean;
  firstBaron: boolean;
  firstTower: boolean;
};

type ManualDraft = {
  team: string;
  side: string;
  action: string;
  sequence: number;
  champion: string;
  role: string | null;
  player: string | null;
};

type ManualGame = {
  id: string;
  gameNumber: number;
  winner: string;
  lengthSec: number;
  patch: string;
  riotGameId?: string;
  sourceUrl: string;
  source: string;
  players: ManualPlayer[];
  teams: ManualTeam[];
  drafts: ManualDraft[];
};

type ManualFixture = {
  id: string;
  tournamentId: string;
  date: string;
  note: string;
  games: ManualGame[];
};

const fixture = fixtureJson as ManualFixture;

function canonicalTeam(sourceTeam: string, match: { team1: string; team2: string }) {
  const normalized = normalizeGolIdentity(sourceTeam);
  if (normalized === normalizeGolIdentity(match.team1)) return match.team1;
  if (normalized === normalizeGolIdentity(match.team2)) return match.team2;
  throw new Error(`Manual reconciliation team ${sourceTeam} does not match ${match.team1} vs ${match.team2}`);
}

async function recordProvenance({
  runId,
  gameId,
  entityType,
  entityKey,
  source,
  fields,
}: {
  runId: number;
  gameId: string;
  entityType: string;
  entityKey: string;
  source: string;
  fields: string[];
}) {
  await prisma.statProvenance.upsert({
    where: {
      gameId_entityType_entityKey_source: { gameId, entityType, entityKey, source },
    },
    create: {
      gameId,
      runId,
      entityType,
      entityKey,
      source,
      fields: JSON.stringify(fields),
    },
    update: { runId, fields: JSON.stringify(fields), importedAt: new Date() },
  });
}

async function removeKnownCorruptGame(gameId: string, counts: WriteCounts) {
  await prisma.statProvenance.deleteMany({ where: { gameId } });
  await prisma.gameEvent.deleteMany({ where: { gameId } });
  await prisma.playerTimelineSnapshot.deleteMany({ where: { gameId } });
  await prisma.teamTimelineSnapshot.deleteMany({ where: { gameId } });
  await prisma.draftAction.deleteMany({ where: { gameId } });
  await prisma.playerGameStat.deleteMany({ where: { gameId } });
  await prisma.teamGameStat.deleteMany({ where: { gameId } });
  await prisma.game.delete({ where: { id: gameId } });
  counts.updated += 1;
}

/**
 * Replaces the one known-corrupt GoL series with its checked mixed-source
 * package. This is deliberately identity-gated by gol-data-quality.ts and is
 * safe to rerun: every stored row uses change-aware upserts.
 */
export async function applyManualSeriesReconciliation({
  reconciliationId,
  matchId,
  tournamentId,
  runId,
  counts,
}: {
  reconciliationId: string;
  matchId: string;
  tournamentId: string;
  runId: number;
  counts: WriteCounts;
}) {
  if (reconciliationId !== GEN_DK_MANUAL_RECONCILIATION_ID) {
    throw new Error(`Unknown manual reconciliation ${reconciliationId}`);
  }
  if (fixture.id !== reconciliationId || fixture.tournamentId !== tournamentId) {
    throw new Error(`Manual reconciliation ${reconciliationId} is outside its audited tournament scope`);
  }

  let match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      games: {
        include: { playerStats: true, teamStats: true, draftActions: true },
      },
    },
  });
  if (match.scheduledAt.toISOString().slice(0, 10) !== fixture.date) {
    throw new Error(`Manual reconciliation ${reconciliationId} does not match ${match.scheduledAt.toISOString()}`);
  }

  const expectedIds = new Map(fixture.games.map((game) => [game.gameNumber, game.id]));
  for (const game of match.games) {
    const expectedId = expectedIds.get(game.gameNumber);
    if (!expectedId || game.id === expectedId) continue;
    if (game.gameNumber === 1 && game.id === "gol:80675") {
      await removeKnownCorruptGame(game.id, counts);
      continue;
    }
    throw new Error(
      `Refusing to replace unexpected game ${game.id} in manual reconciliation ${reconciliationId}`,
    );
  }
  match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      games: {
        include: { playerStats: true, teamStats: true, draftActions: true },
      },
    },
  });

  const knownPlayers = await prisma.proPlayer.findMany();
  const playerIdByIdentity = new Map<string, string>();
  for (const player of knownPlayers) {
    playerIdByIdentity.set(normalizeGolIdentity(player.id), player.id);
    playerIdByIdentity.set(normalizeGolIdentity(player.name), player.id);
  }
  const importedPlayerNames = new Set<string>();

  for (const manualGame of fixture.games) {
    const existingGame = match.games.find((game) => game.id === manualGame.id) ?? null;
    const winner = canonicalTeam(manualGame.winner, match);
    const gameData = {
      matchId: match.id,
      gameNumber: manualGame.gameNumber,
      winner,
      lengthSec: manualGame.lengthSec,
      playedAt: existingGame?.playedAt ?? match.scheduledAt,
      patch: manualGame.patch,
      sourceUrl: manualGame.sourceUrl,
      ...(manualGame.riotGameId ? { riotGameId: manualGame.riotGameId } : {}),
      sourceData: JSON.stringify({
        source: manualGame.source,
        reconciliationId,
        note: fixture.note,
      }),
    };
    const gameWrite = await writeIfChanged({
      existing: existingGame,
      incoming: gameData,
      counts,
      create: () => prisma.game.create({ data: { id: manualGame.id, ...gameData } }),
      update: () => prisma.game.update({ where: { id: manualGame.id }, data: gameData }),
    });
    if (gameWrite !== "unchanged") {
      await recordProvenance({
        runId,
        gameId: manualGame.id,
        entityType: "GAME",
        entityKey: manualGame.id,
        source: manualGame.source,
        fields: Object.keys(gameData),
      });
    }

    for (const manualTeam of manualGame.teams) {
      const teamId = canonicalTeam(manualTeam.team, match);
      const teamData = {
        teamId,
        side: manualTeam.side,
        kills: manualTeam.kills,
        deaths: manualTeam.deaths,
        gold: manualTeam.gold,
        towers: manualTeam.towers,
        turretPlates: manualTeam.turretPlates,
        dragons: manualTeam.dragons,
        cloudDrakes: manualTeam.cloudDrakes,
        infernalDrakes: manualTeam.infernalDrakes,
        mountainDrakes: manualTeam.mountainDrakes,
        oceanDrakes: manualTeam.oceanDrakes,
        hextechDrakes: manualTeam.hextechDrakes,
        chemtechDrakes: manualTeam.chemtechDrakes,
        elderDragons: manualTeam.elderDragons,
        barons: manualTeam.barons,
        heralds: manualTeam.heralds,
        voidGrubs: manualTeam.voidGrubs,
        atakhans: manualTeam.atakhans,
        inhibs: manualTeam.inhibs,
        firstBlood: manualTeam.firstBlood,
        firstDragon: manualTeam.firstDragon,
        firstHerald: manualTeam.firstHerald,
        firstBaron: manualTeam.firstBaron,
        firstTower: manualTeam.firstTower,
        sourceData: JSON.stringify({
          source: manualGame.source,
          reconciliationId,
          provisionalZeros: manualGame.gameNumber === 1 ? ["turretPlates", "atakhans"] : [],
        }),
        won: manualTeam.won,
      };
      const existing = existingGame?.teamStats.find((stat) => stat.teamId === teamId) ?? null;
      const key = { gameId_teamId: { gameId: manualGame.id, teamId } };
      const write = await writeIfChanged({
        existing,
        incoming: teamData,
        counts,
        create: () => prisma.teamGameStat.create({ data: { gameId: manualGame.id, ...teamData } }),
        update: () => prisma.teamGameStat.update({ where: key, data: teamData }),
      });
      if (write !== "unchanged") {
        await recordProvenance({
          runId,
          gameId: manualGame.id,
          entityType: "TEAM_GAME",
          entityKey: teamId,
          source: manualGame.gameNumber === 1 ? "RIOT_AND_POST_MATCH_RECONCILIATION" : "GAMES_OF_LEGENDS",
          fields: Object.keys(teamData),
        });
      }
    }

    const playerIdByTeamChampion = new Map<string, string>();
    for (const manualPlayer of manualGame.players) {
      importedPlayerNames.add(normalizeGolIdentity(manualPlayer.player));
      const teamId = canonicalTeam(manualPlayer.team, match);
      let playerId = playerIdByIdentity.get(normalizeGolIdentity(manualPlayer.player));
      if (!playerId) {
        playerId = manualPlayer.player;
        playerIdByIdentity.set(normalizeGolIdentity(manualPlayer.player), playerId);
      }
      const existingPlayer = await prisma.proPlayer.findUnique({ where: { id: playerId } });
      const playerData = {
        name: manualPlayer.player,
        role: manualPlayer.role,
        teamId,
        tournamentId,
      };
      await writeIfChanged({
        existing: existingPlayer,
        incoming: playerData,
        counts,
        create: () => prisma.proPlayer.create({ data: { id: playerId!, ...playerData } }),
        update: () => prisma.proPlayer.update({ where: { id: playerId! }, data: playerData }),
      });

      const rosterKey = { tournamentId_playerId: { tournamentId, playerId } };
      const existingRoster = await prisma.tournamentPlayer.findUnique({ where: rosterKey });
      const rosterData = { teamId, role: manualPlayer.role };
      await writeIfChanged({
        existing: existingRoster,
        incoming: rosterData,
        counts,
        create: () => prisma.tournamentPlayer.create({ data: { tournamentId, playerId: playerId!, ...rosterData } }),
        update: () => prisma.tournamentPlayer.update({
          where: rosterKey,
          data: { ...rosterData, importedAt: new Date() },
        }),
      });

      const playerStatData = {
        teamId,
        side: manualPlayer.side,
        champion: manualPlayer.champion,
        role: manualPlayer.role,
        kills: manualPlayer.kills,
        deaths: manualPlayer.deaths,
        assists: manualPlayer.assists,
        gold: manualPlayer.gold,
        cs: manualPlayer.cs,
        monsterKillsOwnJungle: manualPlayer.monsterKillsOwnJungle ?? null,
        monsterKillsEnemyJungle: manualPlayer.monsterKillsEnemyJungle ?? null,
        damage: manualPlayer.damage,
        damageToTowers: manualPlayer.damageToTowers,
        damageTaken: manualPlayer.damageTaken ?? null,
        damageMitigated: manualPlayer.damageMitigated,
        totalHeal: manualPlayer.totalHeal,
        visionScore: manualPlayer.visionScore,
        wardsPlaced: manualPlayer.wardsPlaced,
        wardsKilled: manualPlayer.wardsKilled,
        controlWardsBought: manualPlayer.controlWardsBought,
        doubleKills: manualPlayer.doubleKills,
        tripleKills: manualPlayer.tripleKills,
        quadraKills: manualPlayer.quadraKills,
        pentakills: manualPlayer.pentakills,
        teamKills: manualPlayer.teamKills,
        teamGold: manualPlayer.teamGold,
        killParticipation: manualPlayer.killParticipation,
        damageShare: manualPlayer.damageShare,
        goldShare: manualPlayer.goldShare,
        sourceData: JSON.stringify({
          source: manualGame.source,
          reconciliationId,
          provisional: manualPlayer.provisional ?? null,
        }),
        won: manualPlayer.won,
      };
      const statKey = { gameId_playerId: { gameId: manualGame.id, playerId } };
      const existingStat = existingGame?.playerStats.find((stat) => stat.playerId === playerId) ?? null;
      const statWrite = await writeIfChanged({
        existing: existingStat,
        incoming: playerStatData,
        counts,
        create: () => prisma.playerGameStat.create({
          data: { gameId: manualGame.id, playerId: playerId!, ...playerStatData },
        }),
        update: () => prisma.playerGameStat.update({ where: statKey, data: playerStatData }),
      });
      if (statWrite !== "unchanged") {
        const directFields = Object.keys(playerStatData).filter((field) => ![
          "damage", "damageToTowers", "damageMitigated", "totalHeal", "visionScore",
        ].includes(field));
        await recordProvenance({
          runId,
          gameId: manualGame.id,
          entityType: "PLAYER_GAME",
          entityKey: playerId,
          source: manualGame.gameNumber === 1 ? "RIOT_LIVE_STATS" : "GAMES_OF_LEGENDS",
          fields: manualGame.gameNumber === 1 ? directFields : Object.keys(playerStatData),
        });
        if (manualGame.gameNumber === 1) {
          await recordProvenance({
            runId,
            gameId: manualGame.id,
            entityType: "PLAYER_GAME",
            entityKey: playerId,
            source: "COMMISSIONER_PROVISIONAL_ESTIMATE",
            fields: ["damage", "damageToTowers", "damageMitigated", "totalHeal", "visionScore"],
          });
        }
      }

      const timelineData = {
        csDiff: manualPlayer.laneAt15.csDiff,
        goldDiff: manualPlayer.laneAt15.goldDiff,
        xpDiff: manualPlayer.laneAt15.xpDiff,
        sourceData: JSON.stringify({
          source: manualGame.gameNumber === 1
            ? "RIOT_LIVE_STATS_WITH_BROADCAST_XP_ESTIMATE"
            : "GAMES_OF_LEGENDS",
          reconciliationId,
          minute: 15,
          provisionalXp: manualGame.gameNumber === 1,
        }),
      };
      const timelineKey = {
        gameId_playerId_minute: { gameId: manualGame.id, playerId, minute: 15 },
      };
      const existingTimeline = await prisma.playerTimelineSnapshot.findUnique({ where: timelineKey });
      await writeIfChanged({
        existing: existingTimeline,
        incoming: timelineData,
        counts,
        create: () => prisma.playerTimelineSnapshot.create({
          data: { gameId: manualGame.id, playerId: playerId!, minute: 15, ...timelineData },
        }),
        update: () => prisma.playerTimelineSnapshot.update({ where: timelineKey, data: timelineData }),
      });
      playerIdByTeamChampion.set(`${teamId}\u0000${manualPlayer.champion}`, playerId);
    }

    for (const manualDraft of manualGame.drafts) {
      const teamId = canonicalTeam(manualDraft.team, match);
      const data = {
        teamId,
        side: manualDraft.side,
        action: manualDraft.action,
        sequence: manualDraft.sequence,
        champion: manualDraft.champion,
        role: manualDraft.role,
        playerId: manualDraft.action === "PICK"
          ? playerIdByTeamChampion.get(`${teamId}\u0000${manualDraft.champion}`) ?? null
          : null,
      };
      const existing = existingGame?.draftActions.find((row) =>
        row.teamId === teamId && row.action === manualDraft.action && row.sequence === manualDraft.sequence,
      ) ?? null;
      const draftWrite = await writeIfChanged({
        existing,
        incoming: data,
        counts,
        create: () => prisma.draftAction.create({ data: { gameId: manualGame.id, ...data } }),
        update: () => prisma.draftAction.update({ where: { id: existing!.id }, data }),
      });
      if (draftWrite !== "unchanged") {
        await recordProvenance({
          runId,
          gameId: manualGame.id,
          entityType: "DRAFT_ACTION",
          entityKey: `${teamId}:${manualDraft.action}:${manualDraft.sequence}`,
          source: manualGame.gameNumber === 1 ? "REDDIT_POST_MATCH" : "GAMES_OF_LEGENDS",
          fields: Object.keys(data),
        });
      }
    }
  }

  for (const manualGame of fixture.games) {
    const [players, teams, drafts, timelines] = await Promise.all([
      prisma.playerGameStat.count({ where: { gameId: manualGame.id } }),
      prisma.teamGameStat.count({ where: { gameId: manualGame.id } }),
      prisma.draftAction.count({ where: { gameId: manualGame.id } }),
      prisma.playerTimelineSnapshot.count({ where: { gameId: manualGame.id, minute: 15 } }),
    ]);
    if (players !== 10 || teams !== 2 || drafts !== 20 || timelines !== 10) {
      throw new Error(
        `Manual reconciliation game ${manualGame.gameNumber} is incomplete: ` +
        `${players} players, ${teams} teams, ${drafts} drafts, ${timelines} lane rows`,
      );
    }
  }

  return {
    games: fixture.games.length,
    playerStats: fixture.games.reduce((sum, game) => sum + game.players.length, 0),
    draftActions: fixture.games.reduce((sum, game) => sum + game.drafts.length, 0),
    playerNames: [...importedPlayerNames],
  };
}
