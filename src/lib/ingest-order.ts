export interface SharedWeekState {
  number: number;
  scheduleReady: boolean;
  resultsReady: boolean;
  /** Final series winners/scores may be ready before detailed game stats. */
  seriesResultsReady?: boolean;
}

/** Enforce one canonical, chronological LCK dataset independent of fantasy leagues. */
export function assertSequentialIngest(
  requestedWeek: number,
  scheduleOnly: boolean,
  weeks: SharedWeekState[],
  resultsPublished = false,
) {
  if (!Number.isInteger(requestedWeek) || requestedWeek < 1) throw new Error("The ingest week must be a positive whole number");
  const target = weeks.find((week) => week.number === requestedWeek);
  if (scheduleOnly) {
    const ready = weeks.filter((week) => week.scheduleReady).map((week) => week.number);
    const next = ready.length ? Math.max(...ready) + 1 : 1;
    if (!target?.scheduleReady && requestedWeek !== next) throw new Error(`Week ${next} schedule must be fetched next`);
    const previous = weeks.find((week) => week.number === requestedWeek - 1);
    if (requestedWeek > 1 && !previous?.resultsReady && !previous?.seriesResultsReady) {
      throw new Error(`Import Week ${requestedWeek - 1} results before fetching Week ${requestedWeek}`);
    }
    return;
  }
  if (!target?.scheduleReady) throw new Error(`Fetch the Week ${requestedWeek} schedule before fetching results`);
  if (target.resultsReady && resultsPublished) throw new Error(`Week ${requestedWeek} results are already used by a published league and cannot be refreshed`);
}
