// Aggregation helpers shared by the UI pages: weekly roster points,
// pickem grading, and leaderboards. Everything recomputes from raw
// stats + the league's ScoringConfig. Published weeks use immutable score
// snapshots; raw recomputation remains only as a legacy fallback.

import { prisma } from "./db";
import { crystalBallPoints } from "./crystal-ball";
import {
  DEFAULT_SCORING,
  type ScoringConfig,
  playerGamePoints,
  pickemPoints,
} from "./scoring";

export const ROLE_ORDER = ["Top", "Jungle", "Mid", "Bot", "Support"];
export const SLOT_ORDER = ["TOP", "JNG", "MID", "BOT", "SUP", "BENCH"];

export function parseScoring(json: string | null | undefined): ScoringConfig {
  if (!json) return DEFAULT_SCORING;
  try {
    const parsed = JSON.parse(json);
    return {
      player: { ...DEFAULT_SCORING.player, ...parsed.player },
      pickem: { ...DEFAULT_SCORING.pickem, ...parsed.pickem },
    };
  } catch {
    return DEFAULT_SCORING;
  }
}

/**
 * The visible ingested tournament with the most player stats (UI default).
 * A schedule-only tournament is still a valid UI target even though it has no
 * game stats yet, so fall back to the newest tournament with slate/roster data.
 */
export async function getDefaultTournamentId(): Promise<string | null> {
  const tournaments = await prisma.tournament.findMany({
    where: { hidden: false },
    orderBy: [{ dateStart: "desc" }, { id: "asc" }],
    select: {
      id: true,
      _count: { select: { matches: true, weeks: true, proPlayers: true } },
    },
  });
  let best: { id: string; stats: number } | null = null;
  for (const t of tournaments) {
    const stats = await prisma.playerGameStat.count({
      where: { game: { match: { tournamentId: t.id } } },
    });
    if (stats > 0 && (!best || stats > best.stats)) best = { id: t.id, stats };
  }
  if (best) return best.id;
  return tournaments.find(
    (t) => t._count.matches > 0 || t._count.weeks > 0 || t._count.proPlayers > 0,
  )?.id ?? null;
}

export async function getDemoLeague(leagueId?: number) {
  let id = leagueId;
  if (!id) {
    const [{ getCurrentUser }, { getPreferredMembership }] = await Promise.all([import("./auth"), import("./leagues")]);
    const user = await getCurrentUser();
    if (!user) return null;
    id = (await getPreferredMembership(user.id))?.leagueId;
  }
  if (!id) return null;
  return prisma.league.findUnique({
    where: { id },
    include: {
      fantasyTeams: {
        include: {
          user: true,
          roster: { include: { player: true } },
        },
      },
      cbQuestions: { include: { answers: true } },
      leagueWeeks: {
        include: { week: true, weeklyScores: true },
        orderBy: { week: { number: "asc" } },
      },
    },
  });
}

export interface WeekBundle {
  id: number;
  number: number;
  startsAt: Date;
  endsAt: Date;
  matches: Awaited<ReturnType<typeof loadWeeks>>[number]["matches"];
}

export async function loadWeeks(tournamentId: string) {
  return prisma.week.findMany({
    where: { tournamentId },
    orderBy: { number: "asc" },
    include: {
      matches: {
        orderBy: { scheduledAt: "asc" },
        include: {
          games: {
            orderBy: { gameNumber: "asc" },
            include: { playerStats: true, teamStats: true },
          },
        },
      },
    },
  });
}

export interface TeamWeekScore {
  weekNumber: number;
  rosterPts: number;
  pickemPts: number;
}

export interface FantasyStanding {
  fantasyTeamId: number;
  teamName: string;
  username: string;
  weekly: TeamWeekScore[];
  rosterTotal: number;
  pickemTotal: number;
  crystalBallTotal: number;
  total: number;
}

/**
 * Full league standings: per-week roster + pickem points for every participant.
 * With a cutoff, matches scheduled at/after it count as not-yet-played.
 */
