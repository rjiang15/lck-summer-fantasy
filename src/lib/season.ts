import { prisma } from "./db";
import { parseScoring, round1 } from "./fantasy";
import { pickemPoints, playerGamePoints } from "./scoring";

export const WEEK_STATUSES = [
  "UPCOMING",
  "OPEN",
  "LOCKED",
  "RESULTS_IMPORTED",
  "SCORED",
  "PUBLISHED",
] as const;

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
              games: { include: { playerStats: true, teamStats: true, draftActions: true } },
            },
          },
        },
      },
    },
  });
  const errors: string[] = [];
  if (lw.week.matches.length === 0) errors.push("Week has no scheduled matches");
  for (const match of lw.week.matches) {
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
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    matches: lw.week.matches.length,
    games: lw.week.matches.reduce((n, m) => n + m.games.length, 0),
  };
}

export async function snapshotWeeklyRosters(leagueWeekId: number) {
  const lw = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id: leagueWeekId },
    include: { league: { include: { fantasyTeams: { include: { roster: true } } } } },
  });
  await prisma.$transaction(async (tx) => {
    await tx.weeklyRosterSlot.deleteMany({ where: { leagueWeekId } });
    for (const team of lw.league.fantasyTeams) {
      const required = ["TOP", "JNG", "MID", "BOT", "SUP"];
      const missing = required.filter((slot) => !team.roster.some((row) => row.slot === slot));
      if (missing.length > 0) throw new Error(`${team.name} is missing roster slots: ${missing.join(", ")}`);
      await tx.weeklyRosterSlot.createMany({
        data: team.roster.map((slot) => ({
          leagueWeekId,
          fantasyTeamId: team.id,
          playerId: slot.playerId,
          slot: slot.slot,
        })),
      });
    }
  });
}

export async function calculateWeeklyScores(leagueWeekId: number) {
  const lw = await prisma.leagueWeek.findUniqueOrThrow({
    where: { id: leagueWeekId },
    include: {
      league: { include: { fantasyTeams: true } },
      week: {
        include: {
          matches: {
            include: { games: { include: { playerStats: true } } },
          },
        },
      },
      weeklyRosters: true,
    },
  });
  const config = parseScoring(lw.league.scoringConfig);
  const picks = await prisma.pickem.findMany({
    where: { match: { weekId: lw.weekId } },
  });
  await prisma.$transaction(async (tx) => {
    for (const team of lw.league.fantasyTeams) {
      const roster = lw.weeklyRosters.filter(
        (slot) => slot.fantasyTeamId === team.id && slot.slot !== "BENCH",
      );
      let rosterPts = 0;
      for (const match of lw.week.matches) {
        for (const game of match.games) {
          for (const slot of roster) {
            const stat = game.playerStats.find((row) => row.playerId === slot.playerId);
            if (stat) rosterPts += playerGamePoints(stat, config);
          }
        }
      }
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
      await tx.weeklyScore.upsert({
        where: { leagueWeekId_fantasyTeamId: { leagueWeekId, fantasyTeamId: team.id } },
        create: {
          leagueWeekId,
          fantasyTeamId: team.id,
          rosterPts,
          pickemPts,
          total: round1(rosterPts + pickemPts),
          breakdown: JSON.stringify({ roster: roster.map((r) => ({ playerId: r.playerId, slot: r.slot })) }),
        },
        update: {
          rosterPts,
          pickemPts,
          total: round1(rosterPts + pickemPts),
          breakdown: JSON.stringify({ roster: roster.map((r) => ({ playerId: r.playerId, slot: r.slot })) }),
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
