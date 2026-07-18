const REQUIRED_STARTERS = ["TOP", "JNG", "MID", "BOT", "SUP"];

export function rosterLockError({
  currentWeek,
  draftStatus,
  teams,
}: {
  currentWeek: number;
  draftStatus: string;
  teams: Array<{ roster: Array<{ slot: string }> }>;
}) {
  if (currentWeek === 0 && draftStatus !== "COMPLETE") {
    return "Complete the initial roster draft before locking roster editing";
  }
  if (teams.length === 0) return "Add at least one participant fantasy team before locking roster editing";
  const incomplete = teams.filter((team) =>
    REQUIRED_STARTERS.some((slot) => !team.roster.some((row) => row.slot === slot)),
  );
  if (incomplete.length > 0) {
    return `${incomplete.length} fantasy team${incomplete.length === 1 ? " is" : "s are"} missing a complete starting roster`;
  }
  return null;
}
