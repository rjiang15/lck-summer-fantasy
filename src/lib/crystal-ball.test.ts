import assert from "node:assert/strict";
import test from "node:test";
import {
  crystalBallPoints,
  crystalBallPredictionsPublic,
  DEFAULT_CRYSTAL_BALL,
  resolveCrystalBallMetric,
  type CrystalBallSnapshot,
} from "./crystal-ball";

function snapshot(): CrystalBallSnapshot {
  const games: CrystalBallSnapshot["games"] = Array.from({ length: 12 }, (_, index) => ({
    id: `game-${index + 1}`,
    winner: index < 9 ? "Team A" : "Team B",
    lengthSec: index === 0 ? 1_200 : index === 11 ? 2_700 : 1_800 + index,
    playerStats: [
      { playerId: "p1", teamId: "Team A", champion: "Ahri", kills: index === 0 ? 15 : 3, deaths: 1, assists: 6, cs: index === 0 ? 410 : 250, pentakills: index === 0 ? 1 : 0, won: index < 9 },
      { playerId: "p2", teamId: "Team B", champion: "Azir", kills: index === 11 ? 10 : 1, deaths: 4, assists: 2, cs: 220, pentakills: 0, won: index >= 9 },
      ...(index < 4 ? [{ playerId: "p3", teamId: "Team A", champion: ["Gnar", "Renekton", "Camille", "Gnar"][index], kills: 1, deaths: 2, assists: 1, cs: 180, pentakills: 0, won: true }] : []),
      ...(index < 3 ? [{ playerId: "p4", teamId: "Team B", champion: ["Jax", "Kennen", "Sion"][index], kills: 0, deaths: 2, assists: 1, cs: 170, pentakills: 0, won: false }] : []),
    ],
    teamStats: [
      { teamId: "Team A", barons: index < 6 ? 1 : 0, elderDragons: index < 2 ? 1 : 0, cloudDrakes: 0, infernalDrakes: 1, mountainDrakes: 2, oceanDrakes: 0, hextechDrakes: 0, chemtechDrakes: 0 },
      { teamId: "Team B", barons: index < 2 ? 1 : 0, elderDragons: 0, cloudDrakes: 1, infernalDrakes: 0, mountainDrakes: 0, oceanDrakes: 0, hextechDrakes: 0, chemtechDrakes: 0 },
    ],
    draftActions: [
      { action: "BAN", champion: "Azir" },
      ...(index < 4 ? [{ action: "BAN", champion: "Ahri" }] : []),
    ],
  }));
  return {
    games,
    matches: [
      { winner: "DN SOOPers" },
      { winner: "DN SOOPers" },
      { winner: "DN SOOPers" },
      { winner: "T1" },
    ],
  };
}

test("approved Crystal Ball set has twenty unique automatic metrics", () => {
  assert.equal(DEFAULT_CRYSTAL_BALL.length, 20);
  assert.equal(new Set(DEFAULT_CRYSTAL_BALL.map((question) => question.metricKey)).size, 20);
  assert.ok(DEFAULT_CRYSTAL_BALL.slice(0, 10).every((question) => question.gradingMode === "RANKED" && question.points === 50));
  assert.ok(DEFAULT_CRYSTAL_BALL.slice(10).every((question) => question.gradingMode !== "RANKED" && question.points === 30));
});

test("ranked metrics store dense podium tiers, including ties", () => {
  const result = resolveCrystalBallMetric("CHAMP_MOST_BANNED", snapshot());
  assert.deepEqual(result.ranking?.slice(0, 2), [
    { rank: 1, answers: ["Azir"], value: 12 },
    { rank: 2, answers: ["Ahri"], value: 4 },
  ]);
});

test("champion rate metrics enforce more than ten picks", () => {
  const data = snapshot();
  assert.deepEqual(resolveCrystalBallMetric("CHAMP_HIGHEST_WIN_RATE", data, { minimumPicksExclusive: 10 }).acceptedAnswers, ["Ahri"]);
  assert.deepEqual(resolveCrystalBallMetric("CHAMP_LOWEST_WIN_RATE", data, { minimumPicksExclusive: 10 }).acceptedAnswers, ["Azir"]);
});

test("widest player pool uses fewer games as its explicit tiebreak", () => {
  const result = resolveCrystalBallMetric("PLAYER_WIDEST_POOL", snapshot());
  assert.deepEqual(result.acceptedAnswers, ["p4"]);
  assert.match(result.evidence, /3 unique champions in 3 games/);
});

