import assert from "node:assert/strict";
import test from "node:test";
import { buildRosterGameAudits, type RosterAuditMatch, type RosterAuditSlot } from "./roster-game-audit";

const fallback = {
  reason: "DID_NOT_PLAY" as const,
  teamId: "DN SOOPers",
  role: "Support",
  substitutePlayerIds: ["Life"],
  substitutePointsPerGame: 18,
  teamAveragePointsPerGame: 16,
  creditedPoints: 16,
};

const matches: RosterAuditMatch[] = [{
  id: "dns-series",
  team1: "DN SOOPers",
  team2: "T1",
  scheduledAt: new Date("2026-08-02T08:00:00.000Z"),
  games: [{
    id: "dns-1",
    gameNumber: 1,
    playedAt: new Date("2026-08-02T08:00:00.000Z"),
    lines: [
      { playerId: "deokdam", playerName: "deokdam", teamId: "DN SOOPers", role: "Bot", points: 24 },
      { playerId: "Life", playerName: "Life", teamId: "DN SOOPers", role: "Support", points: 18 },
      { playerId: "dns-top", playerName: "Top", teamId: "DN SOOPers", role: "Top", points: 6 },
    ],
  }],
}];

test("game audit distinguishes matching nameplates, substitute credit, and bench observations", () => {
  const slots: RosterAuditSlot[] = [
    { id: 1, playerId: "Deokdam", playerName: "deokdam", slot: "BOT", teamId: "DN SOOPers", role: "Bot", creditedPoints: 24, fallback: null, assignmentException: null },
    { id: 2, playerId: "Peter", playerName: "Peter", slot: "SUP", teamId: "DN SOOPers", role: "Support", creditedPoints: 16, fallback, assignmentException: null },
    { id: 3, playerId: "Peter", playerName: "Peter", slot: "BENCH", teamId: "DN SOOPers", role: "Support", creditedPoints: 0, fallback, assignmentException: null },
  ];
  const [deokdam, peter, benchPeter] = buildRosterGameAudits(slots, matches);

  assert.equal(deokdam.series[0].games[0].status, "OWN");
  assert.equal(deokdam.series[0].games[0].points, 24);
  assert.equal(peter.series[0].games[0].status, "SUBSTITUTE_CREDIT");
  assert.equal(peter.series[0].games[0].actualPlayerName, "Life");
  assert.equal(peter.series[0].games[0].teamAveragePoints, 16);
  assert.equal(peter.series[0].games[0].fallbackCredit, 16);
  assert.equal(benchPeter.series[0].games[0].status, "OTHER_PLAYER");
});
