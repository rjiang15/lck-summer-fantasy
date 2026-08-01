import { prisma } from "./db";
import { parseScoring, round1, weeklyFantasyLines } from "./fantasy";
import { pickemPoints } from "./scoring";
import { advancedScoreAvailability } from "./advanced-stat-coverage";
import { resolveRosterWeekContribution } from "./roster-fallback";
import {
  effectiveFantasyRosterPlayerId,
  fantasyRosterTradeExceptionForRosterPlayer,
} from "./roster-trade-exceptions";

export const WEEK_STATUSES = [
  "UPCOMING",
  "OPEN",
  "LOCKED",
  "RESULTS_IMPORTED",
  "SCORED",
  "PUBLISHED",
] as const;

export function canReplaceWeeklyRosterSnapshot(week: { status: string; picksLockedAt: Date | null }) {
  return week.status === "OPEN" && week.picksLockedAt === null;
}

export async function ensureLeagueWeeks(leagueId: number) {
  const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId } });
  const weeks = await prisma.week.findMany({
    where: { tournamentId: league.tournamentId },
    orderBy: { number: "asc" },
  });
  for (const week of weeks) {
    await prisma.leagueWeek.upsert({
      where: { leagueId_weekId: { leagueId, weekId: week.id } },
      create: { leagueId, weekId: week.id },
      update: {},
    });
  }
  return prisma.leagueWeek.findMany({
    where: { leagueId },
    orderBy: { week: { number: "asc" } },
    include: { week: true, weeklyScores: true },
  });
}

export async function validateLeagueWeek(leagueWeekId: number) {
  const lw = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id: leagueWeekId },
    include: {
      week: {
        include: {
          matches: {
            include: {
              games: {
                include: {
                  playerStats: true,
                  playerTimeline: { where: { minute: 15 } },
                  teamStats: true,
                  draftActions: true,
                },
              },
            },
          },
        },
      },
    },
  });
  return validateLoadedWeek(lw.week);
}

export async function validateWeekData(weekId: number) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      matches: {
        include: {
          games: {
            include: {
              playerStats: true,
              playerTimeline: { where: { minute: 15 } },
              teamStats: true,
              draftActions: true,
            },
          },
        },
      },
    },
  });
  return validateLoadedWeek(week);
}