test("one-game, objective, drake, penta, and series metrics resolve from stored lines", () => {
  const data = snapshot();
  assert.deepEqual(resolveCrystalBallMetric("PLAYER_MOST_KILLS_GAME", data).acceptedAnswers, ["p1"]);
  assert.deepEqual(resolveCrystalBallMetric("PLAYER_MOST_CS_GAME", data).acceptedAnswers, ["p1"]);
  assert.deepEqual(resolveCrystalBallMetric("TEAM_MOST_BARONS", data).acceptedAnswers, ["Team A"]);
  assert.deepEqual(resolveCrystalBallMetric("TEAM_SHORTEST_WIN", data).acceptedAnswers, ["Team A"]);
  assert.deepEqual(resolveCrystalBallMetric("TEAM_LONGEST_WIN", data).acceptedAnswers, ["Team B"]);
  assert.equal(resolveCrystalBallMetric("GAME_MOST_COMBINED_KILLS", data).target, 17);
  assert.equal(resolveCrystalBallMetric("TOTAL_PENTAKILLS", data).acceptedAnswers[0], "1");
  assert.deepEqual(resolveCrystalBallMetric("MOST_KILLED_DRAKE", data).acceptedAnswers, ["Mountain"]);
  assert.deepEqual(resolveCrystalBallMetric("DN_SOOPERS_OVER_2_5_WINS", data, { teamId: "DN SOOPers", threshold: 2.5 }).acceptedAnswers, ["Yes"]);
});

test("exact ties and equally close number predictions all receive full credit", () => {
  const exact = {
    gradingMode: "EXACT",
    correctAnswer: "Ahri",
    resolvedAnswers: JSON.stringify(["Ahri", "Azir"]),
    partialAnswers: null,
    partialRule: null,
    points: 30,
    resolutionData: null,
    answers: [{ userId: 1, answer: "azir" }, { userId: 2, answer: "Orianna" }],
  };
  assert.equal(crystalBallPoints(exact, 1), 30);
  assert.equal(crystalBallPoints(exact, 2), 0);

  const closest = {
    ...exact,
    gradingMode: "CLOSEST",
    correctAnswer: "30",
    resolvedAnswers: JSON.stringify([]),
    answers: [{ userId: 1, answer: "28" }, { userId: 2, answer: "32" }, { userId: 3, answer: "40" }],
  };
  assert.equal(crystalBallPoints(closest, 1), 30);
  assert.equal(crystalBallPoints(closest, 2), 30);
  assert.equal(crystalBallPoints(closest, 3), 0);
});

test("ranked questions award 50/30/10 only to the first three dense-ranking tiers", () => {
  const question = {
    gradingMode: "RANKED",
    correctAnswer: "Ahri",
    resolvedAnswers: JSON.stringify(["Ahri", "Azir"]),
    partialAnswers: null,
    partialRule: null,
    points: 50,
    resolutionData: JSON.stringify({
      acceptedAnswers: ["Ahri", "Azir"],
      evidence: "test ranking",
      values: { Ahri: 10, Azir: 10, Orianna: 9, Gnar: 8, Ambessa: 7 },
      ranking: [
        { rank: 1, answers: ["Ahri", "Azir"], value: 10 },
        { rank: 2, answers: ["Orianna"], value: 9 },
        { rank: 3, answers: ["Gnar"], value: 8 },
        { rank: 4, answers: ["Ambessa"], value: 7 },
      ],
    }),
    answers: [
      { userId: 1, answer: "azir" },
      { userId: 2, answer: "Orianna" },
      { userId: 3, answer: "Gnar" },
      { userId: 4, answer: "Ambessa" },
      { userId: 5, answer: "Nocturne" },
    ],
  };
  assert.equal(crystalBallPoints(question, 1), 50);
  assert.equal(crystalBallPoints(question, 2), 30);
  assert.equal(crystalBallPoints(question, 3), 10);
  assert.equal(crystalBallPoints(question, 4), 0);
  assert.equal(crystalBallPoints(question, 5), 0);
});

test("participant Crystal Ball choices stay private until the season lock", () => {
  assert.equal(crystalBallPredictionsPublic({ crystalBallLockedAt: null, seasonStatus: "PRESEASON" }), false);
  assert.equal(crystalBallPredictionsPublic({ crystalBallLockedAt: new Date(), seasonStatus: "PRESEASON" }), true);
  assert.equal(crystalBallPredictionsPublic({ crystalBallLockedAt: null, seasonStatus: "ACTIVE" }), true);
});
