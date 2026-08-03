import { validSeriesPrediction } from "./season";

export type SeriesResult = {
  bestOf: number;
  team1: string;
  team2: string;
  winner: string | null;
  team1Score: number | null;
  team2Score: number | null;
};

export function areWeekSeriesResultsComplete(matches: readonly SeriesResult[]) {
  return matches.length > 0 && matches.every((match) => {
    if (!match.winner || match.team1Score === null || match.team2Score === null) return false;
    return validSeriesPrediction(
      match.bestOf,
      match.team1,
      match.team2,
      match.winner,
      `${match.team1Score}-${match.team2Score}`,
    );
  });
}

type LeagueWeekProgress = {
  status: string;
  picksLockedAt: Date | null;
  rosterLockedAt: Date | null;
  week: { number: number; matches: readonly SeriesResult[] };
};

export function canOpenWeekPicks(
  candidate: LeagueWeekProgress,
  previous: LeagueWeekProgress | null,
) {
  if (candidate.status !== "UPCOMING") return false;
  if (candidate.week.number === 1) return previous === null;
  if (!previous || previous.week.number !== candidate.week.number - 1) return false;
  if (!previous.picksLockedAt || !previous.rosterLockedAt) return false;
  if (!["LOCKED", "RESULTS_IMPORTED", "SCORED", "PUBLISHED"].includes(previous.status)) return false;
  return previous.status === "PUBLISHED" || areWeekSeriesResultsComplete(previous.week.matches);
}

export function canUnlockWeekPicks(
  week: Pick<LeagueWeekProgress, "status" | "picksLockedAt"> & { matches: readonly SeriesResult[] },
  laterWeekOpened: boolean,
) {
  return week.status === "LOCKED"
    && Boolean(week.picksLockedAt)
    && !laterWeekOpened
    && !areWeekSeriesResultsComplete(week.matches);
}

export function shouldOpenNextWeekOnPublication(status: string) {
  return status === "UPCOMING";
}

export function canManageFutureRosters(currentWeek: number, latestOpenedWeek: number | null) {
  return currentWeek > 0 || (latestOpenedWeek ?? 0) > 1;
}
