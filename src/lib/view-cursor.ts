export function resolveCompletedWeek({
  seasonStatus,
  currentWeek,
  requestedWeek,
  maxWeek,
}: {
  seasonStatus: string;
  currentWeek: number;
  requestedWeek: string | undefined;
  maxWeek: number;
}): number | null {
  // Active leagues always follow their commissioner-controlled lifecycle.
  // This applies to simulations too: a forged or stale cookie cannot reveal
  // historical results that the league has not published yet.
  if (seasonStatus !== "FINAL") return Math.max(0, Math.min(currentWeek, maxWeek));

  if (requestedWeek == null || requestedWeek === "final") return null;
  const parsed = Number.parseInt(requestedWeek, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= maxWeek) return null;
  return parsed;
}
