import assert from "node:assert/strict";
import test from "node:test";
import { resolveRosterWeekContribution, type TournamentRosterIdentity, type WeeklyFantasyLine } from "./roster-fallback";

const roster: TournamentRosterIdentity[] = [
  { playerId: "starter", teamId: "DNS", role: "Support" },
  { playerId: "sub", teamId: "DNS", role: "Support" },
  { playerId: "top", teamId: "DNS", role: "Top" },
  { playerId: "opponent", teamId: "T1", role: "Support" },
];

test("a player who played keeps their own points without substitute assistance", () => {
  const lines: WeeklyFantasyLine[] = [
    { playerId: "starter", teamId: "DNS", points: 24 },
    { playerId: "sub", teamId: "DNS", points: 40 },
  ];
  assert.deepEqual(resolveRosterWeekContribution("starter", roster, lines), {
    gamesPlayed: 1, rawPoints: 24, pointsPerGame: 24, creditedPoints: 24, fallback: null,
  });
});

test("a zero-game player receives the lower of shared-slot production and team average", () => {
  const lines: WeeklyFantasyLine[] = [
    { playerId: "sub", teamId: "DNS", points: 32 },
    { playerId: "sub", teamId: "DNS", points: 28 },
    { playerId: "top", teamId: "DNS", points: 10 },
    { playerId: "top", teamId: "DNS", points: 10 },
    { playerId: "opponent", teamId: "T1", points: 1 },
  ];
  const result = resolveRosterWeekContribution("starter", roster, lines);
  assert.equal(result.gamesPlayed, 0);
  assert.equal(result.pointsPerGame, 0);
  assert.equal(result.fallback?.substitutePointsPerGame, 30);
  assert.equal(result.fallback?.teamAveragePointsPerGame, 20);
  assert.equal(result.creditedPoints, 20);
  assert.deepEqual(result.fallback?.substitutePlayerIds, ["sub"]);
});

test("the substitute slot remains the cap when its production is below the team average", () => {
  const result = resolveRosterWeekContribution("starter", roster, [
    { playerId: "sub", teamId: "DNS", points: 10 },
    { playerId: "top", teamId: "DNS", points: 30 },
  ]);
  assert.equal(result.fallback?.substitutePointsPerGame, 10);
  assert.equal(result.fallback?.teamAveragePointsPerGame, 20);
  assert.equal(result.creditedPoints, 10);
});

test("fallback is zero when no same-team same-role player took the slot", () => {
  const result = resolveRosterWeekContribution("starter", roster, [
    { playerId: "top", teamId: "DNS", points: 25 },
    { playerId: "opponent", teamId: "T1", points: 40 },
  ]);
  assert.equal(result.creditedPoints, 0);
  assert.equal(result.fallback, null);
});

test("an effective-dated trade exception preserves old-team lines and switches future fallback lines", () => {
  const effectiveAt = new Date("2026-07-30T00:00:00.000Z");
  const timedRoster: TournamentRosterIdentity[] = [
    { playerId: "Aiming", teamId: "Kiwoom DRX", role: "Bot" },
    { playerId: "FenRir", teamId: "KT Rolster", role: "Bot" },
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", role: "Bot" },
    { playerId: "kt-top", teamId: "KT Rolster", role: "Top" },
    { playerId: "krx-top", teamId: "Kiwoom DRX", role: "Top" },
  ];
  const result = resolveRosterWeekContribution("Aiming", timedRoster, [
    { playerId: "FenRir", teamId: "KT Rolster", points: 10, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { playerId: "kt-top", teamId: "KT Rolster", points: 30, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 50, playedAt: new Date("2026-07-30T08:00:00.000Z") },
    { playerId: "krx-top", teamId: "Kiwoom DRX", points: 10, playedAt: new Date("2026-07-30T08:00:00.000Z") },
    // These are on the wrong team for their side of the cutoff and must not count.
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 500, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { playerId: "FenRir", teamId: "KT Rolster", points: 500, playedAt: new Date("2026-07-30T08:00:00.000Z") },
  ], {
    id: "aiming-trade",
    effectiveAt,
    previousTeamId: "KT Rolster",
    currentTeamId: "Kiwoom DRX",
    role: "Bot",
  });
  assert.deepEqual(result.fallback?.substitutePlayerIds, ["FenRir", "LazyFeel"]);
  assert.equal(result.fallback?.substitutePointsPerGame, 30);
  assert.equal(result.fallback?.teamAveragePointsPerGame, 25);
  assert.equal(result.creditedPoints, 25);
  assert.equal(result.fallback?.teamId, "Kiwoom DRX");
});

test("a retained player who plays after the trade receives their own points without a penalty", () => {
  const result = resolveRosterWeekContribution("Jiwoo", [
    { playerId: "Jiwoo", teamId: "KT Rolster", role: "Bot" },
    { playerId: "FenRir", teamId: "KT Rolster", role: "Bot" },
  ], [
    { playerId: "Jiwoo", teamId: "KT Rolster", points: 33, playedAt: new Date("2026-07-31T08:00:00.000Z") },
    { playerId: "FenRir", teamId: "KT Rolster", points: 50, playedAt: new Date("2026-07-31T08:00:00.000Z") },
  ], {
    id: "jiwoo-trade",
    effectiveAt: new Date("2026-07-30T00:00:00.000Z"),
    previousTeamId: "Kiwoom DRX",
    currentTeamId: "KT Rolster",
    role: "Bot",
  });
  assert.equal(result.creditedPoints, 33);
  assert.equal(result.fallback, null);
});
