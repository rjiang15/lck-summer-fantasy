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
import {
  resolveRosterWeekContribution,
  type RosterWeekContribution,
  type TournamentRosterIdentity,
  type WeeklyFantasyLine,
} from "./roster-fallback";
import {
  fantasyRosterTradeExceptionForRosterPlayer,
  type FantasyRosterTradeException,
} from "./roster-trade-exceptions";

export const ROLE_ORDER = ["Top", "Jungle", "Mid", "Bot", "Support"];
export const SLOT_ORDER = ["TOP", "JNG", "MID", "BOT", "SUP", "BENCH"];

export function parseScoring(json: string | null | undefined): ScoringConfig {
  if (!json) return DEFAULT_SCORING;
  try {
    const parsed = JSON.parse(json);
    // Older versions use superseded player and Pick'em formulas. Published
    // snapshots are updated only through the explicit audited rescore path.
    if (parsed.version !== DEFAULT_SCORING.version) {
      return DEFAULT_SCORING;
    }
    return {
      version: DEFAULT_SCORING.version,
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
        include: {
          week: true,
          weeklyScores: true,
          weeklyRosters: { include: { player: true } },
        },
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
            include: {
              playerStats: true,
              teamStats: true,
              playerTimeline: { where: { minute: 15 } },
            },
          },
        },
      },
    },
  });
}

export function weeklyFantasyLines(matches: WeekBundle["matches"], config: ScoringConfig): WeeklyFantasyLine[] {
  return matches.flatMap((match) => match.games.flatMap((game) => game.playerStats.map((stat) => ({
    playerId: stat.playerId,
    teamId: stat.teamId,
    points: playerGamePoints(stat, config, {
      lengthSec: game.lengthSec,
      teamObjectives: game.teamStats.find((row) => row.teamId === stat.teamId),
      laneAt15: game.playerTimeline.find((row) => row.playerId === stat.playerId),
    }),
    playedAt: game.playedAt ?? match.scheduledAt,
  }))));
}

export type PlayerWeekContribution = {
  playerId: string;
  playerName: string;
  slot: string;
  gamesPlayed: number;
  rawPoints: number;
  pointsPerGame: number;
  creditedPoints: number;
  fallback: RosterWeekContribution["fallback"];
  rosterException: Pick<
    FantasyRosterTradeException,
    "id" | "effectiveAt" | "replacesPlayerId" | "previousTeamId" | "currentTeamId" | "retainedGroup" | "currentGroup"
  > | null;
};

type ScoringRosterSlot = {
  playerId: string;
  slot: string;
  player: { name: string };
};

