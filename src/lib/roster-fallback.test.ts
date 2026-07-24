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
