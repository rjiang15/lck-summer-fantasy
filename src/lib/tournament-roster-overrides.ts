export type TournamentRosterEntry = {
  Player: string;
  Name: string;
  Team: string;
  Role: string | null;
};

export const TOURNAMENT_ROSTER_OVERRIDES: Record<string, readonly TournamentRosterEntry[]> = {
  "LCK/2026 Season/Rounds 3-4": [
    { Player: "Peter", Name: "Peter", Team: "DN SOOPers", Role: "Support" },
    { Player: "Aiming", Name: "Aiming", Team: "Kiwoom DRX", Role: "Bot" },
    { Player: "Jiwoo", Name: "Jiwoo", Team: "KT Rolster", Role: "Bot" },
    { Player: "LazyFeel", Name: "LazyFeel", Team: "Kiwoom DRX", Role: "Bot" },
    { Player: "FenRir (Park Kang-jun)", Name: "FenRir", Team: "KT Rolster", Role: "Bot" },
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
