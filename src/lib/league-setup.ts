export function initialLeagueWeekRows(
  leagueId: number,
  scheduledWeeks: Array<{ id: number }>,
  openedAt: Date,
) {
  return scheduledWeeks.map((week, index) => ({
    leagueId,
    weekId: week.id,
    status: index === 0 ? "OPEN" : "UPCOMING",
    picksOpenAt: index === 0 ? openedAt : null,
  }));
}
