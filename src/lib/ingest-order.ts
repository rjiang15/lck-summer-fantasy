export interface LeagueIngestState {
  currentWeek: number;
  targetStatus: string | null;
}

const SCHEDULE_STATUSES = new Set<string | null>([null, "UPCOMING", "OPEN"]);
const RESULT_STATUSES = new Set<string | null>(["LOCKED", "RESULTS_IMPORTED"]);

/** Enforce the season's one-week-at-a-time import state machine. */
export function assertSequentialIngest(
  requestedWeek: number,
  scheduleOnly: boolean,
  leagues: LeagueIngestState[],
) {
  if (!Number.isInteger(requestedWeek) || requestedWeek < 1) {
    throw new Error("The ingest week must be a positive whole number");
  }

  for (const league of leagues) {
    const expectedWeek = league.currentWeek + 1;
    if (requestedWeek !== expectedWeek) {
      throw new Error(
        `Week ${expectedWeek} must be fetched next; Week ${requestedWeek} would be out of order`,
      );
    }

    if (scheduleOnly && !SCHEDULE_STATUSES.has(league.targetStatus)) {
      throw new Error(
        `Week ${requestedWeek} is already ${league.targetStatus}; its schedule can no longer be changed`,
      );
    }

    if (!scheduleOnly && !RESULT_STATUSES.has(league.targetStatus)) {
      if (league.targetStatus === null) {
        throw new Error(`Fetch the Week ${requestedWeek} schedule before fetching results`);
      }
      if (league.targetStatus === "UPCOMING" || league.targetStatus === "OPEN") {
        throw new Error(`Lock Week ${requestedWeek} picks and rosters before fetching results`);
      }
      throw new Error(
        `Week ${requestedWeek} is already ${league.targetStatus}; its results can no longer be changed`,
      );
    }
  }
}
