import assert from "node:assert/strict";
import test from "node:test";
import { mergeTournamentRosterOverrides } from "./tournament-roster-overrides";

test("R3-4 roster overrides keep Peter eligible without duplicating API rows", () => {
  const tournamentId = "LCK/2026 Season/Rounds 3-4";
  const added = mergeTournamentRosterOverrides(tournamentId, []);
  assert.deepEqual(added, [{ Player: "Peter", Name: "Peter", Team: "DN SOOPers", Role: "Support" }]);
  const existing = mergeTournamentRosterOverrides(tournamentId, [
    { Player: "Peter", Name: "Peter old", Team: "Old team", Role: "Top" },
  ]);
  assert.equal(existing.length, 1);
  assert.deepEqual(existing[0], added[0]);
});
