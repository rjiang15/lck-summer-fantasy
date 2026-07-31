import assert from "node:assert/strict";
import test from "node:test";
import { mergeTournamentRosterOverrides } from "./tournament-roster-overrides";

test("R3-4 roster overrides keep Peter eligible without duplicating API rows", () => {
  const tournamentId = "LCK/2026 Season/Rounds 3-4";
  const added = mergeTournamentRosterOverrides(tournamentId, []);
  assert.deepEqual(
    added.find((player) => player.Player === "Peter"),
    { Player: "Peter", Name: "Peter", Team: "DN SOOPers", Role: "Support" },
  );
  const existing = mergeTournamentRosterOverrides(tournamentId, [
    { Player: "Peter", Name: "Peter old", Team: "Old team", Role: "Top" },
  ]);
  assert.equal(existing.filter((player) => player.Player === "Peter").length, 1);
  assert.deepEqual(
    existing.find((player) => player.Player === "Peter"),
    added.find((player) => player.Player === "Peter"),
  );
});

test("R3-4 roster overrides pin the post-trade ADCs and both fallback options", () => {
  const roster = mergeTournamentRosterOverrides("LCK/2026 Season/Rounds 3-4", []);
  assert.deepEqual(
    roster.filter((player) => ["Aiming", "Jiwoo", "LazyFeel", "FenRir (Park Kang-jun)"].includes(player.Player)),
    [
      { Player: "Aiming", Name: "Aiming", Team: "Kiwoom DRX", Role: "Bot" },
      { Player: "Jiwoo", Name: "Jiwoo", Team: "KT Rolster", Role: "Bot" },
      { Player: "LazyFeel", Name: "LazyFeel", Team: "Kiwoom DRX", Role: "Bot" },
      { Player: "FenRir (Park Kang-jun)", Name: "FenRir", Team: "KT Rolster", Role: "Bot" },
    ],
  );
});