function validateLoadedWeek(lw: {
  matches: Array<{
    team1: string; team2: string; winner: string | null; team1Score: number | null; team2Score: number | null;
    games: Array<{
      id: string;
      winner: string | null;
      playerStats: Array<{
        playerId: string;
        role: string | null;
        damageShare: number | null;
        goldShare: number | null;
        wardsKilled: number | null;
        controlWardsBought: number | null;
        damageToTowers: number | null;
        damageMitigated: number | null;
        tripleKills: number | null;
        quadraKills: number | null;
        pentakills: number | null;
      }>;
      playerTimeline: Array<{
        playerId: string;
        csDiff: number | null;
        goldDiff: number | null;
        xpDiff: number | null;
      }>;
      teamStats: unknown[];
      draftActions: unknown[];
    }>;
  }>;
}) {
  const errors: string[] = [];
  if (lw.matches.length === 0) errors.push("Week has no scheduled matches");
  for (const match of lw.matches) {
    if (!match.winner || ![match.team1, match.team2].includes(match.winner)) {
      errors.push(`${match.team1} vs ${match.team2}: missing or invalid winner`);
    }
    if (match.team1Score == null || match.team2Score == null) {
      errors.push(`${match.team1} vs ${match.team2}: missing series score`);
    } else if (match.games.length !== match.team1Score + match.team2Score) {
      errors.push(`${match.team1} vs ${match.team2}: series score does not match game count`);
    }
    for (const game of match.games) {
      if (game.playerStats.length !== 10) errors.push(`${game.id}: expected 10 player rows, found ${game.playerStats.length}`);
      if (game.teamStats.length !== 2) errors.push(`${game.id}: expected 2 team rows, found ${game.teamStats.length}`);
      if (game.draftActions.length !== 20) errors.push(`${game.id}: expected 20 draft actions, found ${game.draftActions.length}`);
      if (!game.winner) errors.push(`${game.id}: missing game winner`);
      const missingAdvanced = new Set<string>();
      for (const player of game.playerStats) {
        const laneAt15 = game.playerTimeline.find((timeline) => timeline.playerId === player.playerId);
        const availability = advancedScoreAvailability(player, laneAt15);
        if (!availability.efficiency) missingAdvanced.add("efficiency inputs");
        if (!availability.laneImpact) missingAdvanced.add("lane @15");
        if (!availability.towerPressure) missingAdvanced.add("tower damage");
        if (!availability.durability) missingAdvanced.add("damage mitigated");
        if (!availability.multikill) missingAdvanced.add("triple/quadra/penta counts");
      }
      if (missingAdvanced.size > 0) {
        errors.push(`${game.id}: missing advanced scoring inputs (${[...missingAdvanced].join(", ")})`);
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    matches: lw.matches.length,
    games: lw.matches.reduce((n, m) => n + m.games.length, 0),
  };
}

export async function snapshotWeeklyRosters(leagueWeekId: number) {
  const lw = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id: leagueWeekId },
    include: {
      league: { include: { fantasyTeams: { include: { user: true, roster: true } } } },
      weeklyRosters: true,
    },
  });
  if (lw.weeklyRosters.length > 0 && !canReplaceWeeklyRosterSnapshot(lw)) {
    return;
  }
  await prisma.$transaction(async (tx) => {
    // An orphaned snapshot may exist if an earlier lock attempt stopped before
    // the LeagueWeek state was committed. It is safe to replace only while the
    // week is still open and picks have never been locked.
    if (lw.weeklyRosters.length > 0) {
      await tx.weeklyRosterSlot.deleteMany({ where: { leagueWeekId } });
    }
    for (const team of lw.league.fantasyTeams) {
      const required = ["TOP", "JNG", "MID", "BOT", "SUP"];
      const missing = required.filter((slot) => !team.roster.some((row) => row.slot === slot));
      if (missing.length > 0) throw new Error(`${team.name} is missing roster slots: ${missing.join(", ")}`);
      await tx.weeklyRosterSlot.createMany({
        data: team.roster.map((slot) => ({
          leagueWeekId,
          fantasyTeamId: team.id,
          playerId: effectiveFantasyRosterPlayerId(
            lw.league.tournamentId,
            team.user.username,
            slot.playerId,
          ),
          slot: slot.slot,
        })),
      });
    }
  });
}

