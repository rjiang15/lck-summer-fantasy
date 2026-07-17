const PUBLIC_RESULTS_STATUSES = new Set(["RESULTS_IMPORTED", "SCORED", "PUBLISHED"]);

export function areWeeklyPicksPublic(week: { picksLockedAt: Date | null; status: string }) {
  return week.picksLockedAt !== null || PUBLIC_RESULTS_STATUSES.has(week.status);
}
