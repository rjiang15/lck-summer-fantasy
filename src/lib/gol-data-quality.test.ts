import assert from "node:assert/strict";
import test from "node:test";
import {
  golSeriesQualityOverride,
  isGloballyDisabledChampionBan,
} from "./gol-data-quality";

const tournamentId = "LCK/2026 Season/Rounds 3-4";

test("reconciles only the known corrupted Gen.G-DK source series", () => {
  assert.deepEqual(golSeriesQualityOverride({
    tournamentId,
    date: "2026-08-01",
    summaryGameId: "80675",
    team1: "Gen.G",
    team2: "Dplus Kia",
  }), {
    winner: "Dplus Kia",
    team1Score: 0,
    team2Score: 2,
    quarantineDetailedStats: false,
    manualReconciliationId: "2026-08-01-gen-dk",
    reason: "Gol series 80675 is replaced by the audited Gen.G-DK mixed-source package: its 1-1 match-list row conflicts with the verified 2-0 result, and its supposed Game 1 duplicates/mislabels Game 2 data and draft information.",
  });
  assert.equal(golSeriesQualityOverride({
    tournamentId,
    date: "2026-08-01",
    summaryGameId: "80676",
    team1: "Gen.G",
    team2: "Dplus Kia",
  }), null);
});

test("Maokai's Week 11 global disable is not credited as a team ban", () => {
  assert.equal(isGloballyDisabledChampionBan({
    tournamentId,
    date: "2026-08-05",
    champion: "Maokai",
  }), true);
  assert.equal(isGloballyDisabledChampionBan({
    tournamentId,
    date: "2026-08-04",
    champion: "Maokai",
  }), false);
  assert.equal(isGloballyDisabledChampionBan({
    tournamentId,
    date: "2026-08-06",
    champion: "Vi",
  }), false);
});
