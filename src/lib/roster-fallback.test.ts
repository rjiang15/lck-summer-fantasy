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

test("Gol casing differences do not turn rostered Deokdam into his own substitute", () => {
  const result = resolveRosterWeekContribution("Deokdam", [
    { playerId: "Deokdam", teamId: "DN SOOPers", role: "Bot" },
    { playerId: "deokdam", teamId: "DN SOOPers", role: "Bot" },
    { playerId: "dns-top", teamId: "DN SOOPers", role: "Top" },
  ], [
    { gameId: "dns-1", playerId: "deokdam", teamId: "DN SOOPers", role: "Bot", points: 28 },
    { gameId: "dns-1", playerId: "dns-top", teamId: "DN SOOPers", role: "Top", points: 12 },
    { gameId: "dns-2", playerId: "deokdam", teamId: "DN SOOPers", role: "Bot", points: 32 },
    { gameId: "dns-2", playerId: "dns-top", teamId: "DN SOOPers", role: "Top", points: 18 },
  ]);

  assert.equal(result.gamesPlayed, 2);
  assert.equal(result.rawPoints, 60);
  assert.equal(result.creditedPoints, 30);
  assert.equal(result.fallback, null);
});

test("Leaguepedia real-name suffixes do not turn rostered Peter into his own substitute", () => {
  const result = resolveRosterWeekContribution("Peter", [
    { playerId: "Peter", teamId: "DN SOOPers", role: "Support" },
    { playerId: "Peter (Jeong Yoon-su)", teamId: "DN SOOPers", role: "Support" },
    { playerId: "Life", teamId: "DN SOOPers", role: "Support" },
  ], [
    { gameId: "dns-1", playerId: "Peter (Jeong Yoon-su)", teamId: "DN SOOPers", role: "Support", points: 19 },
    { gameId: "dns-2", playerId: "Peter (Jeong Yoon-su)", teamId: "DN SOOPers", role: "Support", points: 23 },
  ]);

  assert.equal(result.gamesPlayed, 2);
  assert.equal(result.rawPoints, 42);
  assert.equal(result.creditedPoints, 21);
  assert.equal(result.fallback, null);
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

test("a replacement ownership slot keeps outgoing results before the effective date", () => {
  const result = resolveRosterWeekContribution("Jiwoo", [
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", role: "Bot" },
    { playerId: "Jiwoo", teamId: "KT Rolster", role: "Bot" },
  ], [
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 21, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { playerId: "Jiwoo", teamId: "KT Rolster", points: 33, playedAt: new Date("2026-07-31T08:00:00.000Z") },
    // Neither player counts on the other side of the ownership cutoff.
    { playerId: "Jiwoo", teamId: "Kiwoom DRX", points: 300, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 400, playedAt: new Date("2026-07-31T08:00:00.000Z") },
  ], {
    id: "jiwoo-replaces-lazyfeel",
    effectiveAt: new Date("2026-07-30T00:00:00.000Z"),
    previousPlayerId: "LazyFeel",
    previousTeamId: "Kiwoom DRX",
    currentTeamId: "KT Rolster",
    role: "Bot",
  });
  assert.equal(result.gamesPlayed, 2);
  assert.equal(result.rawPoints, 54);
  assert.equal(result.creditedPoints, 27);
  assert.equal(result.fallback, null);
});

test("a pre-trade starter line does not suppress the post-trade substitute credit", () => {
  const effectiveAt = new Date("2026-07-30T00:00:00.000Z");
  const result = resolveRosterWeekContribution("Jiwoo", [
    { playerId: "LazyFeel", teamId: "Kiwoom DRX", role: "Bot" },
    { playerId: "Jiwoo", teamId: "KT Rolster", role: "Bot" },
    { playerId: "FenRir (Park Kang-jun)", teamId: "KT Rolster", role: "Bot" },
    { playerId: "kt-top", teamId: "KT Rolster", role: "Top" },
  ], [
    { gameId: "krx-1", playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 20, playedAt: new Date("2026-07-29T08:00:00.000Z") },
    { gameId: "krx-2", playerId: "LazyFeel", teamId: "Kiwoom DRX", points: 30, playedAt: new Date("2026-07-29T09:00:00.000Z") },
    { gameId: "kt-1", playerId: "FenRir (Park Kang-jun)", teamId: "KT Rolster", points: 30, playedAt: new Date("2026-08-02T08:00:00.000Z") },
    { gameId: "kt-1", playerId: "kt-top", teamId: "KT Rolster", points: 10, playedAt: new Date("2026-08-02T08:00:00.000Z") },
    { gameId: "kt-2", playerId: "FenRir (Park Kang-jun)", teamId: "KT Rolster", points: 30, playedAt: new Date("2026-08-02T09:00:00.000Z") },
    { gameId: "kt-2", playerId: "kt-top", teamId: "KT Rolster", points: 10, playedAt: new Date("2026-08-02T09:00:00.000Z") },
    { gameId: "kt-3", playerId: "FenRir (Park Kang-jun)", teamId: "KT Rolster", points: 30, playedAt: new Date("2026-08-02T10:00:00.000Z") },
    { gameId: "kt-3", playerId: "kt-top", teamId: "KT Rolster", points: 10, playedAt: new Date("2026-08-02T10:00:00.000Z") },
  ], {
    id: "jiwoo-replaces-lazyfeel",
    effectiveAt,
    previousPlayerId: "LazyFeel",
    previousTeamId: "Kiwoom DRX",
    currentTeamId: "KT Rolster",
    role: "Bot",
  });

  assert.equal(result.gamesPlayed, 2);
  assert.equal(result.pointsPerGame, 25);
  assert.deepEqual(result.fallback?.substitutePlayerIds, ["FenRir (Park Kang-jun)"]);
  assert.equal(result.fallback?.substitutePointsPerGame, 30);
  assert.equal(result.fallback?.teamAveragePointsPerGame, 20);
  assert.equal(result.fallback?.creditedPoints, 20);
  assert.equal(result.creditedPoints, 22);
});
