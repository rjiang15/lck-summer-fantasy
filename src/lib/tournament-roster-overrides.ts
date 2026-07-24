export type TournamentRosterEntry = {
  Player: string;
  Name: string;
  Team: string;
  Role: string | null;
};

export const TOURNAMENT_ROSTER_OVERRIDES: Record<string, readonly TournamentRosterEntry[]> = {
  "LCK/2026 Season/Rounds 3-4": [
    { Player: "Peter", Name: "Peter", Team: "DN SOOPers", Role: "Support" },
  ],
};

export function mergeTournamentRosterOverrides(
  tournamentId: string,
  roster: readonly TournamentRosterEntry[],
): TournamentRosterEntry[] {
  const merged = new Map(roster.map((player) => [player.Player, { ...player }]));
  for (const player of TOURNAMENT_ROSTER_OVERRIDES[tournamentId] ?? []) {
    merged.set(player.Player, { ...player });
  }
  return [...merged.values()];
}
