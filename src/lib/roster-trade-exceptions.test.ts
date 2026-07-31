import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveFantasyRosterPlayerId,
  fantasyRosterTradeException,
  fantasyRosterTradeExceptionForRosterPlayer,
  fantasyRosterTradeExceptionsForOwners,
  rosterPlayerMatchesTradeException,
} from "./roster-trade-exceptions";

const tournamentId = "LCK/2026 Season/Rounds 3-4";

test("the ADC trade exceptions are scoped to the approved owner and player pairs", () => {
  const howard = fantasyRosterTradeException(tournamentId, "PerpetualOwl", "Aiming");
  assert.equal(howard?.previousTeamId, "KT Rolster");
  assert.equal(howard?.currentTeamId, "Kiwoom DRX");
  assert.equal(howard?.retainedGroup, "Legends");

  const ryan = fantasyRosterTradeException(tournamentId, "RYAN", "Jiwoo");
  assert.equal(ryan?.replacesPlayerId, "LazyFeel");
  assert.equal(ryan?.previousTeamId, "Kiwoom DRX");
  assert.equal(ryan?.currentTeamId, "KT Rolster");
  assert.equal(ryan?.retainedGroup, "Rise");

  assert.equal(fantasyRosterTradeException(tournamentId, "ryan", "Aiming"), null);
  assert.equal(fantasyRosterTradeException(tournamentId, "someone-else", "Jiwoo"), null);
  assert.equal(fantasyRosterTradeException("LCK/2026 Season/Rounds 1-2", "ryan", "Jiwoo"), null);
});

test("Ryan's stored LazyFeel slot resolves to Jiwoo for the current and future roster", () => {
  const exception = fantasyRosterTradeExceptionForRosterPlayer(
    tournamentId,
    "ryan",
    "LazyFeel",
  );
  assert.equal(exception?.playerId, "Jiwoo");
  assert.equal(
    effectiveFantasyRosterPlayerId(tournamentId, "ryan", "LazyFeel"),
    "Jiwoo",
  );
  assert.equal(
    effectiveFantasyRosterPlayerId(tournamentId, "someone-else", "LazyFeel"),
    "LazyFeel",
  );
  assert.equal(
    rosterPlayerMatchesTradeException(exception!, ["LazyFeel"]),
    true,
  );
});

test("the UI exception list only reveals rulings for owners in the league", () => {
  assert.deepEqual(
    fantasyRosterTradeExceptionsForOwners(tournamentId, ["PerpetualOwl"]).map((row) => row.playerId),
    ["Aiming"],
  );
  assert.deepEqual(
    fantasyRosterTradeExceptionsForOwners(tournamentId, ["ryan", "PerpetualOwl"]).map((row) => row.playerId),
    ["Aiming", "Jiwoo"],
  );
});