function scoreRosterSlots(
  roster: readonly ScoringRosterSlot[],
  rosterIdentities: readonly TournamentRosterIdentity[],
  lines: readonly WeeklyFantasyLine[],
  context: { tournamentId: string; ownerUsername: string },
) {
  let rosterPts = 0;
  const contributions = roster
    .filter((slot) => slot.slot !== "BENCH")
    .map((slot): PlayerWeekContribution => {
      const exception = fantasyRosterTradeExceptionForRosterPlayer(
        context.tournamentId,
        context.ownerUsername,
        slot.playerId,
      );
      const effectivePlayerId = exception?.replacesPlayerId === slot.playerId
        ? exception.playerId
        : slot.playerId;
      const contribution = resolveRosterWeekContribution(
        effectivePlayerId,
        rosterIdentities,
        lines,
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
        playerName: effectivePlayerId === exception?.playerId
          ? exception.playerName
          : slot.player.name,
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
  return { rosterPts: round1(rosterPts), contributions };
}

export interface TeamWeekScore {
  weekNumber: number;
  rosterPts: number;
  pickemPts: number;
  provisional: boolean;
  roster: PlayerWeekContribution[];
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
  hasProvisional: boolean;
  provisionalWeek: number | null;
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
  const [allWeeks, rosterIdentities] = await Promise.all([
    loadWeeks(league.tournamentId),
    prisma.tournamentPlayer.findMany({
      where: { tournamentId: league.tournamentId },
      select: { playerId: true, teamId: true, role: true },
    }),
  ]);
  // Once lifecycle rows exist, public standings use only commissioner-published
  // score snapshots plus a request-time provisional score for the currently
  // locked live week. The provisional row is never written to WeeklyScore.
  if (league.leagueWeeks.length > 0) {
    const published = league.leagueWeeks.filter(
      (lw) => lw.status === "PUBLISHED" && (cutoff === null || lw.week.endsAt < cutoff),
    );
    const liveLeagueWeek = cutoff === null ? null : league.leagueWeeks.find(
      (lw) =>
        lw.week.number === league.currentWeek + 1 &&
        ["LOCKED", "RESULTS_IMPORTED", "SCORED"].includes(lw.status) &&
        lw.weeklyRosters.length > 0,
    );
    const liveWeek = liveLeagueWeek
      ? allWeeks.find((week) => week.id === liveLeagueWeek.weekId)
      : null;
    const visibleLiveMatches = liveWeek
      ? liveWeek.matches
          .filter((match) => match.scheduledAt < cutoff!)
          .map((match) => ({
            ...match,
            games: match.games.filter((game) =>
              game.winner !== null && (game.playedAt ?? match.scheduledAt) < cutoff!,
            ),
          }))
      : [];
    const liveGames = visibleLiveMatches.flatMap((match) =>
      match.games,
    );
    const livePicks = liveGames.length > 0
      ? await prisma.pickem.findMany({
          where: { leagueId: league.id, match: { weekId: liveWeek!.id } },
        })
      : [];
    const crystalSettled = league.seasonStatus === "FINAL";
    const standings: FantasyStanding[] = league.fantasyTeams.map((ft) => {
      const weekly: TeamWeekScore[] = published.map((lw) => {
        const score = lw.weeklyScores.find((row) => row.fantasyTeamId === ft.id);
        return {
          weekNumber: lw.week.number,
          rosterPts: score?.rosterPts ?? 0,
          pickemPts: score?.pickemPts ?? 0,
          provisional: false,
          roster: parseRosterBreakdown(score?.breakdown),
        };
      });
      if (liveLeagueWeek && liveWeek && liveGames.length > 0) {
        const roster = liveLeagueWeek.weeklyRosters.filter(
          (slot) => slot.fantasyTeamId === ft.id && slot.slot !== "BENCH",
        );
        const liveRoster = scoreRosterSlots(
          roster,
          rosterIdentities,
          weeklyFantasyLines(visibleLiveMatches, cfg),
          { tournamentId: league.tournamentId, ownerUsername: ft.user.username },
        );
        let livePickemPts = 0;
        for (const match of visibleLiveMatches) {
          if (!match.winner || match.team1Score == null || match.team2Score == null) continue;
          const pick = livePicks.find(
            (row) => row.userId === ft.userId && row.matchId === match.id,
          );
          if (!pick) continue;
          livePickemPts += pickemPoints(
            pick.predictedWinner,
            pick.predictedScore,
            match.winner,
            `${match.team1Score}-${match.team2Score}`,
            cfg,
          );
        }
        weekly.push({
          weekNumber: liveWeek.number,
          rosterPts: liveRoster.rosterPts,
          pickemPts: livePickemPts,
          provisional: true,
          roster: liveRoster.contributions,
        });
      }
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
        hasProvisional: weekly.some((row) => row.provisional),
        provisionalWeek: weekly.find((row) => row.provisional)?.weekNumber ?? null,
      };
    }).sort((a, b) => b.total - a.total);
    return {
      standings,
      weeks: [
        ...published.map((lw) => ({ number: lw.week.number, startsAt: lw.week.startsAt, endsAt: lw.week.endsAt })),
        ...(liveLeagueWeek && liveWeek && liveGames.length > 0
          ? [{ number: liveWeek.number, startsAt: liveWeek.startsAt, endsAt: liveWeek.endsAt }]
          : []),
      ],
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
      const weeklyLines = weeklyFantasyLines(week.matches, cfg);
      const scoredRoster = scoreRosterSlots(
        ft.roster,
        rosterIdentities,
        weeklyLines,
        { tournamentId: league.tournamentId, ownerUsername: ft.user.username },
      );
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
      weekly.push({
        weekNumber: week.number,
        rosterPts: scoredRoster.rosterPts,
        pickemPts,
        provisional: false,
        roster: scoredRoster.contributions,
      });
    }
    // Crystal ball settles at the end of the split — mid-split cursor shows 0
    const crystalBallTotal = league.seasonStatus === "FINAL"
      ? league.cbQuestions.reduce((sum, question) => sum + crystalBallPoints(question, ft.userId), 0)
      : 0;

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
      hasProvisional: false,
      provisionalWeek: null,
    });
  }
  standings.sort((a, b) => b.total - a.total);
  return {
    standings,
    weeks: weeks.map((w) => ({ number: w.number, startsAt: w.startsAt, endsAt: w.endsAt })),
  };
}

function parseRosterBreakdown(value: string | undefined): PlayerWeekContribution[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as {
      roster?: Array<Partial<PlayerWeekContribution> & {
        playerId?: string;
        slot?: string;
        gamesPlayed?: number;
        rawPoints?: number;
        pointsPerGame?: number;
      }>;
    };
    if (!Array.isArray(parsed.roster)) return [];
    return parsed.roster.flatMap((row) => {
      if (!row.playerId || !row.slot) return [];
      return [{
        playerId: row.playerId,
        playerName: row.playerName ?? row.playerId,
        slot: row.slot,
        gamesPlayed: row.gamesPlayed ?? 0,
        rawPoints: row.rawPoints ?? 0,
        pointsPerGame: row.pointsPerGame ?? 0,
        creditedPoints: row.creditedPoints ?? row.pointsPerGame ?? 0,
        fallback: row.fallback ?? null,
        rosterException: row.rosterException ?? null,
      }];
    });
  } catch {
    return [];
  }
}

/** Pro-player leaderboard for a tournament (fantasy points per game). */
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
    include: {
      player: true,
      game: { include: { teamStats: true, playerTimeline: { where: { minute: 15 } } } },
    },
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
    row.pts += playerGamePoints(s, cfg, {
      lengthSec: s.game.lengthSec,
      teamObjectives: s.game.teamStats.find((team) => team.teamId === s.teamId),
      laneAt15: s.game.playerTimeline.find((row) => row.playerId === s.playerId),
    });
    row.k += s.kills;
    row.d += s.deaths;
    row.a += s.assists;
    row.team = s.teamId; // latest team
    rows.set(s.playerId, row);
  }
  const result = [...rows.values()].map((row) => ({
    ...row,
    totalPts: round1(row.pts),
    pts: round1(row.games > 0 ? row.pts / row.games : 0),
  }));
  return result.sort((a, b) => b.pts - a.pts);
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export const fmtDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "?";

export const fmtLength = (sec: number | null) =>
  sec === null ? "?" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