export async function calculateWeeklyScores(
  leagueWeekId: number,
  options: { allowPublished?: boolean; auditReason?: string } = {},
) {
  const lw = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id: leagueWeekId },
    include: {
      league: { include: { fantasyTeams: { include: { user: true } } } },
      week: {
        include: {
          matches: {
            include: {
              games: {
                include: {
                  playerStats: true,
                  teamStats: true,
                  playerTimeline: { where: { minute: 15 } },
                },
              },
            },
          },
        },
      },
      weeklyRosters: true,
      weeklyScores: true,
    },
  });
  if (lw.status === "PUBLISHED" && !options.allowPublished) {
    throw new Error("Published weekly scores are immutable unless an audited recalculation is explicitly requested");
  }
  if (lw.weeklyRosters.length === 0) {
    throw new Error("This week has no frozen roster snapshot; unlock and relock its picks before importing results");
  }
  const config = parseScoring(lw.league.scoringConfig);
  const [picks, rosterIdentities] = await Promise.all([
    prisma.pickem.findMany({ where: { leagueId: lw.leagueId, match: { weekId: lw.weekId } } }),
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: lw.league.tournamentId },
      select: { playerId: true, teamId: true, role: true },
    }),
  ]);
  const weeklyLines = weeklyFantasyLines(lw.week.matches, config);
  await prisma.$transaction(async (tx) => {
    for (const team of lw.league.fantasyTeams) {
      const roster = lw.weeklyRosters.filter(
        (slot) => slot.fantasyTeamId === team.id && slot.slot !== "BENCH",
      );
      let rosterPts = 0;
      const playerContributions = roster.map((slot) => {
        const exception = fantasyRosterTradeExceptionForRosterPlayer(
          lw.league.tournamentId,
          team.user.username,
          slot.playerId,
        );
        const effectivePlayerId = exception?.replacesPlayerId === slot.playerId
          ? exception.playerId
          : slot.playerId;
        const contribution = resolveRosterWeekContribution(
          effectivePlayerId,
          rosterIdentities,
          weeklyLines,
          exception ? {
            id: exception.id,
            effectiveAt: new Date(exception.effectiveAt),
            previousPlayerId: exception.replacesPlayerId,
            previousTeamId: exception.previousTeamId,
            currentTeamId: exception.currentTeamId,
            role: exception.role,
          } : null,
        );
        rosterPts += contribution.creditedPoints;
        return {
          playerId: effectivePlayerId,
          slot: slot.slot,
          gamesPlayed: contribution.gamesPlayed,
          rawPoints: round1(contribution.rawPoints),
          pointsPerGame: round1(contribution.pointsPerGame),
          creditedPoints: round1(contribution.creditedPoints),
          fallback: contribution.fallback ? {
            ...contribution.fallback,
            substitutePointsPerGame: round1(contribution.fallback.substitutePointsPerGame),
            teamAveragePointsPerGame: round1(contribution.fallback.teamAveragePointsPerGame),
            creditedPoints: round1(contribution.fallback.creditedPoints),
          } : null,
          rosterException: exception ? {
            id: exception.id,
            effectiveAt: exception.effectiveAt,
            replacesPlayerId: exception.replacesPlayerId,
            previousTeamId: exception.previousTeamId,
            currentTeamId: exception.currentTeamId,
            retainedGroup: exception.retainedGroup,
            currentGroup: exception.currentGroup,
          } : null,
        };
      });
      let pickemPts = 0;
      for (const match of lw.week.matches) {
        if (!match.winner || match.team1Score == null || match.team2Score == null) continue;
        const pick = picks.find((row) => row.userId === team.userId && row.matchId === match.id);
        if (pick) {
          pickemPts += pickemPoints(
            pick.predictedWinner,
            pick.predictedScore,
            match.winner,
            `${match.team1Score}-${match.team2Score}`,
            config,
          );
        }
      }
      rosterPts = round1(rosterPts);
      const previous = lw.weeklyScores.find((score) => score.fantasyTeamId === team.id);
      const recalculationHistory: unknown[] = [];
      if (previous) {
        try {
          const priorBreakdown = JSON.parse(previous.breakdown) as {
            recalculation?: unknown;
            recalculationHistory?: unknown[];
          };
          if (Array.isArray(priorBreakdown.recalculationHistory)) {
            recalculationHistory.push(...priorBreakdown.recalculationHistory);
          } else if (priorBreakdown.recalculation) {
            recalculationHistory.push(priorBreakdown.recalculation);
          }
        } catch {
          // A malformed historical breakdown must not block a score correction.
        }
      }
      if (options.auditReason && previous) {
        recalculationHistory.push({
          reason: options.auditReason,
          previousRosterPts: previous.rosterPts,
          previousPickemPts: previous.pickemPts,
          previousTotal: previous.total,
          previousCalculatedAt: previous.calculatedAt.toISOString(),
        });
      }
      const breakdown = {
        scoringVersion: config.version,
        rosterScoringVersion: 3,
        roster: playerContributions,
        ...(recalculationHistory.length > 0 ? { recalculationHistory } : {}),
      };
      await tx.weeklyScore.upsert({
        where: { leagueWeekId_fantasyTeamId: { leagueWeekId, fantasyTeamId: team.id } },
        create: {
          leagueWeekId,
          fantasyTeamId: team.id,
          rosterPts,
          pickemPts,
          total: round1(rosterPts + pickemPts),
          breakdown: JSON.stringify(breakdown),
        },
        update: {
          rosterPts,
          pickemPts,
          total: round1(rosterPts + pickemPts),
          breakdown: JSON.stringify(breakdown),
          calculatedAt: new Date(),
        },
      });
    }
  });
}

export function validSeriesPrediction(
  bestOf: number,
  team1: string,
  team2: string,
  winner: string,
  score: string,
) {
  if (![team1, team2].includes(winner)) return false;
  const [left, right] = score.split("-").map(Number);
  if (!Number.isInteger(left) || !Number.isInteger(right)) return false;
  const needed = Math.floor(bestOf / 2) + 1;
  if (Math.max(left, right) !== needed || Math.min(left, right) < 0 || Math.min(left, right) >= needed) return false;
  return winner === (left > right ? team1 : team2);
}
