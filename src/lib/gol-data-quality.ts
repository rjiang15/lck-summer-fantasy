import { normalizeGolIdentity } from "./games-of-legends";

const ROUNDS_3_4 = "LCK/2026 Season/Rounds 3-4";

export type GolSeriesQualityOverride = {
  winner: string;
  team1Score: number;
  team2Score: number;
  quarantineDetailedStats: boolean;
  reason: string;
};

/**
 * Narrow, auditable exceptions for source rows that are known to be wrong.
 * Never infer these from a surprising score: each entry must identify one
 * verified series so an unrelated Gol correction cannot be silently ignored.
 */
export function golSeriesQualityOverride({
  tournamentId,
  date,
  summaryGameId,
  team1,
  team2,
}: {
  tournamentId: string;
  date: string;
  summaryGameId: string;
  team1: string;
  team2: string;
}): GolSeriesQualityOverride | null {
  const teams = new Set([normalizeGolIdentity(team1), normalizeGolIdentity(team2)]);
  if (
    tournamentId !== ROUNDS_3_4 ||
    date !== "2026-08-01" ||
    summaryGameId !== "80675" ||
    !teams.has("geng") ||
    !teams.has("dpluskia")
  ) return null;

  const dplus = normalizeGolIdentity(team1) === "dpluskia" ? team1 : team2;
  return {
    winner: dplus,
    team1Score: dplus === team1 ? 2 : 0,
    team2Score: dplus === team2 ? 2 : 0,
    quarantineDetailedStats: true,
    reason:
      "Gol series 80675 is quarantined: its 1-1 match-list row conflicts with the verified 2-0 result, and its supposed Game 1 duplicates/mislabels Game 2 data and draft information.",
  };
}

type DisabledChampionWindow = {
  tournamentId: string;
  champion: string;
  startsOn: string;
  endsOn: string;
};

// Week 11 (fantasy Week 2) is deliberately date-bounded. If the competitive
// disable continues, extend the window explicitly instead of suppressing a
// legitimate Maokai team ban later in the tournament.
const DISABLED_CHAMPION_WINDOWS: DisabledChampionWindow[] = [{
  tournamentId: ROUNDS_3_4,
  champion: "Maokai",
  startsOn: "2026-08-05",
  endsOn: "2026-08-09",
}];

export function isGloballyDisabledChampionBan({
  tournamentId,
  date,
  champion,
}: {
  tournamentId: string;
  date: string;
  champion: string;
}) {
  return DISABLED_CHAMPION_WINDOWS.some((window) =>
    window.tournamentId === tournamentId &&
    normalizeGolIdentity(window.champion) === normalizeGolIdentity(champion) &&
    date >= window.startsOn &&
    date <= window.endsOn,
  );
}