export async function computeStandings(cutoff: Date | null = null, leagueId?: number): Promise<{
  standings: FantasyStanding[];
  weeks: { number: number; startsAt: Date; endsAt: Date }[];
} | null> {
  const league = await getDemoLeague(leagueId);
  if (!league) return null;
  const cfg = parseScoring(league.scoringConfig);
  const allWeeks = await loadWeeks(league.tournamentId);
  // Once lifecycle rows exist, public standings use only commissioner-published
  // score snapshots. Raw future results can never leak into fantasy standings.
  if (league.leagueWeeks.length > 0) {
    const published = league.leagueWeeks.filter(
      (lw) => lw.status === "PUBLISHED" && (cutoff === null || lw.week.endsAt < cutoff),
    );
    const crystalSettled = league.seasonStatus === "FINAL";
    const standings: FantasyStanding[] = league.fantasyTeams.map((ft) => {
      const weekly = published.map((lw) => {
        const score = lw.weeklyScores.find((row) => row.fantasyTeamId === ft.id);
        return {
          weekNumber: lw.week.number,
          rosterPts: score?.rosterPts ?? 0,
          pickemPts: score?.pickemPts ?? 0,
        };
      });
      const crystalBallTotal = crystalSettled
        ? league.cbQuestions.reduce((sum, question) => sum + crystalBallPoints(question, ft.userId), 0)
        : 0;
      const rosterTotal = round1(weekly.reduce((sum, row) => sum + row.rosterPts, 0));
      const pickemTotal = weekly.reduce((sum, row) => sum + row.pickemPts, 0);
      return {
        fantasyTeamId: ft.id,
        teamName: ft.name,
        username: ft.user.username,
        weekly,
        rosterTotal,
        pickemTotal,
        crystalBallTotal,
        total: round1(rosterTotal + pickemTotal + crystalBallTotal),
      };
    }).sort((a, b) => b.total - a.total);
    return {
      standings,
      weeks: published.map((lw) => ({ number: lw.week.number, startsAt: lw.week.startsAt, endsAt: lw.week.endsAt })),
    };
  }
  const weeks = allWeeks.map((w) => ({
    ...w,
    matches: w.matches.filter((m) => cutoff === null || m.scheduledAt < cutoff),
  }));
  const pickems = await prisma.pickem.findMany({ where: { leagueId: league.id } });

  const standings: FantasyStanding[] = [];
  for (const ft of league.fantasyTeams) {
    const weekly: TeamWeekScore[] = [];
    for (const week of weeks) {
      let rosterPts = 0;
      for (const slot of ft.roster) {
        if (slot.slot === "BENCH") continue;
        for (const match of week.matches) {
          for (const game of match.games) {
            const ps = game.playerStats.find((p) => p.playerId === slot.playerId);
            if (ps) rosterPts += playerGamePoints(ps, cfg);
          }
        }
      }
      let pickemPts = 0;
      for (const match of week.matches) {
        if (!match.winner || match.team1Score === null || match.team2Score === null) continue;
        const pick = pickems.find(
          (p) => p.userId === ft.userId && p.matchId === match.id,
        );
        if (!pick) continue;
        pickemPts += pickemPoints(
          pick.predictedWinner,
          pick.predictedScore,
          match.winner,
          `${match.team1Score}-${match.team2Score}`,
          cfg,
        );
      }
      weekly.push({ weekNumber: week.number, rosterPts: round1(rosterPts), pickemPts });
    }
    // Crystal ball settles at the end of the split — mid-split cursor shows 0
    const crystalBallTotal = cutoff !== null
      ? 0
      : league.cbQuestions.reduce((sum, question) => sum + crystalBallPoints(question, ft.userId), 0);

    const rosterTotal = round1(weekly.reduce((s, w) => s + w.rosterPts, 0));
    const pickemTotal = weekly.reduce((s, w) => s + w.pickemPts, 0);
    standings.push({
      fantasyTeamId: ft.id,
      teamName: ft.name,
      username: ft.user.username,
      weekly,
      rosterTotal,
      pickemTotal,
      crystalBallTotal,
      total: round1(rosterTotal + pickemTotal + crystalBallTotal),
    });
  }
  standings.sort((a, b) => b.total - a.total);
  return {
    standings,
    weeks: weeks.map((w) => ({ number: w.number, startsAt: w.startsAt, endsAt: w.endsAt })),
  };
}

/** Pro-player leaderboard for a tournament (total fantasy points, default = league config). */
export async function proLeaderboard(
  tournamentId: string,
  cfg: ScoringConfig,
  cutoff: Date | null = null,
) {
  const stats = await prisma.playerGameStat.findMany({
    where: {
      game: {
        match: {
          tournamentId,
          ...(cutoff ? { scheduledAt: { lt: cutoff } } : {}),
        },
      },
    },
    include: { player: true },
  });
  const rows = new Map<
    string,
    { id: string; name: string; team: string; role: string; games: number; pts: number; k: number; d: number; a: number }
  >();
  for (const s of stats) {
    const row =
      rows.get(s.playerId) ??
      { id: s.playerId, name: s.player.name, team: s.teamId, role: s.role ?? "?", games: 0, pts: 0, k: 0, d: 0, a: 0 };
    row.games++;
    row.pts = round1(row.pts + playerGamePoints(s, cfg));
    row.k += s.kills;
    row.d += s.deaths;
    row.a += s.assists;
    row.team = s.teamId; // latest team
    rows.set(s.playerId, row);
  }
  return [...rows.values()].sort((a, b) => b.pts - a.pts);
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export const fmtDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "?";

export const fmtLength = (sec: number | null) =>
  sec === null ? "?" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
